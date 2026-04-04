const fs = require("fs");
const { formidable } = require("formidable");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createNotionTaskPage } = require("./notionTaskPage");

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

    // Prepare Gemini client and model with JSON response config
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const audioPart = {
        inlineData: {
            data: base64String,
            mimeType: file.mimetype,
        },
    };

    const prompt = `You are an expert task extraction assistant. Listen to the audio and output a strict, raw JSON object (no markdown, no backticks).

The JSON must have exactly these three keys:

1. "Name": (string) A concise, actionable title for the task.

2. "Area": (string) Categorize the task. You MUST choose EXACTLY ONE of these options: "Trabajo secundario", "Trabajo Traffix", "Iglesia", "Familia", "Carrera", "IA Dev", "Universidad", or "Personales". If unsure, use "Personales".

3. "Fecha": (string) If the audio mentions a deadline or specific day, calculate the date and output it in ISO format YYYY-MM-DD. Today's date is 2026-04-04. If no date is mentioned, return an empty string "".`

    let jsonResponse;
    let text = "";
    try {
        const result = await model.generateContent([prompt, audioPart]);
        text = (await result.response.text() || "").trim();
        jsonResponse = JSON.parse(text);
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

    return res.status(200).json({
        success: true,
        transcription: jsonResponse,
        notion: notionData,
    });
};

module.exports.config = {
    api: { bodyParser: false },
};
