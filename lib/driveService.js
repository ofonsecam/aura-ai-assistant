const { Readable } = require("node:stream");

let cachedDriveClient = null;

/**
 * Credenciales de Drive vía OAuth2. Las llaves de cuenta de servicio no se usan:
 * Google asigna cuota cero a Service Accounts en Drive personal.
 * @returns {{ ok: true, clientId: string, clientSecret: string, refreshToken: string, folderId: string } | { ok: false, error: string }}
 */
function getDriveConfig() {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
    const refreshToken = String(process.env.GOOGLE_REFRESH_TOKEN || "").trim();
    const folderId = String(process.env.DRIVE_FOLDER_ID || "").trim();

    const missing = [];
    if (!clientId) missing.push("GOOGLE_CLIENT_ID");
    if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
    if (!refreshToken) missing.push("GOOGLE_REFRESH_TOKEN");
    if (!folderId) missing.push("DRIVE_FOLDER_ID");
    if (missing.length) {
        return { ok: false, error: `❌ Faltan variables de Google Drive: ${missing.join(", ")}.` };
    }
    return { ok: true, clientId, clientSecret, refreshToken, folderId };
}

/**
 * `googleapis` se carga bajo demanda: es pesado y solo lo necesitan los gastos con soporte.
 */
function getDriveClient(config) {
    if (cachedDriveClient) return cachedDriveClient;
    const { google } = require("googleapis");
    const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);
    oauth2Client.setCredentials({
        refresh_token: config.refreshToken,
    });
    cachedDriveClient = google.drive({ version: "v3", auth: oauth2Client });
    return cachedDriveClient;
}

/**
 * Sube un buffer a la carpeta DRIVE_FOLDER_ID y lo deja legible para cualquiera con el enlace.
 * @param {{ buffer: Buffer, fileName: string, mimeType?: string }} file
 * @returns {Promise<{ ok: true, fileId: string, webViewLink: string } | { ok: false, error: string }>}
 */
async function uploadBufferToDrive({ buffer, fileName, mimeType = "application/octet-stream" }) {
    const config = getDriveConfig();
    if (!config.ok) return config;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { ok: false, error: "❌ El archivo a subir está vacío." };
    }

    try {
        const drive = getDriveClient(config);
        const created = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [config.folderId],
            },
            media: {
                mimeType,
                body: Readable.from(buffer),
            },
            fields: "id, webViewLink",
            supportsAllDrives: true,
        });

        const fileId = created.data.id;
        await drive.permissions.create({
            fileId,
            requestBody: { role: "reader", type: "anyone" },
            supportsAllDrives: true,
        });

        let webViewLink = created.data.webViewLink || "";
        if (!webViewLink) {
            const meta = await drive.files.get({ fileId, fields: "webViewLink", supportsAllDrives: true });
            webViewLink = meta.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
        }
        return { ok: true, fileId, webViewLink };
    } catch (err) {
        const detail = err?.errors?.[0]?.message || err?.message || String(err);
        return { ok: false, error: `❌ Error subiendo a Google Drive: ${detail}.` };
    }
}

module.exports = {
    getDriveConfig,
    uploadBufferToDrive,
};
