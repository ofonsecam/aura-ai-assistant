const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Flash vigente en la Gemini API.
 * `gemini-1.5-flash` fue apagado; el resto de Aura ya llama a este modelo.
 */
const INVOICE_MODEL = "gemini-2.5-flash";

const INVOICE_PROMPT = [
    "Eres un auditor fiscal. Analiza la imagen de esta factura y extrae exclusivamente el NIT (o número de identificación) y la Razón Social (nombre del comercio).",
    'Responde ÚNICAMENTE con un objeto JSON válido con la siguiente estructura exacta: {"nit": "valor", "razonSocial": "valor"}.',
    "Si un dato no existe o no es legible, asigna null al valor. No devuelvas texto adicional ni markdown.",
].join(" ");

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

/**
 * @param {string} raw
 * @returns {{ nit: string|null, razonSocial: string|null }}
 */
function parseInvoiceJson(raw) {
    const text = String(raw || "").trim();
    if (!text) throw new Error("Gemini devolvió una respuesta vacía.");

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced ? fenced[1] : text).trim();

    let parsed;
    try {
        parsed = JSON.parse(candidate);
    } catch {
        const objectMatch = candidate.match(/\{[\s\S]*\}/);
        if (!objectMatch) throw new Error("Gemini devolvió un JSON inválido.");
        try {
            parsed = JSON.parse(objectMatch[0]);
        } catch {
            throw new Error("Gemini devolvió un JSON inválido.");
        }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Gemini devolvió un JSON con forma inesperada.");
    }

    return {
        nit: normalizeFiscalValue(parsed.nit),
        razonSocial: normalizeFiscalValue(parsed.razonSocial),
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
            systemInstruction: INVOICE_PROMPT,
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
        },
        { apiVersion: "v1", timeout: 20000 }
    );

    const result = await model.generateContent([
        { text: INVOICE_PROMPT },
        {
            inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: fileBuffer.toString("base64"),
            },
        },
    ]);

    const responseText = result?.response?.text?.();
    return parseInvoiceJson(responseText);
}

module.exports = {
    INVOICE_MODEL,
    extractInvoiceData,
};
