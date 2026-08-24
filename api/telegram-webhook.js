const {
    createNotionTaskPage,
    createNotionNotePage,
    createNotionExpensePage,
    createNotionTensionPage,
    parseTensionSlashContent,
    TENSION_INVALID_FORMAT_MSG,
    parseExpenseAmount,
    normalizeNotionArea,
    readNotionTasks,
    getDailyTasks,
    getWeeklyTasks,
    getMonthTasks,
    getOverdueTasks,
    rescheduleTaskDateByPageId,
    updateNotionTaskStatus,
    deleteNotionTask,
    getPendingHabitsForToday,
    resolveHabitCheckboxPropertyBySortedIndex,
    markHabitCheckboxDone,
    parseTaskText,
    taskDateToBogotaYmd,
} = require("./notionTaskPage");
const { tryHandleMeetingSlashCommand } = require("./googleCalendarMeeting");
const {
    HABIT_CALLBACK_PREFIX,
    decodeHabitIndexCallback,
    buildHabitsPendingMessage,
    buildHabitsPendingKeyboard,
} = require("./habitTelegramMenu");

function getBogotaReferenceTimeMmDdYy() {
    const ref = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    const mm = String(ref.getMonth() + 1).padStart(2, "0");
    const dd = String(ref.getDate()).padStart(2, "0");
    const yy = String(ref.getFullYear()).slice(-2);
    return `${mm}-${dd}-${yy}`;
}

function buildSystemInstruction(referenceTimeMmDdYy) {
    return `Eres el router de Aura AI. Analiza el mensaje del usuario y responde ÚNICAMENTE un objeto JSON válido (sin markdown, sin texto adicional) con este esquema exacto:
{"intent": "TASK"|"NOTE"|"QUERY", "data": { ... }}

Reglas de clasificación:
- TASK: el usuario quiere crear o registrar una tarea, recordatorio o pendiente con posible área o fecha.
  data debe incluir: "Name" (string, título claro; puede incluir fecha en lenguaje natural, el servidor la separa), "Area" (una de: Trabajo Traffix, Trabajo secundario, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales, Matrimonio; por defecto Personales), "Fecha" (string YYYY-MM-DD o "" si no aplica; si Name ya trae la fecha natural, puedes dejar Fecha en "").
- NOTE: el usuario quiere guardar una nota, idea, reflexión o texto para el inbox (no es una tarea accionable como lista de pendientes).
  data debe incluir: "title" (resumen corto), "content" (texto completo del mensaje o la nota).
- QUERY: el usuario pregunta qué debe hacer, qué tiene pendiente, su lista de tareas, o consulta sus pendientes sin crear nada nuevo.
  data puede ser {} o incluir campos opcionales si aclaran el filtro (no es obligatorio).

Reglas de fecha:
- Usa SIEMPRE "Reference Time" como base de interpretación temporal.
- Reference Time actual (MM-DD-YY): ${referenceTimeMmDdYy}
- Regla de prioridad máxima para fechas numéricas: interpreta "MM DD YY" o "MM DD YYYY" como Mes-Día-Año.
- Ejemplo obligatorio: "05 08 26" significa 8 de mayo de 2026.
- Acepta términos relativos en español: "hoy", "mañana", "pasado mañana", "próximo martes", "este viernes".
- Si no puedes inferir una fecha confiable, deja "Fecha" en "" y conserva la tarea en "Name".`;
}

/** Cuerpo /help en texto plano (se envía con parse_mode HTML, sin etiquetas). */
const helpMessage = `
__________________________________________________________________
📖 Manual de Aura AI v2.9.3

🛠 Gestión de Tareas

Área/ ver → Filtra pendientes

/ld → Ver tareas del día (hoy)
/lm → Ver tareas de mañana
/lv → Ver tareas vencidas

⛪️ Tareas pendientes de reuniones 

/syncminutas - Sincroniza tareas pendientes de las reuniones grabadas.

📝 Notas y Hábitos

/Nota [Nota/Texto] → Envía a Inbox
/h → Hábitos pendientes de hoy (botones para marcar)

📅 Google Calendar

meeting/ MM DD YYYY HH:MM [DURACION] TITULO → Crea evento. 
Ej: meeting/ 05 30 2026 14:30 1.5 Entrevista con ***

💰 Finanzas

$ [Monto] [Concepto] → Registro gasto

🩺 Tensión: T/ <Oscar|Yulis> <120/80> → Registra la toma de tensión en DB_Tension
__________________________________________________________________`;

const MINUTAS_OBISPADO_DATABASE_ID = "3411358a89bc8035be29ca4fa57a744e";
const MINUTAS_READY_PROP = "Listo para tareas";
const MINUTAS_PROCESSED_PROP = "Procesada por Aura";
const MINUTAS_TASKS_ANCHOR_H3 = "Tareas pendientes para asignar:";

const MANAGE_TASK_RESCHEDULE_PROMPT = "¿que paso que paso mijo? y para cuándo mi rey?";
const interactiveTaskActionContext = new Map();
const interactiveRescheduleContext = new Map();
const MANAGE_TASK_PROMPTS = {
    manage_day: "¿Qué número de la lista diaria quieres gestionar mi papacho?",
    manage_week: "¿Qué número de la lista semanal quieres gestionar mi papacho?",
    manage_month: "¿Qué número de la lista mensual quieres gestionar mi papacho?",
    manage_overdue: "¿Qué número de las tareas vencidas quieres gestionar mi papacho?",
};

function buildInteractiveManageKeyboard(callbackData) {
    return {
        inline_keyboard: [[{ text: "⚙️ Gestionar Tarea", callback_data: callbackData }]],
    };
}

function buildInteractiveTaskActionsKeyboard(pageId) {
    return {
        inline_keyboard: [
            [
                { text: "✅ Done", callback_data: `itask_done:${pageId}` },
                { text: "📅 Reprogramar", callback_data: `itask_reschedule:${pageId}` },
                { text: "🗑 Borrar", callback_data: `itask_delete:${pageId}` }
            ],
        ],
    };
}

function notionHeadersOrThrow() {
    const notionToken = String(process.env.NOTION_TOKEN || "").trim();
    if (!notionToken) {
        throw new Error("Falta NOTION_TOKEN.");
    }
    return {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    };
}

function richTextToPlain(richText) {
    if (!Array.isArray(richText)) return "";
    return richText.map((t) => t?.plain_text || "").join("").trim();
}

function parseBogotaReferenceMmDdYyToDate() {
    const mmDdYy = getBogotaReferenceTimeMmDdYy();
    const m = mmDdYy.match(/^(\d{2})-(\d{2})-(\d{2})$/);
    if (!m) {
        return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    }
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = 2000 + Number(m[3]);
    return new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
}

function parseMmDdYyDateToken(raw) {
    const m = String(raw || "").trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
    if (!m) return "";
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return "";
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    const d = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return "";
    return taskDateToBogotaYmd(d);
}

