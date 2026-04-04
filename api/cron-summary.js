const { readNotionTasks } = require("./notionTaskPage");

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const tasks = await readNotionTasks("", "");
        const now = new Date();
        const hour = now.getUTCHours(); 
        const minutes = now.getUTCMinutes();

        let greeting;
        // Lógica basada en la hora UTC para determinar el saludo correcto
        if (hour === 12) { 
            greeting = "🌅 ¡Buenos días, Oscar! Comienza tu jornada con estos pendientes:";
        } else if (hour === 17) { 
            greeting = "🍱 Control de mediodía. Así va tu lista de tareas:";
        } else if (hour === 21) { 
            greeting = "🌆 Cierre de tarde. Esto es lo que quedó pendiente:";
        } else {
            greeting = "📋 Resumen de tareas actualizado:";
        }

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