/**
 * Recordatorios proactivos de aseo pendiente (Vercel Cron).
 * Schedules UTC en vercel.json: `30 15 * * 1-5`, `30 20 * * 1-5`
 * → Bogotá (UTC−5), lun–vie: 10:30 y 15:30.
 * Silencio total si no hay pendientes.
 */
const { getPendingCleaningForToday } = require("../src/modules/cleaning/cleaningNotion");
const {
    buildCleaningPendingMessage,
    buildCleaningPendingKeyboard,
} = require("../src/modules/cleaning/cleaningTelegramMenu");
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
        const result = await getPendingCleaningForToday();
        if (!result.ok) {
            console.error("Cron Aseo:", result.message);
            return res.status(500).json({ error: result.message });
        }

        if (result.allDone || !result.pending?.length) {
            return res.status(200).json({ success: true, skipped: true, reason: "all_done" });
        }

        const text = buildCleaningPendingMessage(result.pending, {
            cron: true,
            dayPrefix: result.dayPrefix,
        });
        const keyboard = buildCleaningPendingKeyboard(result.pending, result.sortedFilteredNames);

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
            dayPrefix: result.dayPrefix,
        });
    } catch (error) {
        console.error("Cron Aseo Error:", error);
        return res.status(500).json({ error: error.message });
    }
}

module.exports = handler;