function parseSyncMinutaDateToken(dateToken) {
    const raw = String(dateToken || "").trim();
    if (!raw) return "";
    if (/^mañana$|^manana$/i.test(raw)) {
        const refDate = parseBogotaReferenceMmDdYyToDate();
        refDate.setUTCDate(refDate.getUTCDate() + 1);
        return taskDateToBogotaYmd(refDate);
    }
    const mmDdYy = parseMmDdYyDateToken(raw);
    if (mmDdYy) return mmDdYy;
    const parsed = parseTaskText(raw);
    if (parsed?.taskDate) {
        return taskDateToBogotaYmd(parsed.taskDate);
    }
    return "";
}

function parseSyncMinutaTodoText(rawText) {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!text) return { cleanTitle: "", fechaYmd: "" };
    const atIdx = text.lastIndexOf("@");
    if (atIdx <= 0) {
        return { cleanTitle: text, fechaYmd: "" };
    }
    const titlePart = text.slice(0, atIdx).trim();
    const datePart = text.slice(atIdx + 1).trim();
    if (!titlePart || !datePart) {
        return { cleanTitle: text, fechaYmd: "" };
    }
    const fechaYmd = parseSyncMinutaDateToken(datePart);
    return { cleanTitle: titlePart, fechaYmd };
}

function getPageTitleFromProperties(properties) {
    const props = properties && typeof properties === "object" ? properties : {};
    for (const key of Object.keys(props)) {
        const p = props[key];
        if (p?.type === "title" && Array.isArray(p.title)) {
            const title = richTextToPlain(p.title);
            if (title) return title;
        }
    }
    return "Sin título";
}

async function notionQueryMinutasReadyPages() {
    const headers = notionHeadersOrThrow();
    const out = [];
    let nextCursor = null;
    do {
        const body = {
            page_size: 100,
            filter: {
                and: [
                    { property: MINUTAS_READY_PROP, checkbox: { equals: true } },
                    { property: MINUTAS_PROCESSED_PROP, checkbox: { equals: false } },
                ],
            },
        };
        if (nextCursor) body.start_cursor = nextCursor;
        const res = await fetch(`https://api.notion.com/v1/databases/${MINUTAS_OBISPADO_DATABASE_ID}/query`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            const detail = data?.message ? `${res.status}: ${data.message}` : String(res.status);
            throw new Error(`Error consultando minutas (${detail}).`);
        }
        out.push(...(Array.isArray(data.results) ? data.results : []));
        nextCursor = data.has_more ? data.next_cursor : null;
    } while (nextCursor);
    return out;
}

async function notionListAllBlockChildren(blockId) {
    const headers = notionHeadersOrThrow();
    const out = [];
    let nextCursor = null;
    do {
        const qs = new URLSearchParams({ page_size: "100" });
        if (nextCursor) qs.set("start_cursor", nextCursor);
        const res = await fetch(`https://api.notion.com/v1/blocks/${encodeURIComponent(blockId)}/children?${qs.toString()}`, {
            method: "GET",
            headers,
        });
        const data = await res.json();
        if (!res.ok) {
            const detail = data?.message ? `${res.status}: ${data.message}` : String(res.status);
            throw new Error(`Error leyendo bloques de minuta (${detail}).`);
        }
        out.push(...(Array.isArray(data.results) ? data.results : []));
        nextCursor = data.has_more ? data.next_cursor : null;
    } while (nextCursor);
    return out;
}

function extractTodoTextsAfterAnchorH3(blocks) {
    const todos = [];
    let collecting = false;
    for (const block of blocks) {
        const type = block?.type;
        if (type === "heading_3") {
            const h3Text = richTextToPlain(block?.heading_3?.rich_text);
            if (!collecting && h3Text === MINUTAS_TASKS_ANCHOR_H3) {
                collecting = true;
                continue;
            }
            if (collecting) break;
        }
        if (collecting && (type === "heading_1" || type === "heading_2")) {
            break;
        }
        if (collecting && type === "to_do") {
            const todoText = richTextToPlain(block?.to_do?.rich_text);
            if (todoText) todos.push(todoText);
        }
    }
    return todos;
}

async function markMinutaAsProcessed(pageId) {
    const headers = notionHeadersOrThrow();
    const res = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
            properties: {
                [MINUTAS_PROCESSED_PROP]: { checkbox: true },
            },
        }),
    });
    const data = await res.json();
    if (!res.ok) {
        const detail = data?.message ? `${res.status}: ${data.message}` : String(res.status);
        throw new Error(`No se pudo marcar la minuta como procesada (${detail}).`);
    }
}

async function handleSyncMinutasCommand(token, chatId) {
    const minutaPages = await notionQueryMinutasReadyPages();
    if (!minutaPages.length) {
        await telegramSendMessage(token, chatId, "ℹ️ No encontré minutas listas para sincronizar por ahora.");
        return;
    }
    for (const page of minutaPages) {
        const pageId = String(page?.id || "").trim();
        if (!pageId) continue;
        const minutaTitle = getPageTitleFromProperties(page?.properties);
        const blocks = await notionListAllBlockChildren(pageId);
        const todoTexts = extractTodoTextsAfterAnchorH3(blocks);
        let createdCount = 0;
        for (const todoText of todoTexts) {
            const { cleanTitle, fechaYmd } = parseSyncMinutaTodoText(todoText);
            if (!cleanTitle) continue;
            const createResult = await createNotionTaskPage({
                Name: cleanTitle,
                Area: "Iglesia",
                Fecha: fechaYmd,
            });
            if (createResult?.ok) createdCount += 1;
        }
        await markMinutaAsProcessed(pageId);
        await telegramSendMessage(
            token,
            chatId,
            `✅ Listo my little associated! Sincronización completa: Se agregaron ${createdCount} tareas de la reunión '${minutaTitle}' Yo vere a revisar y hacer todo D1`
        );
    }
}

/**
 * Respuesta de éxito/error tras crear tarea en Notion (Database ID, ID página, enlace API).
 * @param {{ ok: true, id: string, url: string, databaseId: string, databaseName: string, taskName?: string, dateYmd?: string } | { ok: false, error: string }} result
 * @returns {{ text: string, parseMode: string }}
 */
/**
 * Separa fecha en español (chrono, ref. America/Bogota) del título. Si no hay fecha, fechaYmd es "" y Notion usa hoy.
 * @param {string} rawTitle
 * @returns {{ name: string, fechaYmd: string }}
 */
function splitTaskTitleForNotion(rawTitle) {
    const trimmed = String(rawTitle ?? "").trim();
    if (!trimmed) return { name: "", fechaYmd: "" };
    const { cleanTitle, taskDate } = parseTaskText(trimmed);
    const name = String(cleanTitle ?? "").trim() || trimmed;
    const fechaYmd = taskDate ? taskDateToBogotaYmd(taskDate) : "";
    return { name, fechaYmd };
}

function formatTaskSavedTelegramReply(result) {
    if (!result || result.ok === false) {
        const base = String(result?.error || "❌ No pude guardar la tarea en Notion mi Rey, so sorry.").trim();
        return {
            text: `${base} Tranqui mi papacho, lo intentamos otra vez sumercito rela.`,
            parseMode: "Markdown",
        };
    }
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const taskName = esc(result.taskName || "Sin título");
    const dateYmd = esc(result.dateYmd || "hoy");
    const url = typeof result.url === "string" ? result.url.trim() : "";
    const linkLine = url ? `\n<a href="${escAttr(url)}">Abrir en Notion</a>` : "";
    const text = `✅ Listo my little associated! Tarea creada para ${dateYmd} con el título "${taskName}".${linkLine}`;
    return { text, parseMode: "HTML" };
}

