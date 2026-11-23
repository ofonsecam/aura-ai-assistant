/**
 * Recordatorios proactivos de hábitos pendientes (Vercel Cron).
 * Schedules UTC en vercel.json: `50 10`, `0 19`, `0 0` * * *
 * → Bogotá (UTC−5): 05:50, 14:00, 19:00.
 * Silencio total si no hay hábitos pendientes.
 */
const { getPendingHabitsForToday } = require("../lib/notionTaskPage");
const { buildHabitsPendingMessage, buildHabitsPendingKeyboard } = require("../lib/habitTelegramMenu");
const { verifyCronAuthorization } = require("../lib/cronAuth");

async function handler(req, res) {
    const auth = verifyCronAuthorization(req);
    if (!auth.ok) {
        return res.status(auth.status).json({ error: auth.error });
    }

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
        const keyboard = buildHabitsPendingKeyboard(result.pending, result.sortedCheckboxNames);

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

module.exports = handler;
