const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
    createNotionTaskPage,
    readNotionTasks,
    updateNotionTaskStatus,
    deleteNotionTask,
} = require("./notionTaskPage");

// Helper to send normal text message
async function telegramSendMessage(token, chatId, text, extra = {}) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, ...extra }),
    });
}

// Helper for inline keyboard with Markdown
async function telegramSendTaskList(token, chatId, notionTasks) {
    // notionTasks is an array of task objects [{pageId, name, estado}]
    // Format: - {name} ({estado})
    let message = "📋 Tus tareas:\n";
    if (!notionTasks.length) {
        message += "🔍 Sin pendientes.";
        await telegramSendMessage(token, chatId, message);
        return;
    }
    message += notionTasks
        .map((t, i) => `- ${t.name} (${t.estado})`)
        .join("\n");

    // Inline keyboard: for each task, one row with three buttons
    const inline_keyboard = notionTasks.map((t) => [
        {
            text: "✅ Hecho",
            callback_data: `done:${t.pageId}`
        },
        {
            text: "⏸️ Pausar",
            callback_data: `pause:${t.pageId}`
        },
        {
            text: "🗑️ Borrar",
            callback_data: `delete:${t.pageId}`
        }
    ]);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            reply_markup: JSON.stringify({ inline_keyboard })
        })
    });
}

// Helper to answer callback query (shows small toast in Telegram)
async function telegramAnswerCallbackQuery(token, callbackQueryId, text = "✅ Actualizado") {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    });
}

