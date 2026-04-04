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

    // Prepare Gemini client and model
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const audioPart = {
        inlineData: {
            data: base64String,
            mimeType: file.mimetype,
        },
    };

    const prompt = "You are an assistant. Listen to this audio and return exactly the text spoken, nothing else. Do not use markdown.";

    let text = "";
    try {
        const result = await model.generateContent([prompt, audioPart]);
        text = (await result.response.text() || "").trim();
    } catch (err) {
        console.error("Gemini speech-to-text error:", err);
        try {
            fs.unlinkSync(file.filepath);
        } catch (_) {}
        return res.status(500).json({ success: false, error: err.message || "Transcription failed" });
    }

    // Cleanup temp file
    try {
        fs.unlinkSync(file.filepath);
    } catch (_) {}

    if (!text) {
        return res.status(400).json({ success: false, error: "Empty transcription" });
    }

    let notionData;
    try {
        notionData = await createNotionTaskPage(text);
    } catch (err) {
        console.error("Notion error:", err);
        return res.status(500).json({
            success: false,
            error: err.message || "Notion create failed",
            transcription: text,
        });
    }

    return res.status(200).json({
        success: true,
        transcription: text,
        notion: notionData,
    });
};

module.exports.config = {
    api: { bodyParser: false },
};
