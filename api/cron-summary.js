const { getDailyTasks, getWeeklyTasks, getOverdueTasks } = require("./notionTaskPage");

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const overdue = await getOverdueTasks();
        
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
        const hour = now.getHours();
        const isDailySlot = [7, 10, 13].includes(hour);
        const isWeeklySlot = [16, 20].includes(hour);
        const { text: tasksText } = isWeeklySlot ? await getWeeklyTasks() : await getDailyTasks();

        let greeting;
        if (isDailySlot && hour === 7) greeting = "🌅 ¡Buenos días Don Eduardo!! Estas son tus tareas de hoy:";
        else if (isDailySlot) greeting = "🍱 Veooo my little associate estas son las tareas del día: Ojito con los pendientes";
        else if (isWeeklySlot) greeting = "🗓️ My little associate estas son tus tareas de esta semana, Yo vere!:";
        else greeting = "📋 My little associate aca esta el resumen programado. Aquí está la lista actual socio!:";
        
        // Usamos tasksText que contiene el string numerado
        let message = `${greeting}\n\n${tasksText}`;

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