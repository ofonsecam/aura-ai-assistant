const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createNotionTaskPage, readNotionTasks, updateNotionTaskStatus, deleteNotionTask } = require("./notionTaskPage");

/**
 * Envía mensajes a Telegram mediante la API oficial.
 */
async function telegramSendMessage(token, chatId, text) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
    });
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("OK");

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
                const reply = await readNotionTasks("", "");
                await telegramSendMessage(token, chatId, reply);
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
                    const list = await readNotionTasks(taskData.FilterArea, taskData.FilterDate);
                    await telegramSendMessage(token, chatId, list);
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