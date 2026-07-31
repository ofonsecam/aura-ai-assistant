/**
 * Cierre de noche (20:30 America/Bogota): logros del día + plan mañana + pendientes semanales.
 * Vercel cron: 30 1 * * * UTC (= 20:30 Bogotá).
 */
const { getCompletedTasksTodayBogota, getTomorrowTasks, getWeeklyTasks } = require("./notionTaskPage");

function safeTelegramMdLine(s) {
    return String(s).replace(/[*_`[\]]/g, "·");
}

function formatCompletedTodayList(tasks) {
    if (!tasks.length) return "_Sin completadas hoy._";
    return tasks
        .map(
            (t) =>
                `• ${safeTelegramMdLine(t.name)} · _${safeTelegramMdLine(t.area)}_ · \`${safeTelegramMdLine(t.status)}\``
        )
        .join("\n");
}

function formatPendingTasksList(tasks) {
    if (!tasks.length) return "_Sin pendientes._";
    return tasks
        .map(
            (t, i) =>
                `${i + 1}. 📌 [${safeTelegramMdLine(t.area)}] — ${safeTelegramMdLine(t.name)} (${safeTelegramMdLine(t.status)})`
        )
        .join("\n");
}

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const [completed, tomorrow, weekly] = await Promise.all([
            getCompletedTasksTodayBogota(),
            getTomorrowTasks(),
            getWeeklyTasks(),
        ]);

        const text = [
            "✅ *Logros de hoy Socio!! Re bien hecho! Son las Completadas:*",
            "",
            formatCompletedTodayList(completed.tasks),
            "",
            "———————————————",
            "",
            "🚀 *Veo ojo con esto: Plan para mañana:*",
            "",
            formatPendingTasksList(tomorrow.tasks),
            "",
            "———————————————",
            "",
            "🗓️ *Tareas pendientes de la semana para que este pilas socio!*",
            "",
            `Semana \`${weekly.weekStart}\` → \`${weekly.weekEnd}\` · _Bogotá_`,
            "",
            formatPendingTasksList(weekly.tasks),
        ].join("\n");

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "Markdown",
            }),
        });

        return res.status(200).json({
            success: true,
            completedCount: completed.tasks.length,
            tomorrowCount: tomorrow.tasks.length,
            weeklyCount: weekly.tasks.length,
        });
    } catch (error) {
        console.error("Cron Daily Close Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
