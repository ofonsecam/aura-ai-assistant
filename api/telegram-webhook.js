const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createNotionTaskPage, readNotionTasks, updateNotionTaskStatus, deleteNotionTask } = require("./notionTaskPage");

async function telegramSendMessage(token, chatId, text, replyMarkup = null) {
    const body = { chat_id: chatId, text, parse_mode: "Markdown" };
    if (replyMarkup) body.reply_markup = replyMarkup;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

async function answerCallback(token, callbackQueryId, text) {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("OK");

    const token = process.env.TELEGRAM_BOT_TOKEN;

    // Manejar clics en botones (Callback Queries)
    if (req.body.callback_query) {
        const cb = req.body.callback_query;
        const [action, pageId] = cb.data.split(':');
        let reply = "";

        if (action === "done") reply = await updateNotionTaskStatus(pageId, "Hecho", true);
        else if (action === "pause") reply = await updateNotionTaskStatus(pageId, "Pausado", true);
        else if (action === "doing") reply = await updateNotionTaskStatus(pageId, "Haciendo", true);
        else if (action === "del") reply = await deleteNotionTask(pageId, true);

        await answerCallback(token, cb.id, "Procesado");
        await telegramSendMessage(token, cb.message.chat.id, reply);
        return res.status(200).send("OK");
    }

    const message = req.body?.message;
    if (!message) return res.status(200).send("OK");
    const chatId = message.chat.id;
    let text = (typeof message.text === "string" ? message.text.trim() : "");

    try {
        if (text === "/start") {
            await telegramSendMessage(token, chatId, "🚀 Aura AI Online. Usa /lista para gestionar con botones o /help para comandos.");
            return res.status(200).send("OK");
        }

        if (text === "/help") {
            await telegramSendMessage(token, chatId, "📖 **Manual de Aura AI**\n\n- `/lista`: Ver tareas con botones.\n- `+ [tarea]`: Creación rápida.\n- `hecho [nombre]`: Marcar como hecho.\n- `borrar [nombre]`: Eliminar tarea.\n- 🎙️ Envía audios para crear tareas complejas.");
            return res.status(200).send("OK");
        }

        // --- BYPASS DE IA: Comandos Manuales ---
        if (text.length > 0) {
            if (/^\/?lista$|^ver$|^tareas$/i.test(text)) {
                const { text: listText, tasks } = await readNotionTasks("", "");
                const keyboard = {
                    inline_keyboard: tasks.map((t, i) => [
                        { text: `✅ ${i + 1}`, callback_data: `done:${t.id}` },
                        { text: `🚀 ${i + 1}`, callback_data: `doing:${t.id}` },
                        { text: `⏸️ ${i + 1}`, callback_data: `pause:${t.id}` },
                        { text: `🗑️ ${i + 1}`, callback_data: `del:${t.id}` }
                    ])
                };
                await telegramSendMessage(token, chatId, listText, keyboard);
                return res.status(200).send("OK");
            }

            let hechoMatch = text.match(/^hecho\s+(.+)/i);
            if (hechoMatch) {
                const reply = await updateNotionTaskStatus(hechoMatch[1].trim(), "Hecho");
                await telegramSendMessage(token, chatId, reply);
                return res.status(200).send("OK");
            }

            let createMatch = text.match(/^(\+|\/crear)\s+(.+)/i);
            if (createMatch) {
                await createNotionTaskPage({ Name: createMatch[2].trim(), Area: "Personales", Fecha: "" });
                await telegramSendMessage(token, chatId, `✅ Tarea creada rápidamente.`);
                return res.status(200).send("OK");
            }
        }

        // --- PROCESAMIENTO IA (Resumen) ---
        let geminiInputPart = null;
        if (message.voice?.file_id) {
            const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${message.voice.file_id}`);
            const getFileJson = await getFileRes.json();
            const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${getFileJson.result.file_path}`);
            const arrayBuffer = await fileRes.arrayBuffer();
            geminiInputPart = { inlineData: { data: Buffer.from(arrayBuffer).toString("base64"), mimeType: "audio/ogg" } };
        } else if (text) {
            geminiInputPart = { text };
        } else {
            return res.status(200).send("OK");
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
        const systemPrompt = `Intent Router. Today: 2026-04-06. Output RAW JSON. Area: Trabajo secundario, Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales. CREATE, READ, UPDATE key params.`;

        const result = await model.generateContent([systemPrompt, geminiInputPart]);
        const taskData = JSON.parse(await result.response.text());

        switch (taskData.Intent) {
            case "CREATE":
                await createNotionTaskPage(taskData);
                await telegramSendMessage(token, chatId, `✅ Tarea creada: ${taskData.Name}`);
                break;
            case "READ":
                const { text: readText, tasks: readTasks } = await readNotionTasks(taskData.FilterArea, taskData.FilterDate);
                const readKb = { inline_keyboard: readTasks.map((t, i) => [{ text: `✅ ${i + 1}`, callback_data: `done:${t.id}` }]) };
                await telegramSendMessage(token, chatId, readText, readKb);
                break;
            case "UPDATE":
                const upMsg = await updateNotionTaskStatus(taskData.SearchName, taskData.NewStatus);
                await telegramSendMessage(token, chatId, upMsg);
                break;
        }

    } catch (err) {
        console.error(err);
        if (err.message?.includes("429")) await telegramSendMessage(token, chatId, "⚠️ Cuota agotada. Usa comandos manuales.");
    }
    return res.status(200).send("OK");
};