function parseGeminiJson(raw) {
    const cleaned = String(raw)
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
    return JSON.parse(cleaned);
}

async function telegramSendMessage(token, chatId, text, replyMarkup = null, parseMode = "Markdown") {
    const body = { chat_id: chatId, text, parse_mode: parseMode };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

async function telegramSendMessageAndGetResult(token, chatId, text, replyMarkup = null, parseMode = "Markdown") {
    const body = { chat_id: chatId, text, parse_mode: parseMode };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
        const detail = data?.description || String(res.status);
        throw new Error(`Telegram sendMessage error: ${detail}`);
    }
    return data.result;
}

async function telegramEditMessageText(token, chatId, messageId, text, replyMarkup = null, parseMode = "Markdown") {
    const body = { chat_id: chatId, message_id: messageId, text, parse_mode: parseMode };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

async function telegramDeleteMessage(token, chatId, messageId) {
    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
}

function clearInteractiveTaskActionContext(chatId, messageId) {
    interactiveTaskActionContext.delete(`${chatId}:${messageId}`);
}

async function sendHabitsPendingMenu(token, chatId, opts = {}) {
    const result = await getPendingHabitsForToday();
    if (!result.ok) {
        if (!opts.silent) {
            await telegramSendMessage(token, chatId, `${result.message} Tranqui mi rey, lo revisamos ya mismo!`);
        }
        return result;
    }
    const text = buildHabitsPendingMessage(result.pending, { cron: opts.cron });
    const keyboard = buildHabitsPendingKeyboard(result.pending, result.sortedCheckboxNames);
    if (opts.editMessageId != null) {
        await telegramEditMessageText(token, chatId, opts.editMessageId, text, keyboard);
    } else {
        await telegramSendMessageAndGetResult(token, chatId, text, keyboard);
    }
    if (opts.callbackQueryId) {
        await telegramAnswerCallbackQuery(token, opts.callbackQueryId);
    }
    return result;
}

async function telegramAnswerCallbackQuery(token, callbackQueryId, text = "", showAlert = false) {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            callback_query_id: callbackQueryId,
            text: text.slice(0, 200),
            show_alert: showAlert,
        }),
    });
}

/** Tareas por página en el teclado/lista; más de esto activa fila de paginación. */
const TASKS_PAGE_SIZE = 8;
const COMMAND_TASKS_PAGE_SIZE = 6;
const TASK_STATUS_ACTIVE = ["Pendiente", "Haciendo", "Pausado"];
const LIST_COMMAND_KEYS = new Set(["ld", "lm", "lv"]);

/**
 * @param {number} page Página 0-based solicitada.
 * @param {number} totalTasks
 * @param {number} pageSize
 */
function clampTaskListPage(page, totalTasks, pageSize) {
    if (totalTasks <= 0) return { page: 0, totalPages: 1 };
    const totalPages = Math.ceil(totalTasks / pageSize);
    const p = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
    return { page: p, totalPages };
}

function getBogotaNowDate() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
}

