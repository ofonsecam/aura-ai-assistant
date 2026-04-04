const fs = require("fs");
const { formidable } = require("formidable");
const OpenAI = require("openai");
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

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let transcription;
    try {
        transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(file.filepath),
            model: "whisper-1",
        });
    } catch (err) {
        console.error("Whisper error:", err);
        try {
            fs.unlinkSync(file.filepath);
        } catch (_) {}
        return res.status(500).json({ success: false, error: err.message || "Transcription failed" });
    }

    try {
        fs.unlinkSync(file.filepath);
    } catch (_) {}

    const text = (transcription.text || "").trim();
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
