/**
 * Cierre de noche (20:30 America/Bogota): resumen semanal de pendientes + cierre diario de completadas.
 * Vercel cron: 01:30 UTC diario (= 20:30 del día anterior en Bogotá, mismo instante civil).
 */
const { getWeeklyTasks, getCompletedTasksTodayBogota } = require("./notionTaskPage");

function safeTelegramMdLine(s) {
    return String(s).replace(/[*_`[\]]/g, "·");
}

function buildCompletedTodaySection(dateYmd, tasks) {
    if (!tasks.length) {
        return [
            "———————————————",
            "",
            "🌙 *Cierre de día*",
            "",
            `Hoy (\`${dateYmd}\`, Bogotá) no hay tareas con *Fecha de Cierre* en este día (Hecho/Done/Cumplida vía bot o con esa fecha rellenada).`,
            "",
            "Descansa bien: un día sin tachar ítems también cuenta. Mañana puedes ordenar 2–3 prioridades y retomar el ritmo con calma. 🌿",
        ].join("\n");
    }

    const list = tasks
        .map(
            (t) =>
                `• ${safeTelegramMdLine(t.name)} · _${safeTelegramMdLine(t.area)}_ · \`${safeTelegramMdLine(t.status)}\``
        )
        .join("\n");

    return [
        "———————————————",
        "",
        "🌙 *Cierre de día*",
        "",
        `Cierres reales hoy (\`${dateYmd}\`, Bogotá) según *Fecha de Cierre*:`,
        "",
        list,
        "",
        `*Total:* ${tasks.length} tarea(s). Buen trabajo — cierra la laptop y desconecta un rato. ✨`,
    ].join("\n");
}

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const [{ text: weeklyText, weekStart, weekEnd }, { dateYmd, tasks: completedToday }] =
            await Promise.all([getWeeklyTasks(), getCompletedTasksTodayBogota()]);

        const text = [
            "🗓️ *Resumen semanal de tareas*",
            "",
            `Semana \`${weekStart}\` → \`${weekEnd}\` · _Bogotá_`,
            "",
            weeklyText,
            "",
            buildCompletedTodaySection(dateYmd, completedToday),
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

        return res.status(200).json({ success: true, completedCount: completedToday.length });
    } catch (error) {
        console.error("Cron Daily Close Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
