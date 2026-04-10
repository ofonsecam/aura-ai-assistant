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

module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("OK");
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const message = req.body?.message;
    const cb = req.body?.callback_query;

    if (cb) {
        const [action, pageId] = cb.data.split(':');
        let status = action === "done" ? "Hecho" : (action === "doing" ? "Haciendo" : "Pausado");
        let reply = (action === "del") ? await deleteNotionTask(pageId, true) : await updateNotionTaskStatus(pageId, status, true);
        await telegramSendMessage(token, cb.message.chat.id, reply);
        return res.status(200).send("OK");
    }

    if (!message) return res.status(200).send("OK");
    const chatId = message.chat.id;
    const text = (message.text || "").trim();

    try {
        if (text === "/lista" || text.toLowerCase() === "ver") {
            const { text: listText, tasks } = await readNotionTasks("", "");
            const keyboard = {
                inline_keyboard: tasks.slice(0, 10).map((t, i) => [
                    { text: `✅ ${i + 1}`, callback_data: `done:${t.id}` },
                    { text: `🚀 ${i + 1}`, callback_data: `doing:${t.id}` },
                    { text: `🗑️ ${i + 1}`, callback_data: `del:${t.id}` }
                ])
            };
            await telegramSendMessage(token, chatId, listText, keyboard);
            return res.status(200).send("OK");
        }

        if (message.voice) {
            await telegramSendMessage(token, chatId, "🎙️ Analizando audio...");
            const getFile = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${message.voice.file_id}`)).json();
            const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${getFile.result.file_path}`);
            const audioData = Buffer.from(await audioRes.arrayBuffer()).toString("base64");

            // --- CONFIGURACIÓN CORREGIDA ---
            // Forzamos el uso del modelo estable sin prefijos extraños
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

            const prompt = `Analiza el audio y responde SOLO JSON crudo: 
            {"Intent": "CREATE", "Name": "título", "Area": "categoría", "Fecha": "YYYY-MM-DD"}.
            Áreas: Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales.`;

            const result = await model.generateContent([
                { inlineData: { data: audioData, mimeType: "audio/ogg" } },
                { text: prompt }
            ]);

            const responseText = result.response.text().replace(/```json|```/g, "").trim();
            const taskData = JSON.parse(responseText);

            if (taskData.Intent === "CREATE") {
                await createNotionTaskPage(taskData);
                await telegramSendMessage(token, chatId, `✅ **Tarea creada:** ${taskData.Name}`);
            }
            return res.status(200).send("OK");
        }
    } catch (err) {
        console.error(err);
        // Respuesta más limpia para el usuario
        await telegramSendMessage(token, chatId, `⚠️ No pude procesar el audio. Intenta de nuevo o usa texto.`);
    }
    return res.status(200).send("OK");
};