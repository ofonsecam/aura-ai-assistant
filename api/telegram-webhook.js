const {
    createNotionTaskPage,
    createNotionNotePage,
    createNotionExpensePage,
    createNotionMinutePage,
    createNotionActivityPage,
    parseExpenseAmount,
    markHabitAsDone,
    normalizeNotionArea,
    readNotionTasks,
    getDailyTasks,
    getWeeklyTasks,
    getMonthTasks,
    getOverdueTasks,
    rescheduleTaskDateByPageId,
    updateNotionTaskStatus,
    deleteNotionTask,
    ensureDailyHabitPage,
    getHabitsDatabaseNotionUrl,
    parseTaskText,
    taskDateToBogotaYmd,
} = require("./notionTaskPage");

function getBogotaReferenceTimeMmDdYy() {
    const ref = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    const mm = String(ref.getMonth() + 1).padStart(2, "0");
    const dd = String(ref.getDate()).padStart(2, "0");
    const yy = String(ref.getFullYear()).slice(-2);
    return `${mm}-${dd}-${yy}`;
}

function buildSystemInstruction(referenceTimeMmDdYy) {
    return `Eres el router de Aura AI. Analiza el mensaje del usuario y responde ÚNICAMENTE un objeto JSON válido (sin markdown, sin texto adicional) con este esquema exacto:
{"intent": "TASK"|"NOTE"|"HABIT"|"QUERY", "data": { ... }}

Reglas de clasificación:
- TASK: el usuario quiere crear o registrar una tarea, recordatorio o pendiente con posible área o fecha.
  data debe incluir: "Name" (string, título claro; puede incluir fecha en lenguaje natural, el servidor la separa), "Area" (una de: Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales; por defecto Personales), "Fecha" (string YYYY-MM-DD o "" si no aplica; si Name ya trae la fecha natural, puedes dejar Fecha en "").
- NOTE: el usuario quiere guardar una nota, idea, reflexión o texto para el inbox (no es una tarea accionable como lista de pendientes).
  data debe incluir: "title" (resumen corto), "content" (texto completo del mensaje o la nota).
- HABIT: el usuario indica que completó o marcó un hábito del día (ej. oración, escrituras).
  data debe incluir: "habitName" (string, nombre del hábito tal como lo dice; el servidor lo cruzará con las columnas checkbox de Notion).
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

/** Cuerpo /help (HTML mínimo: solo el título en <b> para evitar Entity_parse_failed). */
const helpMessage = `
<b>📖 Manual de Aura AI v2.5</b>

🛠 Gestión de Tareas

Área/ Tarea → Crea tarea

Área/ ver → Filtra pendientes

/listad → Ver tareas del día (hoy)

/listas → Ver tareas de la semana actual

/listam → Ver tareas del mes actual

/listav → Ver tareas vencidas

/reprograma [n] [fecha natural] → Reprograma la tarea n de la lista mensual

⛪ Segunda Consejería

m/ [Título] → Crea minuta

act/ [Nombre] → Nueva actividad

📝 Notas y Hábitos

Nota/ [Texto] → Envía a Inbox

Habito/ [Nombre] → Marca hábito hoy

💰 Finanzas

$ [Monto] [Concepto] → Registro gasto

🔘 Botones de Acción
✅ Hecho | 🔵 Haciendo | 🚀 Pausar | 🗑️ Eliminar

Nota: Para Iglesia, usa el prefijo Iglesia/.`;

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
                { text: "✅ Hecho", callback_data: `itask_done:${pageId}` },
                { text: "⏸ Pausa", callback_data: `itask_pause:${pageId}` },
            ],
            [
                { text: "📅 Reprogramar", callback_data: `itask_reschedule:${pageId}` },
                { text: "🗑 Borrar", callback_data: `itask_delete:${pageId}` },
            ],
        ],
    };
}

/**
 * Respuesta de éxito/error tras crear tarea en Notion (Database ID, ID página, enlace API).
 * @param {{ ok: true, id: string, url: string, databaseId: string, databaseName: string } | { ok: false, error: string }} result
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
    const dbId = esc(result.databaseId || "");
    const pageId = esc(result.id || "");
    const url = typeof result.url === "string" ? result.url.trim() : "";
    const linkLine = url
        ? `<a href="${escAttr(url)}">Abrir en Notion</a>`
        : "<i>Sin URL en la respuesta de la API.</i>";
    const text = [
        "✅ Got it mi papacho sumercer tranquilo my homie.",
        `<b>Database ID:</b> <code>${dbId}</code>`,
        `<b>ID página:</b> <code>${pageId}</code>`,
        linkLine,
    ].join("\n");
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

/** Quita tildes para comparar habito/hábito/Hábito de forma uniforme. */
function stripDiacritics(str) {
    return String(str)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

/** true si el prefijo es habito o hábito (sin importar mayúsculas/acentos). */
function isHabitSlashPrefix(parsed) {
    if (!parsed) return false;
    return stripDiacritics(parsed.prefix).toLowerCase() === "habito";
}

/**
 * Prioridad: antes de Area/ tarea. Solo prefijos habito/ y hábito/ (acentos opcionales).
 * @returns {Promise<boolean>} true si el mensaje era comando de hábito.
 */
async function tryHandleHabitSlashCommand(token, chatId, text) {
    const parsed = parseInlineSlashPrefix(text);
    if (!isHabitSlashPrefix(parsed)) return false;

    if (!parsed.content.trim()) {
        await telegramSendMessage(token, chatId, "⚠️ Indica el hábito, mi rey no sea asi, colaboreme pille algo como `habito/ Oración`.");
        return true;
    }

    const habitName = parsed.content.trim();
    let dailyResult;
    try {
        dailyResult = await ensureDailyHabitPage();
    } catch (e) {
        await telegramSendMessage(token, chatId, `${e.message || String(e)} Tranqui mi rey, lo checamos asap!.`);
        return true;
    }
    if (!dailyResult?.ok || !dailyResult.page_id) {
        await telegramSendMessage(token, chatId, "❌ No pude asegurar la página diaria de hábitos mi rey ay me disculparas ala carachas.");
        return true;
    }

    const markResult = await markHabitAsDone(habitName, dailyResult.page_id);
    if (!markResult.ok) {
        await telegramSendMessage(token, chatId, `${markResult.message} Tranqui mi papacho lo ajustamos sumercito rela.`);
        return true;
    }

    const habitsLink = getHabitsDatabaseNotionUrl();
    let msg = `✅ Hábito ${markResult.resolvedName} Registrado my littele associated!.`;
    if (habitsLink) msg += `\n${habitsLink}`;
    await telegramSendMessage(token, chatId, msg);
    return true;
}

async function sendHabitIntentResult(token, chatId, habitName) {
    let dailyResult;
    try {
        dailyResult = await ensureDailyHabitPage();
    } catch (e) {
        await telegramSendMessage(token, chatId, `${e.message || String(e)} Tranqui mi rey lo revisamos para antier!.`);
        return;
    }
    if (!dailyResult?.ok || !dailyResult.page_id) {
        await telegramSendMessage(token, chatId, "❌ No pude asegurar la página diaria de hábitos mi rey mala mia, pero reviselo!");
        return;
    }
    const markResult = await markHabitAsDone(habitName, dailyResult.page_id);
    if (!markResult.ok) {
        await telegramSendMessage(token, chatId, `${markResult.message} Tranqui mi papacho lo ajustamos ya mismo!.`);
        return;
    }
    const habitsLink = getHabitsDatabaseNotionUrl();
    let msg = `✅ Hábito ${markResult.resolvedName} Registrado my little associated!`;
    if (habitsLink) msg += `\n${habitsLink}`;
    await telegramSendMessage(token, chatId, msg);
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
        if (!content) {
            await telegramSendMessage(
                token,
                chatId,
                "⚠️ Escriba completo el título de la minuta después de `m/` o `minuta/` mijo pille algo como `m/ Reunión Obispado`."
            );
            return true;
        }
        const result = await createNotionMinutePage(content);
        if (typeof result === "string" && result.startsWith("❌")) {
            await telegramSendMessage(token, chatId, `${result} Tranqui mi rey, lo ajustamos.`);
        } else {
            await telegramSendMessage(token, chatId, `📋 Minuta registrada mijo, pero revisela y hagale! *${content}*`);
        }
        return true;
    }

    if (prefixNorm === "act" || prefixNorm === "actividad") {
        if (!content) {
            await telegramSendMessage(
                token,
                chatId,
                "⚠️ Como asi? Escriba el nombre después de `act/` o `actividad/` mi papacho tratame serio ej. `act/ Noche de talentos`."
            );
            return true;
        }
        const result = await createNotionActivityPage(content);
        if (typeof result === "string" && result.startsWith("❌")) {
            await telegramSendMessage(token, chatId, `${result} Tranqui mi rey lo ajustamos ya mismo!`);
        } else {
            await telegramSendMessage(token, chatId, `📌 Actividad creada mi papacho, vaya y revise que le falta! *${content}*`);
        }
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
            cbData.startsWith("itask_pause:") ||
            cbData.startsWith("itask_reschedule:") ||
            cbData.startsWith("itask_delete:")
        ) {
            const [action, pageId] = cbData.split(":");
            if (!pageId) {
                await telegramAnswerCallbackQuery(token, cb.id, "No pude identificar la tarea aprende a tratarme serio!");
                return res.status(200).send("OK");
            }

            if (action === "itask_done") {
                const result = await updateNotionTaskStatus(pageId, "Hecho", true);
                await telegramSendMessage(
                    token,
                    cb.message.chat.id,
                    result.ok
                        ? `✅ Tarea completada mi rey! Asi se hace! no le baje que ya casi!: ${result.taskName}`
                        : `❌ No pude completar la tarea mi papacho mala mia... pereme me ajusto y lo intentamos de nuevo! ${result.text || ""}`.trim()
                );
                await telegramAnswerCallbackQuery(token, cb.id);
                return res.status(200).send("OK");
            }

            if (action === "itask_pause") {
                const result = await updateNotionTaskStatus(pageId, "Pausado", true);
                await telegramSendMessage(
                    token,
                    cb.message.chat.id,
                    result.ok
                        ? `⏸ Tarea pausada mi rey: ${result.taskName}`
                        : `❌ No pude pausar la tarea, mijo, intentele de nuevo! ${result.text || ""}`.trim()
                );
                await telegramAnswerCallbackQuery(token, cb.id);
                return res.status(200).send("OK");
            }

            if (action === "itask_delete") {
                const reply = await deleteNotionTask(pageId, true);
                await telegramSendMessage(
                    token,
                    cb.message.chat.id,
                    String(reply || "").startsWith("❌")
                        ? `${reply} Tranqui mi rey lo intentamos de nuevo para antier!`
                        : `${reply} Listo mi papacho usted sabe como soy yo!`
                );
                await telegramAnswerCallbackQuery(token, cb.id);
                return res.status(200).send("OK");
            }

            const actionKey = `${cb.message.chat.id}:${cb.message.message_id}`;
            const taskCtx = interactiveTaskActionContext.get(actionKey) || null;
            const forceReply = { force_reply: true, selective: true };
            const promptMsg = await telegramSendMessageAndGetResult(
                token,
                cb.message.chat.id,
                MANAGE_TASK_RESCHEDULE_PROMPT,
                forceReply
            );
            const ctxKey = `${cb.message.chat.id}:${promptMsg.message_id}`;
            interactiveRescheduleContext.set(ctxKey, {
                pageId,
                taskName: taskCtx?.taskName || "Tarea",
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
                "🚀 Aura AI Online mi papacho. Usa `Área/ tarea`, `nota/`, `habito/`, `/listam` o `/listav`. /help para el manual, pero haga algo! no se quede mirando que no esta en venta!"
            );
            return res.status(200).send("OK");
        }

        if (text === "/help") {
            await telegramSendMessage(token, chatId, helpMessage.trim(), null, "HTML");
            return res.status(200).send("OK");
        }

        if (await tryHandleHabitSlashCommand(token, chatId, text)) {
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
            const reprogramaMatch = text.match(/^\/reprogramar?\s+(\d+)\s+(.+)$/i);
            if (reprogramaMatch) {
                const taskIndex = Number(reprogramaMatch[1]) - 1;
                const naturalDateText = reprogramaMatch[2].trim();
                const { tasks } = await getMonthTasks();

                if (taskIndex < 0 || taskIndex >= tasks.length) {
                    await telegramSendMessage(token, chatId, `❌ Índice inválido mijo! Pero que esta haciendo? Use un número entre 1 y ${tasks.length || 1}.`);
                    return res.status(200).send("OK");
                }

                const selectedTask = tasks[taskIndex];
                const pageId = selectedTask?.id;
                const result = await rescheduleTaskDateByPageId(pageId, naturalDateText);
                if (!result.ok) {
                    await telegramSendMessage(token, chatId, `${result.error} Tranqui mi rey lo volvemos a intentar ya mismo!`);
                    return res.status(200).send("OK");
                }

                await telegramSendMessage(
                    token,
                    chatId,
                    `✅ Tarea reprogramada, mi rey: ${selectedTask.name}\nNueva fecha: ${result.dateYmd}`
                );
                return res.status(200).send("OK");
            }
            if (text === "/listad") {
                const { tasks } = await getDailyTasks();
                const messageText = `📅 Tareas de hoy:\n${formatSequentialTaskStatusList(tasks)}`;
                await telegramSendMessage(token, chatId, messageText, buildInteractiveManageKeyboard("manage_day"));
                return res.status(200).send("OK");
            }
            if (text === "/listas") {
                const { tasks } = await getWeeklyTasks();
                const messageText = `🗓️ Tareas de esta semana:\n${formatSequentialTaskStatusList(tasks)}`;
                await telegramSendMessage(token, chatId, messageText, buildInteractiveManageKeyboard("manage_week"));
                return res.status(200).send("OK");
            }
            if (text === "/listam") {
                const { tasks } = await getMonthTasks();
                const messageText = `🗓️ Tareas de este mes:\n${formatSequentialTaskStatusList(tasks)}`;
                await telegramSendMessage(token, chatId, messageText, buildInteractiveManageKeyboard("manage_month"));
                return res.status(200).send("OK");
            }
            if (text === "/listav") {
                const overduePages = await getOverdueTasks();
                const overdueTasks = mapOverduePagesToTasks(overduePages);
                const messageText = `⚠️ Tareas vencidas:\n${formatSequentialTaskStatusList(overdueTasks)}`;
                await telegramSendMessage(token, chatId, messageText, buildInteractiveManageKeyboard("manage_overdue"));
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

        if (intent === "HABIT") {
            let habitName = (data.habitName || "").trim();
            if (!habitName) {
                await telegramSendMessage(token, chatId, "⚠️ No identifiqué el hábito mi papacho, como dices que dijiste?");
                return res.status(200).send("OK");
            }
            await sendHabitIntentResult(token, chatId, habitName);
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
