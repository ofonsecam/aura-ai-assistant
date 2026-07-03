/**
 * Resumen semanal (Vercel: `0 1 * * 0` UTC ≈ domingo 20:00 en Bogotá).
 * Encabezado de logros (últimos 7 días, Estado Hecho) + reporte detallado semanal.
 */
const { getWeeklyCronReportData, getCompletedTasksCountLast7DaysBogota } = require("./notionTaskPage");

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

function verifyCronAuthorization(req) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return { ok: false, status: 500, error: "CRON_SECRET no configurado." };
    }
    const authHeader = req.headers?.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }
    return { ok: true };
}

export default async function handler(req, res) {
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
        const [data, last7] = await Promise.all([
            getWeeklyCronReportData(),
            getCompletedTasksCountLast7DaysBogota(),
        ]);

        const count = last7.count;
        const summaryHeader = `📊 Resumen Semanal: Has completado ${count} tarea${count === 1 ? "" : "s"} esta semana. ¡Buen trabajo!`;

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
            summaryHeader,
            "",
            "🏆 *Reporte semanal · Aura Planner*",
            "",
            `*Semana que cierra* · \`${data.weekStart}\` → \`${data.weekEnd}\` · _Bogotá_`,
            "",
            "———————————————",
            "",
            "*Tareas pendientes del pasado, ojo aca little associate*",
            "",
            "_Pausadas con fecha programada anterior al lunes de esta semana. Pero hechele gafa manito._",
            "",
            pastLines,
            "",
            "———————————————",
            "",
            "*Logros de la semana!!! Eso es mi papacho!*",
            "",
            "_Completadas en esta semana según la propiedad Fecha de Cierre (Estado Hecho), con día civil en Bogotá. Recuento preciso, no por última edición._",
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
            "¡Buen cierre de semana my little associate! El lunes seguimos con todo. 🚀",
        ].join("\n");

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
        });

        return res.status(200).json({ success: true, count });
    } catch (error) {
        console.error("Cron Weekly Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
