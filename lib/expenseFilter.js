const axios = require("axios");
const { parseExpenseAmount } = require("./notionTaskPage");
const { uploadBufferToDrive } = require("./driveService");
const { createGastoMaestro } = require("./notionService");

const MICROGASTO_LIMIT = 50000;

const CLASIFICACION_MICROGASTO = "Categoría 2 - Informal Menor";
const ESTADO_DIAN_MICROGASTO = "Gasto Personal";
const CLASIFICACION_CRITICO = "Categoría 3 - Informal Mayor";
const ESTADO_DIAN_CRITICO = "Pendiente Documento Soporte";
const CLASIFICACION_FORMAL = "Categoría 1 - Formal";
const ESTADO_DIAN_FORMAL = (process.env.NOTION_ESTADO_DIAN_FORMAL || "").trim() || null;

const GASTO_FORMAT_HINT =
    "Formato: /gasto [monto] [descripción]\nEj: /gasto 18000 almuerzo\nCon factura: adjunta la foto o PDF con ese mismo texto como pie de foto.";

const GASTO_COMMAND_RE = /^\/gasto(?:@\w+)?(?:\s+([\s\S]*))?$/i;

/**
 * @param {string} text Texto del mensaje o caption del adjunto.
 * @returns {null | { ok: true, monto: number, descripcion: string } | { ok: false, error: string }}
 */
function parseGastoCommand(text) {
    const m = String(text || "").trim().match(GASTO_COMMAND_RE);
    if (!m) return null;
    const rest = String(m[1] || "").trim();
    const [amountToken = "", ...descTokens] = rest.split(/\s+/);
    const monto = parseExpenseAmount(amountToken.replace(/^\$/, ""));
    if (!amountToken || !Number.isFinite(monto) || monto <= 0) {
        return { ok: false, error: `⚠️ Como así mijo? Necesito un monto válido.\n${GASTO_FORMAT_HINT}` };
    }
    const descripcion = descTokens.join(" ").trim() || "Gasto";
    return { ok: true, monto, descripcion };
}

/**
 * Filtro de Viabilidad: decide clasificación fiscal y estado DIAN.
 * @param {{ monto: number, hasAttachment: boolean }} input
 * @returns {{ tipo: "formal"|"critico"|"microgasto", clasificacionFiscal: string, estadoDian: string|null }}
 */
function classifyExpense({ monto, hasAttachment }) {
    if (hasAttachment) {
        return { tipo: "formal", clasificacionFiscal: CLASIFICACION_FORMAL, estadoDian: ESTADO_DIAN_FORMAL };
    }
    if (monto >= MICROGASTO_LIMIT) {
        return { tipo: "critico", clasificacionFiscal: CLASIFICACION_CRITICO, estadoDian: ESTADO_DIAN_CRITICO };
    }
    return { tipo: "microgasto", clasificacionFiscal: CLASIFICACION_MICROGASTO, estadoDian: ESTADO_DIAN_MICROGASTO };
}

/**
 * Foto (se toma la resolución más alta) o documento PDF/imagen.
 * @returns {null | { fileId: string, fileName: string, mimeType: string }}
 */
function extractTelegramAttachment(message) {
    if (Array.isArray(message?.photo) && message.photo.length) {
        const best = message.photo[message.photo.length - 1];
        return { fileId: best.file_id, fileName: `soporte_${message.message_id || Date.now()}.jpg`, mimeType: "image/jpeg" };
    }
    const doc = message?.document;
    if (doc?.file_id) {
        const mimeType = String(doc.mime_type || "");
        if (mimeType === "application/pdf" || mimeType.startsWith("image/")) {
            return { fileId: doc.file_id, fileName: doc.file_name || `soporte_${message.message_id || Date.now()}`, mimeType };
        }
    }
    return null;
}

/**
 * Telegram solo permite descargar archivos de hasta 20 MB vía Bot API.
 * @returns {Promise<Buffer>}
 */
async function downloadTelegramFile(token, fileId) {
    const meta = await axios.get(`https://api.telegram.org/bot${token}/getFile`, { params: { file_id: fileId } });
    const filePath = meta.data?.result?.file_path;
    if (!filePath) throw new Error("Telegram no devolvió file_path para el adjunto.");
    const file = await axios.get(`https://api.telegram.org/file/bot${token}/${filePath}`, {
        responseType: "arraybuffer",
    });
    return Buffer.from(file.data);
}

