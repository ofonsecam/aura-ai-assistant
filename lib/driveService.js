const { Readable } = require("node:stream");

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

let cachedDriveClient = null;

/**
 * Credenciales exclusivas de Drive: GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.
 * GOOGLE_SERVICE_ACCOUNT_JSON pertenece al servicio heredado de Calendar y no debe usarse aquí.
 * @returns {{ ok: true, clientEmail: string, privateKey: string, folderId: string } | { ok: false, error: string }}
 */
function getDriveConfig() {
    const clientEmail = String(process.env.GOOGLE_CLIENT_EMAIL || "").trim();
    const privateKey = String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
    const folderId = String(process.env.DRIVE_FOLDER_ID || "").trim();

    const missing = [];
    if (!clientEmail) missing.push("GOOGLE_CLIENT_EMAIL");
    if (!privateKey) missing.push("GOOGLE_PRIVATE_KEY");
    if (!folderId) missing.push("DRIVE_FOLDER_ID");
    if (missing.length) {
        return { ok: false, error: `❌ Faltan variables de Google Drive: ${missing.join(", ")}.` };
    }
    if (!privateKey.includes("BEGIN PRIVATE KEY")) {
        return { ok: false, error: "❌ GOOGLE_PRIVATE_KEY no parece una llave PEM válida (revisa los \\n)." };
    }
    return { ok: true, clientEmail, privateKey, folderId };
}

/**
 * `googleapis` se carga bajo demanda: es pesado y solo lo necesitan los gastos con soporte.
 */
function getDriveClient(config) {
    if (cachedDriveClient) return cachedDriveClient;
    const { google } = require("googleapis");
    const googleAuth = new google.auth.GoogleAuth({
        credentials: {
            client_email: config.clientEmail,
            private_key: config.privateKey,
        },
        scopes: DRIVE_SCOPES,
    });
    cachedDriveClient = google.drive({ version: "v3", auth: googleAuth });
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
        const quotaHint = /storage quota/i.test(detail)
            ? " La cuenta de servicio no tiene cuota propia: DRIVE_FOLDER_ID debe estar en una Unidad compartida."
            : "";
        return { ok: false, error: `❌ Error subiendo a Google Drive: ${detail}.${quotaHint}` };
    }
}

module.exports = {
    getDriveConfig,
    uploadBufferToDrive,
};