// To retrieve tasks with pageId for inline keyboard UI
async function getNotionTasksForInline(filterArea, filterDate) {
    // Re-implementing, since readNotionTasks returns formatted text
    // So we call Notion API manually
    const { NOTION_DATABASE_ID: databaseId, NOTION_TOKEN: notionToken } = process.env;
    const filters = [];
    if (filterArea) filters.push({ property: 'Area', select: { equals: filterArea } });
    if (filterDate) filters.push({ property: 'Fecha', date: { equals: filterDate } });
    if (filters.length === 0) filters.push({ property: 'Estado', select: { does_not_equal: 'Hecho' } });
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            filter: filters.length === 1 ? filters[0] : { and: filters }
        })
    });
    const data = await res.json();
    if (!data.results?.length) return [];
    return data.results.map(p => {
        return {
            pageId: p.id,
            name: p.properties["Name"]?.title?.[0]?.text?.content || "Sin título",
            estado: p.properties["Estado"]?.select?.name || "---"
        };
    });
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("OK");

    // --- HANDLE CALLBACK_QUERY ---
    if (req.body?.callback_query) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const callback = req.body.callback_query;
        const data = callback.data || "";
        const chatId = callback.message.chat.id;
        const callbackQueryId = callback.id;
        let [action, pageId] = data.split(":");
        action = action?.trim();
        pageId = pageId?.trim();
        try {
            if (action && pageId) {
                if (action === "done") {
                    await updateNotionTaskStatus(pageId, "Hecho", true); // true = by pageId (see below)
                } else if (action === "pause") {
                    await updateNotionTaskStatus(pageId, "Pausado", true);
                } else if (action === "delete") {
                    // deleteNotionTask support by pageId
                    await deleteNotionTask(pageId, true);
                }
            }
            await telegramAnswerCallbackQuery(token, callbackQueryId, "✅ Actualizado");
        } catch (err) {
            await telegramAnswerCallbackQuery(token, callbackQueryId, "❌ Error");
        }
        return res.status(200).send("OK");
    }

    // --- Normal Telegram message workflow ---
    const message = req.body?.message;
    if (!message) return res.status(200).send("OK");

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = message.chat.id;
    let text = (typeof message.text === "string" ? message.text.trim() : "");

    try {
        // --- 1. COMANDOS INSTANTÁNEOS (Costo 0 IA) ---
        if (text === "/start") {
            await telegramSendMessage(
                token,
                chatId,
                "🚀 Aura AI Online.\n\nEnvía /help o 'ayuda' para ver el menú completo.\n\nUsa /lista para ver pendientes.\nUsa 'hecho [nombre]' para completar.\nUsa '+ [nombre]' para creación rápida.\nO envía un audio para procesar con IA."
            );
            return res.status(200).send("OK");
        }

        // --- NUEVO: MENSAJE DE AYUDA GENERAL (/help o "ayuda") ---
        if (/^\/help$|^ayuda$/i.test(text)) {
            const helpMsg =
                "📝 *Gestión*: /lista, hecho [nombre], pausar [nombre], borrar [nombre].\n" +
                "\n⚡ *Creación Rápida*: + [nombre].\n" +
                "\n🎙️ *IA*: Envía un audio o texto complejo para que Gemini lo procese.";
            await telegramSendMessage(token, chatId, helpMsg);
            return res.status(200).send("OK");
        }

        // --- 2. BYPASS DE IA: Filtros Manuales (Ahorro de Cuota) ---
        if (text.length > 0) {
            // Lectura rápida de tareas
            if (/^\/?lista$|^ver$|^tareas$/i.test(text)) {
                const taskObjs = await getNotionTasksForInline("", "");
                await telegramSendTaskList(token, chatId, taskObjs);
                return res.status(200).send("OK");
            }

            // Marcado rápido: Cambiar a 'Hecho'
            let hechoMatch = text.match(/^hecho\s+(.+)/i);
            if (hechoMatch) {
                const reply = await updateNotionTaskStatus(hechoMatch[1].trim(), "Hecho");
                await telegramSendMessage(token, chatId, reply);
                return res.status(200).send("OK");
            }

            // NUEVO: PAUSAR tarea: Si empieza con "pausar ", cambia a 'Pausado'.
            let pausarMatch = text.match(/^pausar\s+(.+)/i);
            if (pausarMatch) {
                const reply = await updateNotionTaskStatus(pausarMatch[1].trim(), "Pausado");
                await telegramSendMessage(token, chatId, reply);
                return res.status(200).send("OK");
            }

            // NUEVO: BORRADO RÁPIDO: Si empieza con "borrar ", elimina la tarea.
            let borrarMatch = text.match(/^borrar\s+(.+)/i);
            if (borrarMatch) {
                const taskName = borrarMatch[1].trim();
                const reply = await deleteNotionTask(taskName);
                await telegramSendMessage(token, chatId, reply);
                return res.status(200).send("OK");
            }

            // CREACIÓN RÁPIDA: Si empieza con + o /crear, no usa IA.
            let createMatch = text.match(/^(\+|\/crear)\s+(.+)/i);
            if (createMatch) {
                const taskName = createMatch[2].trim();
                const fastTask = { Name: taskName, Area: "Personales", Fecha: "" };
                await createNotionTaskPage(fastTask);
                await telegramSendMessage(token, chatId, `⚡ [Rápida] Tarea creada: "${taskName}" en Personales.`);
                return res.status(200).send("OK");
            }
        }

        // --- 3. PROCESAMIENTO CON IA (Solo audios o textos complejos) ---
        let geminiInputPart = null;

        if (message.voice?.file_id) {
            const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${message.voice.file_id}`);
            const getFileJson = await getFileRes.json();
            const filePath = getFileJson.result.file_path;
            const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
            const arrayBuffer = await fileRes.arrayBuffer();
            geminiInputPart = {
                inlineData: {
                    data: Buffer.from(arrayBuffer).toString("base64"),
                    mimeType: "audio/ogg"
                }
            };
        } else if (text) {
            geminiInputPart = { text };
        } else {
            return res.status(200).send("OK"); // Nada que procesar
        }

        // --- LLAMADA A GEMINI ---
        const systemPrompt = `Intent Router. Today: 2026-04-04. Output RAW JSON.
        Areas: Trabajo secundario, Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales.
        JSON Keys: 
        - CREATE: "Name", "Area", "Fecha"(YYYY-MM-DD)
        - READ: "FilterArea", "FilterDate"
        - UPDATE: "SearchName", "NewStatus"("Pausado","Hecho","Haciendo","Pendiente")`;

        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                generationConfig: { responseMimeType: "application/json" },
            });

            const result = await model.generateContent([systemPrompt, geminiInputPart]);
            const taskData = JSON.parse(await result.response.text());

            switch (taskData.Intent) {
                case "CREATE":
                    await createNotionTaskPage(taskData);
                    await telegramSendMessage(token, chatId, `✅ Tarea creada: ${taskData.Name} (${taskData.Area})`);
                    break;
                case "READ":
                    {
                        const taskObjs = await getNotionTasksForInline(
                            taskData.FilterArea,
                            taskData.FilterDate
                        );
                        await telegramSendTaskList(token, chatId, taskObjs);
                    }
                    break;
                case "UPDATE":
                    const updateMsg = await updateNotionTaskStatus(taskData.SearchName, taskData.NewStatus);
                    await telegramSendMessage(token, chatId, updateMsg);
                    break;
                default:
                    await telegramSendMessage(token, chatId, "🤖 No pude determinar la acción.");
            }
        } catch (gemErr) {
            // Manejo de cuota agotada (Error 429)
            if (gemErr.status === 429 || gemErr.message?.includes("429")) {
                await telegramSendMessage(token, chatId, "⚠️ Cuota de IA agotada por hoy. Usa comandos manuales (+ tarea, hecho nombre, /lista) hasta mañana.");
            } else {
                throw gemErr;
            }
        }
    } catch (err) {
        console.error("Critical Webhook Error:", err);
        await telegramSendMessage(token, chatId, "❌ Error crítico. Revisa los logs de Vercel.");
    }

    return res.status(200).send("OK");
};