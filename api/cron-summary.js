const { getDailyTasks, getOverdueTasks } = require("./notionTaskPage");

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const overdue = await getOverdueTasks();

        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
        const hour = now.getHours();
        const isMorningSlot = hour === 7;
        const isMiddaySlot = [10, 13, 16].includes(hour);
        const isEndOfDaySlot = hour === 20;

        const { text: tasksText } = await getDailyTasks();

        let greeting;
        if (isMorningSlot) {
            greeting = "🌅 ¡Buenos días Don Eduardo!! Estas son tus tareas de hoy:";
        } else if (isMiddaySlot) {
            greeting = "🍱 Veooo my little associate estas son las tareas del día: Ojito con los pendientes";
        } else if (isEndOfDaySlot) {
            greeting =
                "🌙 Cierre del día my little associate — estas son las tareas de hoy antes de que termine la jornada:";
        } else {
            greeting = "📋 My little associate aca esta el resumen programado. Aquí está la lista actual socio!:";
        }

        let message = `${greeting}\n\n${tasksText}`;

        if (overdue.length > 0) {
            const overdueList = overdue
                .map((p) => {
                    const name = p.properties.Name?.title[0]?.text?.content || "Sin título";
                    return `- ${name}`;
                })
                .join("\n");
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
