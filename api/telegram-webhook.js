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
    if (!message) return res.status(200).send("OK");
    const chatId = message.chat.id;

    // Manejar Callbacks (botones) rápido
    if (req.body.callback_query) {
        const cb = req.body.callback_query;
        const [action, pageId] = cb.data.split(':');
        const reply = await (action === "done" ? updateNotionTaskStatus(pageId, "Hecho", true) : updateNotionTaskStatus(pageId, "Haciendo", true));
        await telegramSendMessage(token, chatId, reply);
        return res.status(200).send("OK");
    }

    try {
        const text = (message.text || "").trim();

        // Comandos rápidos
        if (text === "/lista" || text === "ver") {
            const { text: listText, tasks } = await readNotionTasks("", "");
            const keyboard = { inline_keyboard: tasks.slice(0, 8).map((t, i) => [{ text: `✅ ${i + 1}`, callback_data: `done:${t.id}` }, { text: `🚀 ${i + 1}`, callback_data: `doing:${t.id}` }]) };
            await telegramSendMessage(token, chatId, listText, keyboard);
            return res.status(200).send("OK");
        }

        // --- PROCESAMIENTO DE AUDIO ---
        if (message.voice) {
            await telegramSendMessage(token, chatId, "⏳ Descargando y analizando audio...");
            
            // 1. Obtener archivo de Telegram
            const getFile = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${message.voice.file_id}`)).json();
            const audioBuffer = await (await fetch(`https://api.telegram.org/file/bot${token}/${getFile.result.file_path}`)).arrayBuffer();
            const base64Audio = Buffer.from(audioBuffer).toString("base64");

            // 2. Llamar a Gemini
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Modelo estable y veloz

            const prompt = `Analiza este audio y responde ÚNICAMENTE con un JSON crudo:
            {"Intent": "CREATE", "Name": "nombre de la tarea", "Area": "categoría", "Fecha": "YYYY-MM-DD"}.
            Categorías: Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales.
            Hoy es: 2026-04-09.`;

            const result = await model.generateContent([prompt, { inlineData: { data: base64Audio, mimeType: "audio/ogg" } }]);
            const cleanJson = result.response.text().replace(/```json|```/g, "").trim();
            const taskData = JSON.parse(cleanJson);

            // 3. Crear en Notion
            if (taskData.Intent === "CREATE") {
                await createNotionTaskPage(taskData);
                await telegramSendMessage(token, chatId, `✅ **Tarea creada:** ${taskData.Name}\n📍 **Área:** ${taskData.Area}`);
            } else {
                await telegramSendMessage(token, chatId, "🤔 No entendí la intención de crear una tarea.");
            }
        }

    } catch (err) {
        console.error(err);
        await telegramSendMessage(token, chatId, `⚠️ **Error en proceso:** ${err.message.substring(0, 100)}...`);
    }

    return res.status(200).send("OK");
};