function getBogotaTodayYmd() {
    const now = getBogotaNowDate();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function getBogotaTomorrowYmd() {
    const now = getBogotaNowDate();
    now.setDate(now.getDate() + 1);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function extractNotionTaskFromPage(page) {
    const props = page?.properties || {};
    const titleProp = props.Name?.title;
    const title = Array.isArray(titleProp) ? richTextToPlain(titleProp) : "Sin título";
    const area = props.Area?.select?.name || "Sin Área";
    const fecha = props.Fecha?.date?.start || "";
    const status = props.Estado?.select?.name || "---";
    return {
        id: page?.id || "",
        name: title || "Sin título",
        area: area || "Sin Área",
        fechaYmd: fecha,
        status,
    };
}

function buildTaskFilterByCommand(commandKey) {
    const statusOr = TASK_STATUS_ACTIVE.map((statusName) => ({
        property: "Estado",
        select: { equals: statusName },
    }));
    const todayYmd = getBogotaTodayYmd();
    if (commandKey === "ld") {
        return {
            and: [{ or: statusOr }, { property: "Fecha", date: { equals: todayYmd } }],
        };
    }
    if (commandKey === "lm") {
        const tomorrowYmd = getBogotaTomorrowYmd();
        return {
            and: [{ or: statusOr }, { property: "Fecha", date: { equals: tomorrowYmd } }],
        };
    }
    return {
        and: [{ or: statusOr }, { property: "Fecha", date: { before: todayYmd } }],
    };
}

async function queryItemsForPaginatedList(commandKey) {
    return queryTasksForListCommand(commandKey);
}

async function queryTasksForListCommand(commandKey) {
    const dbId = String(process.env.NOTION_DATABASE_ID || "").trim();
    if (!dbId) {
        throw new Error("Falta NOTION_DATABASE_ID.");
    }
    const headers = notionHeadersOrThrow();
    const filter = buildTaskFilterByCommand(commandKey);
    const tasks = [];
    let nextCursor = null;
    do {
        const body = {
            page_size: 100,
            filter,
            // Orden estable: primero por Fecha ascendente, luego por created_time.
            // Esto garantiza que el índice por página siga apuntando a la misma tarea
            // al reconsultar, incluso tras reinicio del servidor.
            sorts: [
                { property: "Fecha", direction: "ascending" },
                { timestamp: "created_time", direction: "ascending" },
            ],
        };
        if (nextCursor) body.start_cursor = nextCursor;
        const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            const detail = data?.message ? `${res.status}: ${data.message}` : String(res.status);
            throw new Error(`Error consultando tareas (${detail}).`);
        }
        const pages = Array.isArray(data?.results) ? data.results : [];
        tasks.push(...pages.map(extractNotionTaskFromPage));
        nextCursor = data.has_more ? data.next_cursor : null;
    } while (nextCursor);
    return tasks;
}

function formatTaskDateLabel(fechaYmd) {
    const ymd = String(fechaYmd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "Pendiente";
    const date = new Date(`${ymd}T12:00:00Z`);
    return new Intl.DateTimeFormat("es-CO", {
        day: "numeric",
        month: "long",
        timeZone: "America/Bogota",
    }).format(date);
}

function escapeTelegramMarkdown(text) {
    return String(text || "")
        .replace(/\\/g, "\\\\")
        .replace(/\*/g, "\\*")
        .replace(/_/g, "\\_")
        .replace(/\[/g, "\\[")
        .replace(/`/g, "\\`");
}

function buildListCommandMessage(tasks, pageZeroBased, pageSize = COMMAND_TASKS_PAGE_SIZE) {
    const allTasks = Array.isArray(tasks) ? tasks : [];
    const totalPages = Math.max(1, Math.ceil(allTasks.length / pageSize));
    const { page: safePage } = clampTaskListPage(pageZeroBased, allTasks.length, pageSize);
    const pageHuman = safePage + 1;
    const header = `📄 Página ${pageHuman} de ${totalPages}\n\n`;
    if (!allTasks.length) {
        return { text: `${header}🔍 Sin pendientes. Asi que rela mi rey!`, page: safePage, totalPages };
    }
    const start = safePage * pageSize;
    const visible = allTasks.slice(start, start + pageSize);
    const body = visible
        .map((task, idx) => {
            const absoluteIndex = start + idx + 1;
            const area = escapeTelegramMarkdown(task.area || "Sin Área");
            const taskName = escapeTelegramMarkdown(task.name || "Sin título");
            const dateLabel = formatTaskDateLabel(task.fechaYmd);
            return `${absoluteIndex}. 🔹 **[${area}]** - ${taskName}\n📅 *${dateLabel}*`;
        })
        .join("\n\n");
    return { text: `${header}${body}`, page: safePage, totalPages };
}

function buildListCommandKeyboard(tasks, commandKey, pageZeroBased, pageSize = COMMAND_TASKS_PAGE_SIZE) {
    const { page: safePage, totalPages } = clampTaskListPage(pageZeroBased, tasks.length, pageSize);
    if (!tasks.length) return { inline_keyboard: [] };
    const start = safePage * pageSize;
    const visible = tasks.slice(start, start + pageSize);
    const pageHuman = safePage + 1;
    const rowOne = [];
    const rowTwo = [];
    for (let i = 0; i < visible.length; i += 1) {
        const localIndex = i + 1;
        const globalTaskLabel = (pageHuman - 1) * pageSize + localIndex;
        const btn = {
            text: String(globalTaskLabel),
            callback_data: `pick_${localIndex}_${commandKey}_p${pageHuman}`,
        };
        if (localIndex <= 3) rowOne.push(btn);
        else rowTwo.push(btn);
    }
    const rows = [];
    if (rowOne.length) rows.push(rowOne);
    if (rowTwo.length) rows.push(rowTwo);
    if (totalPages > 1) {
        const prevPage = Math.max(1, pageHuman - 1);
        const nextPage = Math.min(totalPages, pageHuman + 1);
        rows.push([
            { text: "⬅️ Ant", callback_data: `nav_p${prevPage}_${commandKey}` },
            { text: "Sig ➡️", callback_data: `nav_p${nextPage}_${commandKey}` },
        ]);
    }
    return { inline_keyboard: rows };
}

async function renderListCommandPage(token, chatId, commandKey, pageZeroBased, opts = {}) {
    const items = await queryItemsForPaginatedList(commandKey);
    const { text, page } = buildListCommandMessage(items, pageZeroBased, COMMAND_TASKS_PAGE_SIZE);
    const keyboard = buildListCommandKeyboard(items, commandKey, page, COMMAND_TASKS_PAGE_SIZE);
    if (opts.editMessageId != null) {
        await telegramEditMessageText(token, chatId, opts.editMessageId, text, keyboard);
    } else {
        await telegramSendMessage(token, chatId, text, keyboard);
    }
    if (opts.callbackQueryId) {
        await telegramAnswerCallbackQuery(token, opts.callbackQueryId);
    }
}

/**
 * Texto de lista alineado con la página visible (numeración global 1…N).
 * @param {{ id: string, name: string, status: string, area: string }[]} tasks
 */
function buildPendingTasksListMarkdown(tasks, page, pageSize = TASKS_PAGE_SIZE) {
    if (!tasks.length) return "🔍 Sin pendientes.";
    const { page: p, totalPages } = clampTaskListPage(page, tasks.length, pageSize);
    const start = p * pageSize;
    const slice = tasks.slice(start, start + pageSize);
    const lines = slice.map(
        (t, i) => `${start + i + 1}. 📌 [${t.area}] — ${t.name} (${t.status})`
    );
    let header = "📋 Tus tareas";
    if (tasks.length > pageSize) {
        header += ` _(página ${p + 1}/${totalPages})_`;
    }
    return `${header}:\n${lines.join("\n")}`;
}

/**
 * Empaqueta filtro de área en callback_data (sin `:` en el valor; Notion usa nombres fijos).
 */
function packTaskPageNavCallback(direction, fromPage, filterArea) {
    const p = String(fromPage);
    const f = String(filterArea || "").trim();
    const prefix = direction === "prev" ? "tpr" : "tnx";
    if (!f) return `${prefix}:${p}`;
    return `${prefix}:${p}:${f}`;
}

/**
 * @param {{ id: string, name: string, status: string, area: string }[]} tasks
 */
function buildPendingTasksKeyboard(tasks, page, filterArea = "", pageSize = TASKS_PAGE_SIZE) {
    if (!tasks.length) return { inline_keyboard: [] };
    const { page: p, totalPages } = clampTaskListPage(page, tasks.length, pageSize);
    const start = p * pageSize;
    const slice = tasks.slice(start, start + pageSize);
    const f = String(filterArea || "").trim();

    const rows = slice.map((t, i) => {
        const n = start + i + 1;
        return [
            { text: `✅ ${n}`, callback_data: `done:${t.id}` },
            { text: `🔵 ${n}`, callback_data: `doing_blue:${t.id}` },
            { text: `🚀 ${n}`, callback_data: `pause_task:${t.id}` },
            { text: `🗑️ ${n}`, callback_data: `del:${t.id}` },
        ];
    });

    if (tasks.length > pageSize) {
        const prevData = p > 0 ? packTaskPageNavCallback("prev", p, f) : "tpx:first";
        const nextData = p < totalPages - 1 ? packTaskPageNavCallback("next", p, f) : "tpx:last";
        rows.push([
            { text: "⬅️ Anterior", callback_data: prevData },
            { text: `Página ${p + 1}/${totalPages}`, callback_data: `tpi:${p}:${totalPages}` },
            { text: "Siguiente ➡️", callback_data: nextData },
        ]);
    }

    return { inline_keyboard: rows };
}

/**
 * @param {{ editMessageId?: number, callbackQueryId?: string }} [opts]
 */
async function renderPendingTaskList(token, chatId, filterArea = "", page = 0, opts = {}) {
    const { tasks } = await readNotionTasks(filterArea || "", "");
    const { page: p } = clampTaskListPage(page, tasks.length, TASKS_PAGE_SIZE);
    const listText = buildPendingTasksListMarkdown(tasks, p, TASKS_PAGE_SIZE);
    const keyboard = buildPendingTasksKeyboard(tasks, p, filterArea, TASKS_PAGE_SIZE);

    if (opts.editMessageId != null) {
        await telegramEditMessageText(token, chatId, opts.editMessageId, listText, keyboard);
    } else {
        await telegramSendMessage(token, chatId, listText, keyboard);
    }

    if (opts.callbackQueryId) {
        await telegramAnswerCallbackQuery(token, opts.callbackQueryId);
    }
}

async function sendPendingTaskList(token, chatId, filterArea = "") {
    await renderPendingTaskList(token, chatId, filterArea, 0);
}

/**
 * Formato secuencial simple para comandos de lista rápida.
 * @param {{ name: string, status: string }[]} tasks
 * @returns {string}
 */
function formatSequentialTaskStatusList(tasks) {
    if (!tasks.length) return "🔍 Sin pendientes.";
    return tasks
        .map((task, index) => `${index + 1}. ${task.name} - ${task.status}`)
        .join("\n");
}

/**
 * @param {any[]} overduePages
 * @returns {{ id: string, name: string, status: string }[]}
 */
function mapOverduePagesToTasks(overduePages) {
    return (overduePages || []).map((page) => ({
        id: page?.id || "",
        name: page?.properties?.Name?.title?.[0]?.text?.content || "Sin título",
        status: page?.properties?.Estado?.select?.name || "---",
    }));
}

function isInteractiveManagePromptText(promptText) {
    const t = String(promptText || "").toLowerCase();
    return t.includes("diaria") || t.includes("semanal") || t.includes("mensual") || t.includes("vencidas");
}

async function getInteractiveTasksByPromptText(promptText) {
    const t = String(promptText || "").toLowerCase();
    if (t.includes("diaria")) {
        const { tasks } = await getDailyTasks();
        return tasks;
    }
    if (t.includes("semanal")) {
        const { tasks } = await getWeeklyTasks();
        return tasks;
    }
    if (t.includes("vencidas")) {
        const overduePages = await getOverdueTasks();
        return mapOverduePagesToTasks(overduePages);
    }
    const { tasks } = await getMonthTasks();
    return tasks;
}
/**
 * Mensaje con `/` que no es comando de Telegram (`prefijo/ contenido`).
 * @returns {null | { prefix: string, prefixNorm: string, content: string }}
 */
/**
 * Mensaje que empieza por `$`: primer número = monto; el resto del texto = concepto.
 * @returns {null | { amountStr: string, concept: string }}
 */
function parseDollarExpenseMessage(text) {
    if (!text.startsWith("$")) return null;
    const rest = text.slice(1).trim();
    if (!rest) return null;
    const m = rest.match(/-?\d[\d.,]*/);
    if (!m) return null;
    const amountStr = m[0];
    const before = rest.slice(0, m.index).trim();
    const after = rest.slice(m.index + amountStr.length).trim();
    const concept = [before, after].filter(Boolean).join(" ").trim() || "Gasto";
    return { amountStr, concept };
}

function parseInlineSlashPrefix(text) {
    if (!text || text.startsWith("/") || !text.includes("/")) return null;
    if (/^https?:\/\//i.test(text)) return null;
    const idx = text.indexOf("/");
    const prefix = text.slice(0, idx).trim();
    const content = text.slice(idx + 1).trim();
    if (!prefix) return null;
    return { prefix, prefixNorm: prefix.toLowerCase(), content };
}

function noteTitleFromNotaBody(body) {
    const line = body.split("\n")[0].trim();
    if (!line) return "Nota";
    return line.length <= 120 ? line : `${line.slice(0, 117)}...`;
}

/**
 * @returns {Promise<boolean>} true si el mensaje se procesó (no pasar a Gemini).
 */
async function handleInlineSlashPrefix(token, chatId, text) {
    const parsed = parseInlineSlashPrefix(text);
    if (!parsed) return false;

    const { prefix, prefixNorm, content } = parsed;

    if (prefixNorm === "t") {
        const tensionParsed = parseTensionSlashContent(content);
        if (!tensionParsed.ok) {
            await telegramSendMessage(token, chatId, TENSION_INVALID_FORMAT_MSG);
            return true;
        }
        try {
            const result = await createNotionTensionPage({
                quien: tensionParsed.quien,
                tension: tensionParsed.tension,
            });
            if (typeof result === "string") {
                await telegramSendMessage(token, chatId, result);
            } else {
                await telegramSendMessage(
                    token,
                    chatId,
                    `✅ Tensión registrada con éxito para ${result.quien}: ${result.tension} (${result.dateYmd})`
                );
            }
        } catch (tensionErr) {
            console.error("Tension register error:", tensionErr);
            await telegramSendMessage(
                token,
                chatId,
                `❌ No pude registrar la tensión (${tensionErr.message || "error de red o API"}). Inténtalo de nuevo.`
            );
        }
        return true;
    }

    if (prefixNorm === "nota") {
        if (!content) {
            await telegramSendMessage(token, chatId, "⚠️ Espere un momentico escriba bien eso! el texto de la nota después de `nota/` mi papacho tratame serio!");
            return true;
        }
        const title = noteTitleFromNotaBody(content);
        const result = await createNotionNotePage(title, content);
        if (typeof result === "string" && result.startsWith("❌")) {
            await telegramSendMessage(token, chatId, `${result} Tranqui mi rey, lo ajustamos ya mismo!`);
        } else {
            await telegramSendMessage(token, chatId, `📝 Nota guardada mi rey hay para que despues le heche el ojo! *${title}*`);
        }
        return true;
    }

    if (prefixNorm === "m" || prefixNorm === "minuta") {
        await telegramSendMessage(token, chatId, "ℹ️ Veo pero que pasa mino? Sumerce sabe que `m/` está deshabilitado. Pille echele gafa y use `/syncminutas` para sincronizar tareas desde minutas, ojo mi manito.");
        return true;
    }

    if (prefixNorm === "act" || prefixNorm === "actividad") {
        await telegramSendMessage(token, chatId, "ℹ️ Veo pero que pasa mani? `act/` está deshabilitado y sumercer lo sabe. Pille echele gafa y use `/syncminutas` para sincronizar tareas desde minutas, ojo mi manito, yo vere la buena!.");
        return true;
    }

    if (content.toLowerCase() === "ver") {
        await sendPendingTaskList(token, chatId, normalizeNotionArea(prefix));
        return true;
    }

    if (!content) {
        await telegramSendMessage(
            token,
            chatId,
            "⚠️ Pero como joven? Escriba bien esa vaina! la tarea después de `/` mi rey algo como `Iglesia/ Leer`. yo vere!"
        );
        return true;
    }

    const { name: taskName, fechaYmd } = splitTaskTitleForNotion(content);
    const taskResult = await createNotionTaskPage({ Name: taskName, Area: prefix, Fecha: fechaYmd });
    const taskReply = formatTaskSavedTelegramReply(taskResult);
    await telegramSendMessage(token, chatId, taskReply.text, null, taskReply.parseMode);
    return true;
}

async function routeIntentWithGemini(userText) {
    const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error("Falta GEMINI_API_KEY.");
    }
    const nowBogotaIso = new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).replace(" ", "T");
    const referenceTimeMmDdYy = getBogotaReferenceTimeMmDdYy();
    const systemInstruction = buildSystemInstruction(referenceTimeMmDdYy);
    const userPayload = [
        `Reference Time (America/Bogota, MM-DD-YY): ${referenceTimeMmDdYy}`,
        `Contexto temporal actual (America/Bogota): ${nowBogotaIso}`,
        "",
        "Mensaje del usuario:",
        userText,
    ].join("\n");

    const runModel = async (modelId) => {
        const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const body = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: { responseMimeType: "application/json" },
            contents: [{ role: "user", parts: [{ text: userPayload }] }],
        };
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            const errMsg = data?.error?.message || `${res.status}`;
            throw new Error(`Gemini API (${modelId}): ${errMsg}`);
        }
        const outText = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("").trim() || "";
        if (!outText) {
            throw new Error(`Gemini API (${modelId}): respuesta vacía.`);
        }
        return parseGeminiJson(outText);
    };

    try {
        return await runModel("gemini-2.5-flash");
    } catch (apiErr) {
        const msg = String(apiErr?.message || "");
        if (msg.includes("503") || msg.includes("404")) {
            return await runModel("gemini-2.0-flash");
        }
        throw apiErr;
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("OK");
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const message = req.body?.message;
    const cb = req.body?.callback_query;

    if (cb) {
        const cbData = cb.data || "";

        if (cbData.startsWith(HABIT_CALLBACK_PREFIX)) {
            const habitIndex = decodeHabitIndexCallback(cbData);
            if (habitIndex == null) {
                await telegramAnswerCallbackQuery(token, cb.id, "Hábito inválido.");
                return res.status(200).send("OK");
            }
            try {
                const [pendingState, resolvedKey] = await Promise.all([
                    getPendingHabitsForToday(),
                    resolveHabitCheckboxPropertyBySortedIndex(habitIndex),
                ]);
                if (!pendingState.ok) {
                    await telegramAnswerCallbackQuery(token, cb.id, "No pude leer hábitos.");
                    return res.status(200).send("OK");
                }
                if (!resolvedKey.ok) {
                    await telegramAnswerCallbackQuery(token, cb.id, resolvedKey.message.slice(0, 200));
                    return res.status(200).send("OK");
                }
                const markResult = await markHabitCheckboxDone(
                    resolvedKey.propertyKey,
                    pendingState.pageId
                );
                await telegramAnswerCallbackQuery(
                    token,
                    cb.id,
                    markResult.ok ? `✅ ${markResult.resolvedName}` : markResult.message.slice(0, 200)
                );
                if (markResult.ok) {
                    await sendHabitsPendingMenu(token, cb.message.chat.id, {
                        editMessageId: cb.message.message_id,
                    });
                }
            } catch (habitErr) {
                console.error("Habit callback error:", habitErr);
                await telegramAnswerCallbackQuery(token, cb.id, "Error al marcar hábito.");
            }
            return res.status(200).send("OK");
        }

        const navMatch = cbData.match(/^nav_p(\d+)_([a-z]+)$/);
        if (navMatch) {
            const targetPageHuman = Number(navMatch[1]);
            const commandKey = navMatch[2];
            if (!LIST_COMMAND_KEYS.has(commandKey)) {
                await telegramAnswerCallbackQuery(token, cb.id, "Navegación inválida.");
                return res.status(200).send("OK");
            }
            const safeHumanPage = Math.max(1, targetPageHuman || 1);
            await renderListCommandPage(token, cb.message.chat.id, commandKey, safeHumanPage - 1, {
                editMessageId: cb.message.message_id,
                callbackQueryId: cb.id,
            });
            return res.status(200).send("OK");
        }

        const pickMatch = cbData.match(/^pick_(\d+)_([a-z]+)_p(\d+)$/);
        if (pickMatch) {
            const buttonIndex = Number(pickMatch[1]);
            const commandKey = pickMatch[2];
            const pageHuman = Number(pickMatch[3]);
            if (!LIST_COMMAND_KEYS.has(commandKey)) {
                await telegramAnswerCallbackQuery(token, cb.id, "Selección inválida.");
                return res.status(200).send("OK");
            }
            if (!Number.isInteger(buttonIndex) || buttonIndex < 1 || buttonIndex > COMMAND_TASKS_PAGE_SIZE) {
                await telegramAnswerCallbackQuery(token, cb.id, "Índice inválido.");
                return res.status(200).send("OK");
            }
            const items = await queryItemsForPaginatedList(commandKey);
            const itemIndex = (Math.max(1, pageHuman) - 1) * COMMAND_TASKS_PAGE_SIZE + (buttonIndex - 1);
            const selectedItem = items[itemIndex];
            if (!selectedItem?.id) {
                await telegramAnswerCallbackQuery(
                    token,
                    cb.id,
                    "Esa tarea ya no está disponible. Meta bien el dedo mijo"
                );
                return res.status(200).send("OK");
            }
            const chatId = cb.message.chat.id;
            const actionKeyboard = buildInteractiveTaskActionsKeyboard(selectedItem.id);
            const actionMsg = await telegramSendMessageAndGetResult(
                token,
                chatId,
                `🎯 ${itemIndex + 1}. ${escapeTelegramMarkdown(selectedItem.name)}\n¿Qué acción quieres ejecutar? Hablame claro mi rey!`,
                actionKeyboard
            );
            interactiveTaskActionContext.set(`${chatId}:${actionMsg.message_id}`, {
                pageId: selectedItem.id,
                taskName: selectedItem.name,
            });
            await telegramAnswerCallbackQuery(token, cb.id);
            return res.status(200).send("OK");
        }

        if (MANAGE_TASK_PROMPTS[cbData]) {
            const forceReply = { force_reply: true, selective: true };
            await telegramSendMessage(
                token,
                cb.message.chat.id,
                MANAGE_TASK_PROMPTS[cbData],
                forceReply
            );
            await telegramAnswerCallbackQuery(token, cb.id);
            return res.status(200).send("OK");
        }

        if (
            cbData.startsWith("itask_done:") ||
            cbData.startsWith("itask_reschedule:") ||
            cbData.startsWith("itask_delete:")
        ) {
            const [action, pageId] = cbData.split(":");
            if (!pageId) {
                await telegramAnswerCallbackQuery(token, cb.id, "No pude identificar la tarea aprende a tratarme serio!");
                return res.status(200).send("OK");
            }

            const chatId = cb.message.chat.id;
            const actionMessageId = cb.message.message_id;

            if (action === "itask_done") {
                const result = await updateNotionTaskStatus(pageId, "Hecho! hagale que todo bien mijo!", true);
                if (result.ok) {
                    await telegramDeleteMessage(token, chatId, actionMessageId);
                    clearInteractiveTaskActionContext(chatId, actionMessageId);
                }
                await telegramSendMessage(
                    token,
                    chatId,
                    result.ok
                        ? `✅ Tarea completada mi rey! Asi se hace! no le baje que ya casi!: ${result.taskName}`
                        : `❌ No pude completar la tarea mi papacho mala mia... pereme me ajusto y lo intentamos de nuevo! ${result.text || ""}`.trim()
                );
                await telegramAnswerCallbackQuery(token, cb.id);
                return res.status(200).send("OK");
            }

            if (action === "itask_delete") {
                const reply = await deleteNotionTask(pageId, true);
                const failed = String(reply || "").startsWith("❌");
                if (!failed) {
                    await telegramDeleteMessage(token, chatId, actionMessageId);
                    clearInteractiveTaskActionContext(chatId, actionMessageId);
                }
                await telegramSendMessage(
                    token,
                    chatId,
                    failed
                        ? `${reply} Tranqui mi rey lo intentamos de nuevo para antier!`
                        : `${reply} Listo mi papacho usted sabe como soy yo!`
                );
                await telegramAnswerCallbackQuery(token, cb.id);
                return res.status(200).send("OK");
            }

            const actionKey = `${chatId}:${actionMessageId}`;
            const taskCtx = interactiveTaskActionContext.get(actionKey) || null;
            const forceReply = { force_reply: true, selective: true };
            const promptMsg = await telegramSendMessageAndGetResult(
                token,
                chatId,
                MANAGE_TASK_RESCHEDULE_PROMPT,
                forceReply
            );
            const ctxKey = `${chatId}:${promptMsg.message_id}`;
            interactiveRescheduleContext.set(ctxKey, {
                pageId,
                taskName: taskCtx?.taskName || "Tarea",
                actionMessageId,
            });
            await telegramAnswerCallbackQuery(token, cb.id);
            return res.status(200).send("OK");
        }

        if (cbData === "tpx:first") {
            await telegramAnswerCallbackQuery(token, cb.id, "Ya estás en la primera página.");
            return res.status(200).send("OK");
        }
        if (cbData === "tpx:last") {
            await telegramAnswerCallbackQuery(token, cb.id, "Ya estás en la última página.");
            return res.status(200).send("OK");
        }

        if (cbData.startsWith("tpi:")) {
            const parts = cbData.split(":");
            const cur = parseInt(parts[1], 10);
            const tot = parseInt(parts[2], 10);
            const humanCur = Number.isFinite(cur) ? cur + 1 : 1;
            const humanTot = Number.isFinite(tot) ? tot : 1;
            await telegramAnswerCallbackQuery(token, cb.id, `Página ${humanCur} de ${humanTot}`);
            return res.status(200).send("OK");
        }

        if (cbData.startsWith("tpr:") || cbData.startsWith("tnx:")) {
            const isPrev = cbData.startsWith("tpr:");
            const rest = cbData.slice(4);
            const idx = rest.indexOf(":");
            const fromPage = parseInt(idx === -1 ? rest : rest.slice(0, idx), 10);
            const filter = idx === -1 ? "" : rest.slice(idx + 1);
            const { tasks } = await readNotionTasks(filter, "");
            const { totalPages } = clampTaskListPage(0, tasks.length, TASKS_PAGE_SIZE);
            if (!Number.isFinite(fromPage)) {
                await telegramAnswerCallbackQuery(token, cb.id, "No pude cambiar de página mijo, echele gafa y me comenta!");
                return res.status(200).send("OK");
            }
            const targetPage = isPrev ? fromPage - 1 : fromPage + 1;
            const { page: safePage } = clampTaskListPage(targetPage, tasks.length, TASKS_PAGE_SIZE);
            await renderPendingTaskList(token, cb.message.chat.id, filter, safePage, {
                editMessageId: cb.message.message_id,
                callbackQueryId: cb.id,
            });
            return res.status(200).send("OK");
        }

        const [action, pageId] = cbData.split(":");
        if (action === "del") {
            const reply = await deleteNotionTask(pageId, true);
            await telegramSendMessage(token, cb.message.chat.id, reply);
            return res.status(200).send("OK");
        }
        // --- BOTONES FIX: Nuevo control de pause_task para 🚀 ---
        if (action === "pause_task") {
            const status = "Pausado"; // nombre exacto para el estado de pausa
            const result = await updateNotionTaskStatus(pageId, status, true);
            // Mensaje personalizado de pausa
            const messageText =
                result.ok
                    ? `🚀 Tarea pausada mi rey: ${result.taskName}`
                    : `❌ No pude pausar la tarea mi papacho mala mia ${result.text || ""}`.trim();
            await telegramSendMessage(token, cb.message.chat.id, messageText);
            return res.status(200).send("OK");
        }
        const status =
            action === "done"
                ? "Hecho"
                : action === "doing" || action === "doing_blue"
                  ? "Haciendo"
                  : "Pausado";
        const result = await updateNotionTaskStatus(pageId, status, true);
        const messageText =
            action === "doing_blue" && result.ok
                ? `🔵 Tarea en curso mi rey pisele pisele!! ${result.taskName}`
                : `❌ No pude actualizar la tarea mijo dejeme me ajusto las tuercas ${result.text || ""}`.trim();
        await telegramSendMessage(token, cb.message.chat.id, messageText);
        return res.status(200).send("OK");
    }

    if (!message) return res.status(200).send("OK");
    const chatId = message.chat.id;
    const text = (message.text || "").trim();

    try {
        if (message.reply_to_message?.from?.is_bot) {
            const replyPrompt = String(message.reply_to_message?.text || "").trim();

            if (isInteractiveManagePromptText(replyPrompt)) {
                const selectedNumber = Number(text);
                if (!Number.isInteger(selectedNumber) || selectedNumber <= 0) {
                    await telegramSendMessage(token, chatId, "❌ Pero como? Respondame como es! Con un número válido de tarea mi rey!");
                    return res.status(200).send("OK");
                }

                const tasks = await getInteractiveTasksByPromptText(replyPrompt);
                const taskIndex = selectedNumber - 1;
                if (taskIndex < 0 || taskIndex >= tasks.length) {
                    await telegramSendMessage(token, chatId, `❌ Índice inválido mijo. Tratame serio y use un número entre 1 y ${tasks.length || 1}.`);
                    return res.status(200).send("OK");
                }

                const selectedTask = tasks[taskIndex];
                const actionKeyboard = buildInteractiveTaskActionsKeyboard(selectedTask.id);
                const actionMsg = await telegramSendMessageAndGetResult(
                    token,
                    chatId,
                    `🎯 Tarea seleccionada: ${selectedTask.name}\n¿Qué acción quieres ejecutar?`,
                    actionKeyboard
                );
                interactiveTaskActionContext.set(`${chatId}:${actionMsg.message_id}`, {
                    pageId: selectedTask.id,
                    taskName: selectedTask.name,
                });
                return res.status(200).send("OK");
            }

            if (replyPrompt === MANAGE_TASK_RESCHEDULE_PROMPT) {
                const ctxKey = `${chatId}:${message.reply_to_message.message_id}`;
                const ctx = interactiveRescheduleContext.get(ctxKey);
                if (!ctx?.pageId) {
                    await telegramSendMessage(token, chatId, "❌ Esta respuesta no corresponde a una reprogramación activa mi papacho, echele gafa y me comenta!");
                    return res.status(200).send("OK");
                }
                const result = await rescheduleTaskDateByPageId(ctx.pageId, text);
                if (!result.ok) {
                    await telegramSendMessage(token, chatId, `${result.error} Tranqui mi rey, lo volvemos a intentar ya mismo!`);
                    return res.status(200).send("OK");
                }
                interactiveRescheduleContext.delete(ctxKey);
                if (ctx.actionMessageId != null) {
                    await telegramDeleteMessage(token, chatId, ctx.actionMessageId);
                    clearInteractiveTaskActionContext(chatId, ctx.actionMessageId);
                }
                await telegramSendMessage(
                    token,
                    chatId,
                    `✅ Tarea reprogramada mi rey, pero ojo! Hagala porque y entonces?: ${ctx.taskName}\nNueva fecha: ${result.dateYmd}`
                );
                return res.status(200).send("OK");
            }
        }

        if (message.voice) {
            await telegramSendMessage(token, chatId, "🎙️ Solo proceso *texto*. Escribe tu mensaje o usa /help.");
            return res.status(200).send("OK");
        }

        if (text === "/start") {
            await telegramSendMessage(
                token,
                chatId,
                "🚀 Aura AI Online mi papacho. Usa `Área/ tarea`, `Matrimonio/ tarea`, `nota/`, `/h` (hábitos) o `/lm` (mañana). /help para el manual!"
            );
            return res.status(200).send("OK");
        }

        if (text === "/help") {
            await telegramSendMessage(token, chatId, helpMessage.trim(), null, "HTML");
            return res.status(200).send("OK");
        }

        if (await tryHandleMeetingSlashCommand(token, chatId, text, telegramSendMessage)) {
            return res.status(200).send("OK");
        }

        if (await handleInlineSlashPrefix(token, chatId, text)) {
            return res.status(200).send("OK");
        }

        if (text.toLowerCase() === "ver") {
            await sendPendingTaskList(token, chatId);
            return res.status(200).send("OK");
        }

        if (text.startsWith("/")) {
            if (text === "/h") {
                await sendHabitsPendingMenu(token, chatId);
                return res.status(200).send("OK");
            }
            if (text === "/ld") {
                await renderListCommandPage(token, chatId, "ld", 0);
                return res.status(200).send("OK");
            }
            if (text === "/lm") {
                await renderListCommandPage(token, chatId, "lm", 0);
                return res.status(200).send("OK");
            }
            if (text === "/lv") {
                await renderListCommandPage(token, chatId, "lv", 0);
                return res.status(200).send("OK");
            }
            if (text === "/syncminutas") {
                await handleSyncMinutasCommand(token, chatId);
                return res.status(200).send("OK");
            }
            await telegramSendMessage(token, chatId, "❓ Comando no reconocido mijo. Pille echele gafa y use /help");
            return res.status(200).send("OK");
        }

        if (text.startsWith("+")) {
            const rest = text.substring(1).trim();
            if (!rest) {
                await telegramSendMessage(token, chatId, "⚠️ Escribe algo después del `+` mijo si no, no funciona!");
                return res.status(200).send("OK");
            }
            const colonIdx = rest.indexOf(":");
            let area;
            let taskName;
            if (colonIdx !== -1) {
                area = rest.slice(0, colonIdx).trim() || "Personales";
                taskName = rest.slice(colonIdx + 1).trim();
            } else {
                area = "Personales";
                taskName = rest;
            }
            if (!taskName) {
                await telegramSendMessage(
                    token,
                    chatId,
                    "⚠️ Espere un momentico joven! Indique bien el nombre de la tarea después de `:` mi rey pille algo asi `+ Trabajo: revisar correo`."
                );
                return res.status(200).send("OK");
            }
            const { name: plusName, fechaYmd: plusFechaYmd } = splitTaskTitleForNotion(taskName);
            const plusResult = await createNotionTaskPage({
                Name: plusName,
                Area: area,
                Fecha: plusFechaYmd,
            });
            const plusReply = formatTaskSavedTelegramReply(plusResult);
            await telegramSendMessage(token, chatId, plusReply.text, null, plusReply.parseMode);
            return res.status(200).send("OK");
        }

        if (text.startsWith("$")) {
            const parsed = parseDollarExpenseMessage(text);
            if (!parsed) {
                await telegramSendMessage(
                    token,
                    chatId,
                    "⚠️ Como asi? es que soy adivino? Hable claro y diga cuanto fue mijo ej. `$15000 almuerzo`."
                );
                return res.status(200).send("OK");
            }
            const { amountStr, concept } = parsed;
            const result = await createNotionExpensePage(amountStr, concept);
            if (typeof result === "string" && result.startsWith("❌")) {
                await telegramSendMessage(token, chatId, `${result} Tranqui mi papacho lo intentamos de nuevo, sumecer tranqui.`);
            } else {
                const montoNum = parseExpenseAmount(amountStr);
                const montoLabel = Number.isFinite(montoNum) ? String(montoNum) : amountStr;
                await telegramSendMessage(
                    token,
                    chatId,
                    `💸 Gasto registrado mi papacho, pero sea responsable porque se emociona y paila! $${montoLabel} por ${concept}. Recuerde que tiene que moverlo a tu presupuesto mensual en Notion.`
                );
            }
            return res.status(200).send("OK");
        }

        if (!text) {
            return res.status(200).send("OK");
        }

        const routed = await routeIntentWithGemini(text);
        const intent = String(routed.intent || "").toUpperCase();
        const data = routed.data && typeof routed.data === "object" ? routed.data : {};

        if (intent === "TASK") {
            const nameRaw = (data.Name || "").trim();
            if (!nameRaw) {
                await telegramSendMessage(token, chatId, "⚠️ No pude extraer el nombre de la tarea socio, mire donde metio el dedo y escriba bien!");
                return res.status(200).send("OK");
            }
            let { name, fechaYmd } = splitTaskTitleForNotion(nameRaw);
            if (!fechaYmd) {
                const gFecha = String(data.Fecha || "").trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(gFecha)) {
                    fechaYmd = gFecha;
                }
            }
            const geminiTaskResult = await createNotionTaskPage({
                Name: name,
                Area: data.Area || "Personales",
                Fecha: fechaYmd,
            });
            const geminiReply = formatTaskSavedTelegramReply(geminiTaskResult);
            await telegramSendMessage(token, chatId, geminiReply.text, null, geminiReply.parseMode);
            return res.status(200).send("OK");
        }

        if (intent === "NOTE") {
            const title = (data.title || "").trim() || "Nota";
            const content = data.content != null ? String(data.content) : text;
            const result = await createNotionNotePage(title, content);
            if (typeof result === "string" && result.startsWith("❌")) {
                await telegramSendMessage(token, chatId, `${result} Tranqui mi rey lo ajustamos para antier!`);
            } else {
                await telegramSendMessage(token, chatId, `📝 Nota guardada mi rey: *${title}*`);
            }
            return res.status(200).send("OK");
        }

        if (intent === "QUERY") {
            await sendPendingTaskList(token, chatId);
            return res.status(200).send("OK");
        }

        await telegramSendMessage(token, chatId, "⚠️ Uy nooo, no le entendi, mas despacio porque me pierdo! Mire donde mete el dedo e ntenta de nuevo.");
    } catch (err) {
        console.error(err);
        if (err.message && String(err.message).includes("503")) {
            await telegramSendMessage(
                token,
                chatId,
                "⚠️ Gemini no está disponible (503) y usted ya sabe que paila mi rey! Prueba mas ratico o use `Área/ tarea` o `+` para tarea rápida, ya se la sabe! hagale!"
            );
        } else {
            await telegramSendMessage(token, chatId, `⚠️ Error mijo, vealo bien y revise o me motorea y paila! ${err.message}`);
        }
    }

    return res.status(200).send("OK");
};
