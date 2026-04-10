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

// Función de Bypass v1 - Sin configuraciones conflictivas
async function callGeminiDirect(audioDataBase64, prompt) {
    // Usamos v1 porque es donde los logs confirmaron que SÍ encuentra el modelo
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const payload = {
        contents: [{
            parts: [
                { inlineData: { mimeType: "audio/ogg", data: audioDataBase64 } },
                { text: prompt }
            ]
        }]
        // Eliminamos generationConfig por completo. 
        // Si el servidor no ve el campo, no puede dar error de "Unknown name".
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    
    if (!res.ok) {
        throw new Error(data.error?.message || "Error en la comunicación con Google");
    }

    return data.candidates[0].content.parts[0].text;
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("OK");
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const message = req.body?.message;
    const cb = req.body?.callback_query;

    // 1. GESTIÓN DE BOTONES (Conservamos avance Fase 6)
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
        // 2. COMANDOS MANUALES (Conservamos avance Fase 4)
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

        // 3. PROCESAMIENTO DE VOZ (Protocolo de emergencia v1)
        if (message.voice) {
            await telegramSendMessage(token, chatId, "🎙️ Analizando audio con protocolo de emergencia...");
            
            const getFile = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${message.voice.file_id}`)).json();
            const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${getFile.result.file_path}`);
            const audioData = Buffer.from(await audioRes.arrayBuffer()).toString("base64");

            // Forzamos el JSON mediante el prompt, ya que quitamos la config técnica
            const prompt = `Responde EXCLUSIVAMENTE con un JSON crudo, sin texto antes ni después:
            {"Intent": "CREATE", "Name": "nombre tarea", "Area": "categoría", "Fecha": "2026-04-09"}.
            Áreas: Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, Personales.`;

            const responseText = await callGeminiDirect(audioData, prompt);
            
            // Limpieza manual de la respuesta por si la IA añade markdown
            const cleanJson = responseText.replace(/```json|```/g, "").trim();
            const taskData = JSON.parse(cleanJson);

            if (taskData.Intent === "CREATE") {
                await createNotionTaskPage(taskData);
                await telegramSendMessage(token, chatId, `✅ **Tarea creada por voz:** ${taskData.Name}`);
            }
            return res.status(200).send("OK");
        }

    } catch (err) {``
        console.error(err);
        await telegramSendMessage(token, chatId, `⚠️ Error en protocolo: ${err.message.substring(0, 60)}`);
    }

    return res.status(200).send("OK");
};