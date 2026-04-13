const { GoogleGenerativeAI } = require("@google/generative-ai");
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
    updateNotionTaskStatus,
    deleteNotionTask,
} = require("./notionTaskPage");

const HABIT_WHITELIST = new Set([
    "Escrituras",
    "Oración",
    "Estiramientos",
    "Plan del día",
    "Detalle Esposa",
    "No cai",
]);

const SYSTEM_INSTRUCTION = `Eres el router de Aura AI. Analiza el mensaje del usuario y responde ÚNICAMENTE un objeto JSON válido (sin markdown, sin texto adicional) con este esquema exacto:
{"intent": "TASK"|"NOTE"|"HABIT"|"QUERY", "data": { ... }}

Reglas de clasificación:
- TASK: el usuario quiere crear o registrar una tarea, recordatorio o pendiente con posible área o fecha.
  data debe incluir: "Name" (string, título claro), "Area" (una de: Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales; por defecto Personales), "Fecha" (string YYYY-MM-DD o "" si no aplica).
- NOTE: el usuario quiere guardar una nota, idea, reflexión o texto para el inbox (no es una tarea accionable como lista de pendientes).
  data debe incluir: "title" (resumen corto), "content" (texto completo del mensaje o la nota).
- HABIT: el usuario indica que completó o marcó un hábito del día (ej. oración, escrituras).
  data debe incluir: "habitName" (string) que DEBE ser exactamente uno de: Escrituras, Oración, Estiramientos, Plan del día, Detalle Esposa, No cai. Si no coincide ninguno, elige el más cercano semánticamente dentro de esa lista.
- QUERY: el usuario pregunta qué debe hacer, qué tiene pendiente, su lista de tareas, o consulta sus pendientes sin crear nada nuevo.
  data puede ser {} o incluir campos opcionales si aclaran el filtro (no es obligatorio).

Usa la fecha/hora de "Contexto temporal" para interpretar "hoy", "mañana", "pasado mañana" y calcular Fecha en YYYY-MM-DD cuando corresponda a TASK.`;

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

async function sendPendingTaskList(token, chatId, filterArea = "") {
    const { text: listText, tasks } = await readNotionTasks(filterArea || "", "");
    const keyboard = {
        inline_keyboard: tasks.slice(0, 10).map((t, i) => [
            { text: `✅ ${i + 1}`, callback_data: `done:${t.id}` },
            { text: `🔵 ${i + 1}`, callback_data: `doing_blue:${t.id}` },
            { text: `🚀 ${i + 1}`, callback_data: `doing:${t.id}` },
            { text: `🗑️ ${i + 1}`, callback_data: `del:${t.id}` },
        ]),
    };
    await telegramSendMessage(token, chatId, listText, keyboard);
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

    if (prefixNorm === "nota") {
        if (!content) {
            await telegramSendMessage(token, chatId, "⚠️ Escribe el texto de la nota después de `nota/`.");
            return true;
        }
        const title = noteTitleFromNotaBody(content);
        const result = await createNotionNotePage(title, content);
        if (typeof result === "string" && result.startsWith("❌")) {
            await telegramSendMessage(token, chatId, result);
        } else {
            await telegramSendMessage(token, chatId, `📝 Nota guardada: *${title}*`);
        }
        return true;
    }

    if (prefixNorm === "habito") {
        if (!content) {
            await telegramSendMessage(token, chatId, "⚠️ Indica el hábito (ej. `habito/ Oración`).");
            return true;
        }
        let habitName = content.trim();
        if (!HABIT_WHITELIST.has(habitName)) {
            const lower = habitName.toLowerCase();
            const match = [...HABIT_WHITELIST].find((h) => h.toLowerCase() === lower);
            habitName = match || habitName;
        }
        const habitResult = await markHabitAsDone(habitName);
        await telegramSendMessage(token, chatId, habitResult);
        return true;
    }

    if (prefixNorm === "m" || prefixNorm === "minuta") {
        if (!content) {
            await telegramSendMessage(
                token,
                chatId,
                "⚠️ Escribe el título de la minuta después de `m/` o `minuta/` (ej. `m/ Reunión Obispado`)."
            );
            return true;
        }
        const result = await createNotionMinutePage(content);
        if (typeof result === "string" && result.startsWith("❌")) {
            await telegramSendMessage(token, chatId, result);
        } else {
            await telegramSendMessage(token, chatId, `📋 Minuta registrada: *${content}*`);
        }
        return true;
    }

    if (prefixNorm === "act" || prefixNorm === "actividad") {
        if (!content) {
            await telegramSendMessage(
                token,
                chatId,
                "⚠️ Escribe el nombre después de `act/` o `actividad/` (ej. `act/ Noche de talentos`)."
            );
            return true;
        }
        const result = await createNotionActivityPage(content);
        if (typeof result === "string" && result.startsWith("❌")) {
            await telegramSendMessage(token, chatId, result);
        } else {
            await telegramSendMessage(token, chatId, `📌 Actividad creada (Planificación): *${content}*`);
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
            "⚠️ Escribe la tarea después de `/` (ej. `Iglesia/ Leer`)."
        );
        return true;
    }

    await createNotionTaskPage({ Name: content, Area: prefix });
    await telegramSendMessage(
        token,
        chatId,
        `✅ Tarea creada: *${content}* (${normalizeNotionArea(prefix)})`
    );
    return true;
}

