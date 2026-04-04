const { readNotionTasks } = require("./notionTaskPage");

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const tasks = await readNotionTasks("", ""); // Lee todas las tareas pendientes
        const now = new Date();
        const hour = now.getUTCHours(); // Trabajaremos con UTC

        // Determinar el saludo según la hora UTC (Colombia es UTC-5)
        // 12 UTC = 7 AM COT | 21 UTC = 4 PM COT
        let greeting = hour < 15 ? "🌅 ¡Buenos días, Oscar! Aquí tienes tus pendientes:" : "🌆 Recordatorio de la tarde:";

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: `${greeting}\n\n${tasks}`
            }),
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Cron Error:", error);
        return res.status(500).json({ error: error.message });
    }
}