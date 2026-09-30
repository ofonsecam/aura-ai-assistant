const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Flash vigente en la Gemini API.
 * `gemini-1.5-flash` fue apagado; el resto de Aura ya llama a este modelo.
 */
const INVOICE_MODEL = "gemini-2.5-flash";
/** Por debajo de maxDuration (60s) en vercel.json, para que la función alcance a responder. */
const GEMINI_TIMEOUT_MS = 50000;

const INVOICE_PROMPT =
    'Eres un auditor fiscal. Analiza la imagen de esta factura y extrae exclusivamente el NIT (o número de identificación) y la Razón Social (nombre del comercio). Responde ÚNICAMENTE con un objeto JSON válido con la siguiente estructura exacta: {"nit": "valor", "razonSocial": "valor"}. Si un dato no existe o no es legible, asigna null al valor. No devuelvas texto adicional ni markdown.';

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeFiscalValue(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === "null") return null;
    return text;
}

function readFiscalField(parsed, names) {
    const norm = (value) =>
        String(value)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, "");
    const wanted = new Set(names.map(norm));
    for (const [key, value] of Object.entries(parsed)) {
        if (wanted.has(norm(key))) return value;
    }
    return null;
}

/**
 * Primer objeto JSON balanceado. Sirve cuando Gemini deja texto alrededor del JSON.
 * @param {string} text
 * @returns {string|null}
 */
function extractBalancedJsonObject(text) {
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escape) escape = false;
            else if (ch === "\\") escape = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
            depth -= 1;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * @param {string} raw
 * @returns {{ nit: string|null, razonSocial: string|null }}
 */
function parseInvoiceJson(raw) {
    const rawText = String(raw || "");
    const cleanText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    if (!cleanText) throw new Error("Gemini devolvió una respuesta vacía.");

    let parsed;
    try {
        parsed = JSON.parse(cleanText);
    } catch {
        const objectText = extractBalancedJsonObject(cleanText);
        if (!objectText) {
            throw new Error(`Gemini devolvió un JSON inválido: ${cleanText.slice(0, 400)}`);
        }
        try {
            parsed = JSON.parse(objectText);
        } catch {
            throw new Error(`Gemini devolvió un JSON inválido: ${cleanText.slice(0, 400)}`);
        }
    }

    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            throw new Error(`Gemini devolvió un JSON inválido: ${cleanText.slice(0, 400)}`);
        }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Gemini devolvió un JSON con forma inesperada: ${cleanText.slice(0, 400)}`);
    }

    return {
        nit: normalizeFiscalValue(readFiscalField(parsed, ["nit", "nitCedula", "cedula", "identificacion"])),
        razonSocial: normalizeFiscalValue(
            readFiscalField(parsed, ["razonSocial", "razon", "nombreComercio", "comercio"])
        ),
    };
}

/**
 * Extrae NIT y razón social de una factura (imagen o PDF).
 * @param {Buffer} fileBuffer
 * @param {string} mimeType
 * @returns {Promise<{ nit: string|null, razonSocial: string|null }>}
 */
async function extractInvoiceData(fileBuffer, mimeType) {
    const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY.");
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        throw new Error("El buffer de la factura está vacío.");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel(
        {
            model: INVOICE_MODEL,
            generationConfig: { temperature: 0 },
        },
        { apiVersion: "v1", timeout: GEMINI_TIMEOUT_MS }
    );

    const imagePart = {
        inlineData: {
            mimeType: mimeType || "image/jpeg",
            data: fileBuffer.toString("base64"),
        },
    };
    const result = await model.generateContent([INVOICE_PROMPT, imagePart]);
    const rawText = result.response.text();
    const cleanText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const extractedData = parseInvoiceJson(cleanText);
    if (extractedData.nit == null && extractedData.razonSocial == null) {
        console.error("[gasto] Gemini respondió sin NIT ni razón social. Texto:", cleanText.slice(0, 400));
    }
    return extractedData;
}

module.exports = {
    INVOICE_MODEL,
    extractInvoiceData,
};
