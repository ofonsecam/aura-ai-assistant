/**
 * Autenticación compartida para handlers de Vercel Cron.
 * Vercel envía `Authorization: Bearer <CRON_SECRET>` en las invocaciones programadas.
 *
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function verifyCronAuthorization(req) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return { ok: false, status: 500, error: "CRON_SECRET no configurado." };
    }
    const authHeader = req?.headers?.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }
    return { ok: true };
}

module.exports = {
    verifyCronAuthorization,
};
