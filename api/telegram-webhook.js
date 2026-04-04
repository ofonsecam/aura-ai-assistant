const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createNotionTaskPage } = require("./notionTaskPage");

/**
 * @param {string} token
 * @param {number | string} chatId
 * @param {string} text
 */
async function telegramSendMessage(token, chatId, text) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
    });
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(200).send("OK");
    }

    const message = req.body?.message;
    if (!message) {
        return res.status(200).send("OK");
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error("TELEGRAM_BOT_TOKEN is not set");
        return res.status(200).send("OK");
    }

    if (!message.voice) {
        try {
            await telegramSendMessage(
                token,
                message.chat.id,
                "Por favor, envíame una nota de voz."
            );
        } catch (err) {
            console.error(err);
        }
        return res.status(200).send("OK");
    }

    try {
        const fileId = message.voice.file_id;
        const getFileRes = await fetch(
            `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
        );
        const getFileJson = await getFileRes.json();
        if (!getFileJson.ok || !getFileJson.result?.file_path) {
            throw new Error("getFile failed or missing file_path");
        }
        const filePath = getFileJson.result.file_path;

        const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
        if (!fileRes.ok) {
            throw new Error(`Voice file download failed: ${fileRes.status}`);
        }
        const arrayBuffer = await fileRes.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString("base64");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" },
        });

        const prompt = `You are an expert task extraction assistant. Listen to the audio and output a strict, raw JSON object (no markdown, no backticks).

The JSON must have exactly these three keys:

1. "Name": (string) A concise, actionable title for the task.

2. "Area": (string) Categorize the task. You MUST choose EXACTLY ONE of these options: "Trabajo secundario", "Trabajo Traffix", "Iglesia", "Familia", "Carrera", "IA Dev", "Universidad", or "Personales". If unsure, use "Personales".

3. "Fecha": (string) If the audio mentions a deadline or specific day, calculate the date and output it in ISO format YYYY-MM-DD. Today's date is 2026-04-04. If no date is mentioned, return an empty string "".`;

        const audioPart = {
            inlineData: {
                data: base64Audio,
                mimeType: "audio/ogg",
            },
        };

        const result = await model.generateContent([prompt, audioPart]);
        const textOut = (await result.response.text() || "").trim();
        const taskData = JSON.parse(textOut);

        if (!taskData || typeof taskData !== "object" || !taskData.Name) {
            throw new Error("Invalid or empty structured transcription");
        }

        await createNotionTaskPage(taskData);

        await telegramSendMessage(
            token,
            message.chat.id,
            "✅ Tarea guardada: " + taskData.Name + " en " + taskData.Area
        );
    } catch (err) {
        console.error(err);
        try {
            await telegramSendMessage(token, message.chat.id, "Error al procesar la tarea.");
        } catch (sendErr) {
            console.error(sendErr);
        }
    }

    return res.status(200).send("OK");
};
