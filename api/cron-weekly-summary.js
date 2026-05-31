/**
 * Resumen semanal breve (domingo 20:00 Bogotá ≈ `0 1 * * 1` UTC).
 * Cuenta tareas completadas en los últimos 7 días según Fecha de Cierre (Hecho/Done/Cumplida).
 */
const { getCompletedTasksCountLast7DaysBogota } = require("./notionTaskPage");

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
        const { count } = await getCompletedTasksCountLast7DaysBogota();

        const message = `📊 Resumen Semanal: Has completado ${count} tarea${count === 1 ? "" : "s"} esta semana. ¡Buen trabajo!`;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
            }),
        });

        return res.status(200).json({ success: true, count });
    } catch (error) {
        console.error("Cron Weekly Summary Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
