const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createNotionTaskPage, readNotionTasks, updateNotionTaskStatus } = require("./notionTaskPage");

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

    try {
        let geminiInputPart = null;
        let userInputIsAudio = false;

        // Prepare Gemini input (text part or inlineData part)
        if (typeof message.text === "string" && message.text.trim().length > 0) {
            geminiInputPart = { text: message.text.trim() };
        } else if (message.voice?.file_id) {
            // Download the voice as in previous logic
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

            geminiInputPart = {
                inlineData: {
                    data: base64Audio,
                    mimeType: "audio/ogg"
                }
            };
            userInputIsAudio = true;
        } else {
            await telegramSendMessage(token, message.chat.id, "No se encontró texto ni audio para procesar.");
            return res.status(200).send("OK");
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" },
        });

        // New intent router prompt as instructed
        const prompt = `You are an AI assistant. Analyze the user's input (text or audio) and determine their intent. Output a strict JSON object.

The JSON MUST have an "Intent" key, which must be exactly one of: "CREATE", "READ", or "UPDATE".

If Intent is "CREATE" (user wants to add a new task):

Include: "Name" (task title), "Area" (Must be exactly: Trabajo secundario, Trabajo Traffix, Iglesia, Familia, Carrera, IA Dev, Universidad, or Personales), and "Fecha" (YYYY-MM-DD or empty).

If Intent is "READ" (user is asking what tasks they have):

Include: "FilterArea" (The area they are asking about, use the exact Area list or empty if asking generally) and "FilterDate" (YYYY-MM-DD or empty).

If Intent is "UPDATE" (user wants to change a task status):

Include: "SearchName" (The title of the task they want to update) and "NewStatus" (Must be exactly: Pausado, Hecho, Haciendo, or Pendiente).

Today's date is 2026-04-04.`;

        const partsArray = [prompt, geminiInputPart];

        const result = await model.generateContent(partsArray);

        const textOut = (await result.response.text() || "").trim();

        let taskData;
        try {
            taskData = JSON.parse(textOut);
        } catch (e) {
            throw new Error("Respuesta de Gemini no es un JSON válido: " + textOut);
        }

        if (!taskData || typeof taskData !== "object" || !taskData.Intent) {
            throw new Error("No se detectó intención o JSON inválido de Gemini.");
        }

        switch (taskData.Intent) {
            case "CREATE":
                if (!taskData.Name || !taskData.Area || typeof taskData.Fecha === "undefined") {
                    await telegramSendMessage(token, message.chat.id, "Faltan datos para crear la tarea. Intenta de nuevo.");
                    break;
                }
                await createNotionTaskPage(taskData);
                await telegramSendMessage(
                    token,
                    message.chat.id,
                    `✅ Tarea creada: ${taskData.Name} en ${taskData.Area}` +
                        (taskData.Fecha && taskData.Fecha.length > 0 ? ` para el ${taskData.Fecha}` : "")
                );
                break;
            case "READ":
                {
                    const reply = await readNotionTasks(taskData.FilterArea, taskData.FilterDate);
                    await telegramSendMessage(token, message.chat.id, reply);
                }
                break;
            case "UPDATE":
                {
                    const reply = await updateNotionTaskStatus(taskData.SearchName, taskData.NewStatus);
                    await telegramSendMessage(token, message.chat.id, reply);
                }
                break;
            default:
                await telegramSendMessage(
                    token,
                    message.chat.id,
                    "No entendí la acción."
                );
                break;
        }
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