function formatCop(monto) {
    return `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(monto)}`;
}

function buildDriveFileName(descripcion, originalName) {
    const ymd = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
    const slug = String(descripcion || "gasto")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w-]+/g, "_")
        .slice(0, 60);
    const ext = (String(originalName).match(/\.[a-z0-9]{2,5}$/i) || [""])[0];
    return `${ymd}_${slug}${ext}`;
}

function buildGastoReply({ descripcion, monto, classification, soporteDriveUrl, notionUrl }) {
    const lines = [
        "💸 Gasto registrado en DB_Gastos_Maestros mi papacho!",
        `📝 ${descripcion}`,
        `💰 ${formatCop(monto)}`,
        `🧾 ${classification.clasificacionFiscal}`,
    ];
    if (classification.estadoDian) lines.push(`🏛 Estado DIAN: ${classification.estadoDian}`);
    if (classification.tipo === "critico") {
        lines.push("⚠️ Ojo mijo: pasó de 50.000 sin soporte. Pida la factura o haga el documento soporte, no se me emocione!");
    }
    if (soporteDriveUrl) lines.push(`📎 Soporte en Drive: ${soporteDriveUrl}`);
    if (notionUrl) lines.push(`🔗 ${notionUrl}`);
    return lines.join("\n");
}

/**
 * Enruta `/gasto` (texto) y adjuntos con caption `/gasto` hacia Drive + Notion.
 * @param {(token: string, chatId: string|number, text: string, replyMarkup?: *, parseMode?: string|null) => Promise<*>} sendMessage
 * @returns {Promise<boolean>} true si el mensaje era un gasto (procesado o con error de formato).
 */
async function tryHandleGastoMessage(token, chatId, message, sendMessage) {
    const attachment = extractTelegramAttachment(message);
    const rawText = String(attachment ? message.caption || "" : message?.text || "").trim();
    const parsed = parseGastoCommand(rawText);

    if (!parsed) {
        if (attachment) {
            await sendMessage(
                token,
                chatId,
                `📎 Recibí el archivo pero no sé qué hacer con él mi rey.\n${GASTO_FORMAT_HINT}`,
                null,
                null
            );
            return true;
        }
        return false;
    }
    if (!parsed.ok) {
        await sendMessage(token, chatId, parsed.error, null, null);
        return true;
    }

    const { monto, descripcion } = parsed;
    const classification = classifyExpense({ monto, hasAttachment: Boolean(attachment) });

    try {
        let soporteDriveUrl = null;
        if (attachment) {
            const buffer = await downloadTelegramFile(token, attachment.fileId);
            const upload = await uploadBufferToDrive({
                buffer,
                fileName: buildDriveFileName(descripcion, attachment.fileName),
                mimeType: attachment.mimeType,
            });
            if (!upload.ok) {
                await sendMessage(token, chatId, `${upload.error} No registré el gasto, intente de nuevo mi papacho.`, null, null);
                return true;
            }
            soporteDriveUrl = upload.webViewLink;
        }

        const page = await createGastoMaestro({
            descripcion,
            monto,
            clasificacionFiscal: classification.clasificacionFiscal,
            estadoDian: classification.estadoDian,
            soporteDriveUrl,
        });

        await sendMessage(
            token,
            chatId,
            buildGastoReply({ descripcion, monto, classification, soporteDriveUrl, notionUrl: page.url }),
            null,
            null
        );
    } catch (err) {
        console.error("[gasto] error", err);
        await sendMessage(
            token,
            chatId,
            `❌ No pude registrar el gasto mi rey: ${err?.message || err}. Revise y me charla!`,
            null,
            null
        );
    }
    return true;
}

module.exports = {
    MICROGASTO_LIMIT,
    CLASIFICACION_MICROGASTO,
    ESTADO_DIAN_MICROGASTO,
    CLASIFICACION_CRITICO,
    ESTADO_DIAN_CRITICO,
    CLASIFICACION_FORMAL,
    parseGastoCommand,
    classifyExpense,
    extractTelegramAttachment,
    tryHandleGastoMessage,
};
