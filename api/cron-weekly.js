/**
 * Resumen semanal (Vercel: `0 1 * * 1` UTC ≈ domingo noche en Bogotá).
 * Tres bloques temporales: pausadas atrasadas, logros de la semana, pausadas futuras.
 */
const { getWeeklyCronReportData } = require("./notionTaskPage");

/** Evita romper Markdown de Telegram en nombres de tarea. */
function safeTelegramMdLine(s) {
    return String(s).replace(/[*_`[\]]/g, "·");
}

/**
 * Lista en viñetas; si está vacía, una línea placeholder.
 * @param {{ name: string, area: string, ymd: string }[]} items
 * @param {(row: { name: string, area: string, ymd: string }) => string} formatLine
 */
function bulletBlock(items, formatLine) {
    if (!items.length) return "_Sin ítems en esta sección._";
    return items.map((row) => formatLine(row)).join("\n");
}

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const data = await getWeeklyCronReportData();

        const pastLines = bulletBlock(
            data.pastPaused,
            (row) =>
                `• ${safeTelegramMdLine(row.name)} · \`${row.ymd}\` · _${safeTelegramMdLine(row.area)}_`
        );

        const previewLines = bulletBlock(
            data.previewPaused,
            (row) =>
                `• ${safeTelegramMdLine(row.name)} · \`${row.ymd}\` · _${safeTelegramMdLine(row.area)}_`
        );

        const message = [
            "🏆 *Reporte semanal · Aura Planner*",
            "",
            `*Semana que cierra* · \`${data.weekStart}\` → \`${data.weekEnd}\` · _Bogotá_`,
            "",
            "———————————————",
            "",
            "*Tareas pendientes del pasado*",
            "",
            "_Pausadas con fecha programada anterior al lunes de esta semana._",
            "",
            pastLines,
            "",
            "———————————————",
            "",
            "*Logros de la semana*",
            "",
            "_Tareas en estado Hecho con última edición en Notion en esta semana._",
            "",
            `*Total:* ${data.hechoThisWeek} tarea(s)`,
            "",
            "———————————————",
            "",
            "*Vista previa semanal*",
            "",
            `_Pausadas con fecha desde el próximo lunes_ \`${data.nextMonday}\` _en adelante._`,
            "",
            previewLines,
            "",
            "¡Buen cierre de semana! El lunes seguimos con todo. 🚀",
        ].join("\n");

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Cron Weekly Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
