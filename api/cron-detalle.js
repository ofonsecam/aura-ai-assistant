/**
 * Recordatorio semanal de un detalle para Yulian (Vercel Cron).
 * Schedule UTC en vercel.json: `0 21 * * 4` → jueves 16:00 Bogotá (UTC−5).
 */
const { generarIdeaDetalle } = require("../lib/geminiService");
const { verifyCronAuthorization } = require("../lib/cronAuth");

async function handler(req, res) {
    const auth = verifyCronAuthorization(req);
    if (!auth.ok) {
        return res.status(auth.status).json({ error: auth.error });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID || process.env.MY_TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        return res.status(500).json({
            error: "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.",
        });
    }

    try {
        const idea = await generarIdeaDetalle(true);
        const telegramRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: idea }),
        });
        const telegramData = await telegramRes.json().catch(() => ({}));
        if (!telegramRes.ok || telegramData?.ok === false) {
            const detail = telegramData?.description || String(telegramRes.status);
            throw new Error(`Telegram sendMessage error: ${detail}`);
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Cron Detalle Error:", error);
        return res.status(500).json({ error: error.message });
    }
}

module.exports = handler;
