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
            await telegramSendMessage(token, chatId, "🚀 Aura AI Online. Usa /lista o envía un audio.");
            return res.status(200).send("OK");
        }

        // --- BYPASS DE IA: COMANDOS MANUALES ---
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

        // --- PROCESAMIENTO DE AUDIO O TEXTO CON GEMINI ---
        let geminiInputPart = null;

        if (message.voice?.file_id) {
            await telegramSendMessage(token, chatId, "🎤 Procesando audio... un momento.");
            const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${message.voice.file_id}`);
            const getFileJson = await getFileRes.json();
            const fileUrl = `https://api.telegram.org/file/bot${token}/${getFileJson.result.file_path}`;
            
            const fileRes = await fetch(fileUrl);
            const buffer = Buffer.from(await fileRes.arrayBuffer());
            geminiInputPart = { inlineData: { data: buffer.toString("base64"), mimeType: "audio/ogg" } };
        } else if (text && !text.startsWith('+') && !text.startsWith('/')) {
            geminiInputPart = { text };
        }

        if (geminiInputPart) {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash", 
                generationConfig: { responseMimeType: "application/json" } 
            });

            const systemPrompt = `You are a task manager. Return RAW JSON. Intent: CREATE, READ, UPDATE. Areas: Trabajo secundario, Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales. Current date: 2026-04-09.`;
            
            const result = await model.generateContent([systemPrompt, geminiInputPart]);
            const responseText = result.response.text();
            const taskData = JSON.parse(responseText);

            if (taskData.Intent === "CREATE") {
                await createNotionTaskPage(taskData);
                await telegramSendMessage(token, chatId, `✅ Tarea creada desde audio: *${taskData.Name}*`);
            } else if (taskData.Intent === "READ") {
                const { text: readText } = await readNotionTasks(taskData.FilterArea, taskData.FilterDate);
                await telegramSendMessage(token, chatId, readText);
            }
        }

    } catch (err) {
        console.error("ERROR WEBHOOK:", err);
        await telegramSendMessage(token, chatId, `⚠️ Error técnico: ${err.message}. Verifica tu API KEY de Gemini en Vercel.`);
    }
    return res.status(200).send("OK");
};