/**
 * Recordatorios proactivos de hábitos pendientes (Vercel Cron).
 * Horarios COL (UTC-5): 07:15, 13:00 y 18:40 → ver vercel.json.
 * Silencio total si no hay hábitos pendientes.
 */
const { getPendingHabitsForToday } = require("./notionTaskPage");
const { buildHabitsPendingMessage, buildHabitsPendingKeyboard } = require("./habitTelegramMenu");

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        return res.status(500).json({ error: "Faltan TELEGRAM_BOT_TOKEN o MY_TELEGRAM_CHAT_ID." });
    }

    try {
        const result = await getPendingHabitsForToday();
        if (!result.ok) {
            console.error("Cron Habitos:", result.message);
            return res.status(500).json({ error: result.message });
        }

        if (result.allDone || !result.pending?.length) {
            return res.status(200).json({ success: true, skipped: true, reason: "all_done" });
        }

        const text = buildHabitsPendingMessage(result.pending, { cron: true });
        const keyboard = buildHabitsPendingKeyboard(result.pending);

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "Markdown",
                reply_markup: keyboard,
            }),
        });

        return res.status(200).json({
            success: true,
            pendingCount: result.pending.length,
        });
    } catch (error) {
        console.error("Cron Habitos Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
