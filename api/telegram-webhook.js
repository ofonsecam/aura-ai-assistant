const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
    createNotionTaskPage,
    createNotionNotePage,
    markHabitAsDone,
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

async function telegramSendMessage(token, chatId, text, replyMarkup = null) {
    const body = { chat_id: chatId, text, parse_mode: "Markdown" };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

async function sendPendingTaskList(token, chatId) {
    const { text: listText, tasks } = await readNotionTasks("", "");
    const keyboard = {
        inline_keyboard: tasks.slice(0, 10).map((t, i) => [
            { text: `✅ ${i + 1}`, callback_data: `done:${t.id}` },
            { text: `🚀 ${i + 1}`, callback_data: `doing:${t.id}` },
            { text: `🗑️ ${i + 1}`, callback_data: `del:${t.id}` },
        ]),
    };
    await telegramSendMessage(token, chatId, listText, keyboard);
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
        const status = action === "done" ? "Hecho" : action === "doing" ? "Haciendo" : "Pausado";
        const reply =
            action === "del" ? await deleteNotionTask(pageId, true) : await updateNotionTaskStatus(pageId, status, true);
        await telegramSendMessage(token, cb.message.chat.id, reply);
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
                "🚀 Aura AI Online. Escribe lo que necesites (tarea, nota, hábito o consulta) o usa /lista y /help."
            );
            return res.status(200).send("OK");
        }

        if (text === "/help") {
            await telegramSendMessage(
                token,
                chatId,
                "📖 **Manual de Aura AI**\n\n" +
                    "- `/lista`: Ver pendientes con botones.\n" +
                    "- `+ tarea`: Creación rápida (Personales).\n" +
                    "- **Texto libre**: el asistente decide si es tarea, nota, hábito o consulta."
            );
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
            const taskName = text.substring(1).trim();
            if (!taskName) {
                await telegramSendMessage(token, chatId, "⚠️ Escribe algo después del +.");
                return res.status(200).send("OK");
            }
            await createNotionTaskPage({ Name: taskName, Area: "Personales" });
            await telegramSendMessage(token, chatId, `✅ Tarea rápida creada: ${taskName}`);
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
            await telegramSendMessage(token, chatId, `✅ Tarea creada: *${name}*`);
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
                "⚠️ Gemini no está disponible (503). Prueba en un momento o usa `+` para una tarea rápida."
            );
        } else {
            await telegramSendMessage(token, chatId, `⚠️ Error: ${err.message}`);
        }
    }

    return res.status(200).send("OK");
};
