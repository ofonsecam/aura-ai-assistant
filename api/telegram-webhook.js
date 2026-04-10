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

    // 1. GESTIÓN DE BOTONES
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
        // 2. COMANDOS MANUALES
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

        // 3. PROCESAMIENTO DE VOZ (Modelo Corregido)
        if (message.voice) {
            await telegramSendMessage(token, chatId, "🎙️ Procesando audio...");
            
            const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${message.voice.file_id}`);
            const getFileJson = await getFileRes.json();
            const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${getFileJson.result.file_path}`);
            
            const arrayBuffer = await audioRes.arrayBuffer();
            const audioData = Buffer.from(arrayBuffer).toString("base64");

            // Solución principal: Uso del modelo 2.5 flash
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash",
                generationConfig: { responseMimeType: "application/json" }
            });

            const prompt = `Extrae la información del audio. 
            Formato requerido: {"Intent": "CREATE", "Name": "nombre de la tarea", "Area": "categoría", "Fecha": "YYYY-MM-DD"}. 
            Categorías permitidas: Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales.`;

            const result = await model.generateContent([
                { inlineData: { data: audioData, mimeType: "audio/ogg" } },
                prompt
            ]);

            const taskData = JSON.parse(result.response.text());

            if (taskData.Intent === "CREATE") {
                await createNotionTaskPage(taskData);
                await telegramSendMessage(token, chatId, `✅ Tarea creada: ${taskData.Name}`);
            }
            return res.status(200).send("OK");
        }

    } catch (err) {
        console.error(err);
        await telegramSendMessage(token, chatId, `⚠️ Error técnico: ${err.message}`);
    }

    return res.status(200).send("OK");
};