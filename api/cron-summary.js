const { readNotionTasks, getOverdueTasks } = require("./notionTaskPage");

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const tasks = await readNotionTasks("", "");
        const overdue = await getOverdueTasks();
        
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
        const hour = now.getHours();

        let greeting;
        if (hour < 10) greeting = "🌅 ¡Buenos días, Oscar! Comienza tu jornada con estos pendientes:";
        else if (hour < 15) greeting = "🍱 Control de mediodía. Así va tu lista de tareas:";
        else greeting = "🌆 Cierre de tarde. Esto es lo que quedó pendiente:";
        
        let message = `${greeting}\n\n${tasks}`;

        if (overdue.length > 0) {
            const overdueList = overdue.map(p => {
                const name = p.properties.Name?.title[0]?.text?.content || "Sin título";
                return `- ${name}`;
            }).join('\n');
            message += `\n\n⚠️ **ATENCIÓN: Tareas Vencidas**\n${overdueList}`;
        }

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Cron Summary Error:", error);
        return res.status(500).json({ error: error.message });
    }
}