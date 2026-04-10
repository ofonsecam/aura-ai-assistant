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
        if (text === "/start") {
            await telegramSendMessage(token, chatId, "🚀 Aura AI Online. Usa /lista o envía un audio.");
            return res.status(200).send("OK");
        }

        if (text === "/help") {
            await telegramSendMessage(token, chatId, "📖 **Manual de Aura AI**\n\n- `/lista`: Ver tareas con botones.\n- `+ [tarea]`: Creación rápida en Personales.\n- 🎙️ Envía audios para crear tareas complejas.");
            return res.status(200).send("OK");
        }

        if (text.startsWith('+')) {
            const taskName = text.substring(1).trim();
            await createNotionTaskPage({ Name: taskName, Area: "Personales" });
            await telegramSendMessage(token, chatId, `✅ Tarea rápida creada: ${taskName}`);
            return res.status(200).send("OK");
        }

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
            await telegramSendMessage(token, chatId, "🎙️ Procesando audio...");
            
            const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${message.voice.file_id}`);
            const getFileJson = await getFileRes.json();
            const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${getFileJson.result.file_path}`);
            
            const arrayBuffer = await audioRes.arrayBuffer();
            const audioData = Buffer.from(arrayBuffer).toString("base64");

            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const prompt = `Extrae la información del audio. 
            Formato requerido: {"Intent": "CREATE", "Name": "nombre de la tarea", "Area": "categoría", "Fecha": "YYYY-MM-DD"}. 
            Categorías permitidas: Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales.`;

            let result;
            try {
                // Intento 1: Modelo Principal
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
                result = await model.generateContent([{ inlineData: { data: audioData, mimeType: "audio/ogg" } }, prompt]);
            } catch (apiErr) {
                if (apiErr.message.includes("503")) {
                    // Intento 2: Plan de Respaldo si Google está saturado
                    await telegramSendMessage(token, chatId, "⏳ Google Gemini está muy ocupado (Error 503). Intentando con modelo de respaldo...");
                    const fallbackModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
                    result = await fallbackModel.generateContent([{ inlineData: { data: audioData, mimeType: "audio/ogg" } }, prompt]);
                } else {
                    throw apiErr; // Si es otro error, lo mostramos
                }
            }

            const taskData = JSON.parse(result.response.text());

            if (taskData.Intent === "CREATE") {
                await createNotionTaskPage(taskData);
                await telegramSendMessage(token, chatId, `✅ Tarea creada: ${taskData.Name}`);
            }
            return res.status(200).send("OK");
        }

    } catch (err) {
        console.error(err);
        // Mensajes de error más amigables
        if (err.message.includes("503")) {
            await telegramSendMessage(token, chatId, `⚠️ Google sigue colapsado en este momento. Por favor usa el comando '+' temporalmente.`);
        } else {
            await telegramSendMessage(token, chatId, `⚠️ Error técnico: ${err.message}`);
        }
    }

    return res.status(200).send("OK");
};