/**
 * Recordatorio semanal de plan de aseo (domingo 20:00 America/Bogota).
 * Vercel cron: `0 1 * * 1` UTC (= domingo 20:00 Bogotá).
 * Crea en la base principal la tarea de revisar el plan de la semana entrante.
 */
const { createNotionTaskPage, getNextMondayBogotaYmd } = require("./notionTaskPage");

const ASEO_REVIEW_TASK_NAME = "Revisar y ajustar plan de aseo de la semana";

export default async function handler(req, res) {
    try {
        const nextMondayYmd = getNextMondayBogotaYmd();
        const result = await createNotionTaskPage({
            Name: ASEO_REVIEW_TASK_NAME,
            Area: "Aseo",
            Fecha: nextMondayYmd,
        });

        if (!result?.ok) {
            console.error("Cron Aseo Reminder:", result?.error);
            return res.status(500).json({ error: result?.error || "No se pudo crear la tarea de aseo." });
        }

        return res.status(200).json({
            success: true,
            taskId: result.id,
            dateYmd: result.dateYmd,
        });
    } catch (error) {
        console.error("Cron Aseo Reminder Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
