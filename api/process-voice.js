const fs = require("fs");
const { formidable } = require("formidable");
const { createNotionTaskPage } = require("./notionTaskPage");

function getBogotaReferenceTimeMmDdYy() {
    const ref = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    const mm = String(ref.getMonth() + 1).padStart(2, "0");
    const dd = String(ref.getDate()).padStart(2, "0");
    const yy = String(ref.getFullYear()).slice(-2);
    return `${mm}-${dd}-${yy}`;
}

function parseGeminiJson(raw) {
    const cleaned = String(raw || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
    return JSON.parse(cleaned);
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
        return res.status(400).json({ error: "Expected multipart/form-data" });
    }

    const form = formidable({
        maxFileSize: 25 * 1024 * 1024,
        allowEmptyFiles: false,
    });

    let files;
    try {
        [, files] = await form.parse(req);
    } catch (err) {
        console.error("Form parse error:", err);
        return res.status(400).json({ error: "Invalid form data" });
    }

    const fileField = files.audioFile;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!file || !file.filepath) {
        return res.status(400).json({ error: "Missing audioFile" });
    }

    // Read file as base64
    let base64String;
    try {
        const fileBuffer = fs.readFileSync(file.filepath);
        base64String = fileBuffer.toString("base64");
    } catch (err) {
        console.error("Failed to read audio file:", err);
        try {
            fs.unlinkSync(file.filepath);
        } catch (_) {}
        return res.status(500).json({ success: false, error: "Failed to read audio file" });
    }

    const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
        try {
            fs.unlinkSync(file.filepath);
        } catch (_) {}
        return res.status(500).json({ success: false, error: "Missing GEMINI_API_KEY" });
    }

    const audioPart = {
        inlineData: {
            data: base64String,
            mimeType: file.mimetype,
        },
    };
    const referenceTimeMmDdYy = getBogotaReferenceTimeMmDdYy();

    const prompt = `You are an expert task extraction assistant. Listen to the audio and output a strict, raw JSON object (no markdown, no backticks).

The JSON must have exactly these three keys:

1. "Name": (string) A concise, actionable title for the task.

2. "Area": (string) Categorize the task. You MUST choose EXACTLY ONE of these options: "Trabajo secundario", "Trabajo Traffix", "Iglesia", "Familia", "Carrera", "IA Dev", "Universidad", "Personales", or "Matrimonio". If unsure, use "Personales".

3. "Fecha": (string) If the audio mentions a deadline or specific day, calculate the date and output it in ISO format YYYY-MM-DD.
Use Reference Time (MM-DD-YY): ${referenceTimeMmDdYy}
- Highest-priority numeric date rule: interpret "MM DD YY" or "MM DD YYYY" as Month-Day-Year.
- Mandatory example: "05 08 26" means May 8, 2026.
- Accept relative dates in Spanish like "próximo martes", "mañana", "pasado mañana".
If no date is mentioned, return an empty string "".`

    let jsonResponse;
    let text = "";
    try {
        const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent("gemini-2.5-flash")}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const body = {
            generationConfig: { responseMimeType: "application/json" },
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }, audioPart],
                },
            ],
        };
        const result = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await result.json();
        if (!result.ok) {
            const detail = data?.error?.message || String(result.status);
            throw new Error(`Gemini API error: ${detail}`);
        }
        text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("").trim() || "";
        jsonResponse = parseGeminiJson(text);
    } catch (err) {
        console.error("Gemini structured response error:", err);
        try {
            fs.unlinkSync(file.filepath);
        } catch (_) {}
        return res.status(500).json({ success: false, error: err.message || "Transcription or parsing failed" });
    }

    // Cleanup temp file
    try {
        fs.unlinkSync(file.filepath);
    } catch (_) {}

    if (!jsonResponse || typeof jsonResponse !== "object" || !jsonResponse.Name) {
        return res.status(400).json({ success: false, error: "Invalid or empty structured transcription", transcription: text });
    }

    let notionData;
    try {
        notionData = await createNotionTaskPage(jsonResponse);
    } catch (err) {
        console.error("Notion error:", err);
        return res.status(500).json({
            success: false,
            error: err.message || "Notion create failed",
            transcription: jsonResponse,
        });
    }

    if (!notionData.ok) {
        return res.status(502).json({
            success: false,
            error: notionData.error,
            transcription: jsonResponse,
        });
    }

    return res.status(200).json({
        success: true,
        transcription: jsonResponse,
        notion: notionData,
    });
};

module.exports.config = {
    api: { bodyParser: false },
};