async function routeIntentWithGemini(userText) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const nowBogota = new Date().toLocaleString("en-US", { timeZone: "America/Bogota" });
    const userPayload = `Contexto temporal (America/Bogota): ${nowBogota}\n\nMensaje del usuario:\n${userText}`;

    const runModel = async (modelId) => {
        const model = genAI.getGenerativeModel({
            model: modelId,
            systemInstruction: SYSTEM_INSTRUCTION,
            generationConfig: { responseMimeType: "application/json" },
        });
        const result = await model.generateContent(userPayload);
        return parseGeminiJson(result.response.text());
    };

    try {
        return await runModel("gemini-2.5-flash");
    } catch (apiErr) {
        if (apiErr.message && String(apiErr.message).includes("503")) {
            return await runModel("gemini-1.5-flash");
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
        const [action, pageId] = cb.data.split(":");
        if (action === "del") {
            const reply = await deleteNotionTask(pageId, true);
            await telegramSendMessage(token, cb.message.chat.id, reply);
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
                ? `🔵 Tarea en curso: ${result.taskName}`
                : result.text;
        await telegramSendMessage(token, cb.message.chat.id, messageText);
        return res.status(200).send("OK");
    }

    if (!message) return res.status(200).send("OK");
    const chatId = message.chat.id;
    const text = (message.text || "").trim();

    try {
        if (message.voice) {
            await telegramSendMessage(token, chatId, "🎙️ Solo proceso *texto*. Escribe tu mensaje o usa /help.");
            return res.status(200).send("OK");
        }

        if (text === "/start") {
            await telegramSendMessage(
                token,
                chatId,
                "🚀 Aura AI Online. Usa `Área/ tarea`, `nota/`, `habito/` o /lista. /help para el manual."
            );
            return res.status(200).send("OK");
        }

        if (text === "/help") {
            const helpHtml =
                "<b>📖 Manual de Aura AI v2.5</b>\n\n" +
                "<b>🛠 Gestión de Tareas</b>\n" +
                "- <code>Área/ Tarea</code> → Crea tarea.\n" +
                "- <code>Área/ ver</code> → Filtra pendientes.\n" +
                "- <code>/lista</code> → Ver todos los pendientes.\n\n" +
                "<b>⛪ Segunda Consejería</b>\n" +
                "- <code>m/ [Título]</code> → Crea minuta de reunión.\n" +
                "- <code>act/ [Nombre]</code> → Nueva actividad.\n\n" +
                "<b>📝 Notas y Hábitos</b>\n" +
                "- <code>Nota/ [Texto]</code> → Envía a Inbox.\n" +
                "- <code>Habito/ [Nombre]</code> → Marca hábito de hoy.\n\n" +
                "<b>💰 Finanzas</b>\n" +
                "- <code>$ [Monto] [Concepto]</code> → Registro de gasto.\n\n" +
                "<b>🔘 Botones de Acción</b>\n" +
                "✅ Hecho | 🔵 Haciendo | 🚀 Pausar | 🗑️ Eliminar\n\n" +
                "<i>Nota: Para tareas de la Iglesia, usa el prefijo Iglesia/.</i>";
            await telegramSendMessage(token, chatId, helpHtml, null, "HTML");
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
            if (text === "/lista") {
                await sendPendingTaskList(token, chatId);
                return res.status(200).send("OK");
            }
            await telegramSendMessage(token, chatId, "❓ Comando no reconocido. Usa /help o /lista.");
            return res.status(200).send("OK");
        }

        if (text.startsWith("+")) {
            const rest = text.substring(1).trim();
            if (!rest) {
                await telegramSendMessage(token, chatId, "⚠️ Escribe algo después del +.");
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
                    "⚠️ Indica el nombre de la tarea después de `:` (ej. `+ Trabajo: revisar correo`)."
                );
                return res.status(200).send("OK");
            }
            await createNotionTaskPage({ Name: taskName, Area: area });
            await telegramSendMessage(
                token,
                chatId,
                `✅ Tarea creada: *${taskName}* (${normalizeNotionArea(area)})`
            );
            return res.status(200).send("OK");
        }

        if (text.startsWith("$")) {
            const parsed = parseDollarExpenseMessage(text);
            if (!parsed) {
                await telegramSendMessage(
                    token,
                    chatId,
                    "⚠️ Tras `$` indica un monto (ej. `$15000 almuerzo`)."
                );
                return res.status(200).send("OK");
            }
            const { amountStr, concept } = parsed;
            const result = await createNotionExpensePage(amountStr, concept);
            if (typeof result === "string" && result.startsWith("❌")) {
                await telegramSendMessage(token, chatId, result);
            } else {
                const montoNum = parseExpenseAmount(amountStr);
                const montoLabel = Number.isFinite(montoNum) ? String(montoNum) : amountStr;
                await telegramSendMessage(
                    token,
                    chatId,
                    `💸 Gasto registrado en Inbox: $${montoLabel} por ${concept}. Recuerda moverlo a tu presupuesto mensual en Notion.`
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
            const name = (data.Name || "").trim();
            if (!name) {
                await telegramSendMessage(token, chatId, "⚠️ No pude extraer el nombre de la tarea.");
                return res.status(200).send("OK");
            }
            await createNotionTaskPage({
                Name: name,
                Area: data.Area || "Personales",
                Fecha: data.Fecha || "",
            });
            await telegramSendMessage(
                token,
                chatId,
                `✅ Tarea creada: *${name}* (${normalizeNotionArea(data.Area || "Personales")})`
            );
            return res.status(200).send("OK");
        }

        if (intent === "NOTE") {
            const title = (data.title || "").trim() || "Nota";
            const content = data.content != null ? String(data.content) : text;
            const result = await createNotionNotePage(title, content);
            if (typeof result === "string" && result.startsWith("❌")) {
                await telegramSendMessage(token, chatId, result);
            } else {
                await telegramSendMessage(token, chatId, `📝 Nota guardada: *${title}*`);
            }
            return res.status(200).send("OK");
        }

        if (intent === "HABIT") {
            let habitName = (data.habitName || "").trim();
            if (!habitName) {
                await telegramSendMessage(token, chatId, "⚠️ No identifiqué el hábito.");
                return res.status(200).send("OK");
            }
            if (!HABIT_WHITELIST.has(habitName)) {
                const lower = habitName.toLowerCase();
                const match = [...HABIT_WHITELIST].find((h) => h.toLowerCase() === lower);
                habitName = match || habitName;
            }
            const habitResult = await markHabitAsDone(habitName);
            await telegramSendMessage(token, chatId, habitResult);
            return res.status(200).send("OK");
        }

        if (intent === "QUERY") {
            await sendPendingTaskList(token, chatId);
            return res.status(200).send("OK");
        }

        await telegramSendMessage(token, chatId, "⚠️ Respuesta del asistente no reconocida. Intenta de nuevo.");
    } catch (err) {
        console.error(err);
        if (err.message && String(err.message).includes("503")) {
            await telegramSendMessage(
                token,
                chatId,
                "⚠️ Gemini no está disponible (503). Prueba en un momento o usa `Área/ tarea` o `+` para tarea rápida."
            );
        } else {
            await telegramSendMessage(token, chatId, `⚠️ Error: ${err.message}`);
        }
    }

    return res.status(200).send("OK");
};
