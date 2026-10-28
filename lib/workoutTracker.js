const {
    logWorkoutSession,
    normalizeWorkoutSession,
    WORKOUT_MOLESTIA_ALERTA,
} = require("./notionService");

const WORKOUT_TENDON_WARNING =
    "⚠️ Advertencia biomecánica: en la próxima sesión sustituye la cuerda por caminadora inclinada o descanso activo para proteger el tendón de Aquiles.";

function fold(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

/**
 * Confirmación de Telegram. Si la molestia es alerta de tendón, incluye la advertencia biomecánica.
 * @param {{ fecha: string, semanaSesion: string, protocolo: string, completado: boolean, molestiaArticular: string, notas: string }} session
 * @returns {string}
 */
function buildWorkoutTelegramReply(session) {
    const lines = [
        "✅ Sesión de salto de cuerda registrada en DB_Workout_Tracker mi papacho!",
        `📅 ${session.fecha}`,
        `🗓 ${session.semanaSesion} · ${session.protocolo}`,
        `✔ Completado: ${session.completado ? "sí" : "no"}`,
        `🦵 ${session.molestiaArticular}`,
        `📝 ${session.notas}`,
    ];
    if (session.molestiaArticular === WORKOUT_MOLESTIA_ALERTA) {
        lines.push(WORKOUT_TENDON_WARNING);
    }
    return lines.join("\n");
}

/**
 * Dolor de tendón o espinilla → alerta 2. Fatiga muscular → 1. Sin queja → 0.
 * @param {string} text
 * @returns {string}
 */
function inferMolestiaFromText(text) {
    const n = fold(text);
    if (/tendon|periostio|espinilla|aquiles|canilla|\bshin\b/.test(n)) {
        return "2 - Alerta tendón/periostio";
    }
    if (/\bfatiga\b/.test(n)) return "1 - Fatiga muscular";
    if (/\bdolor\b/.test(n) && !/sin dolor/.test(n)) return "2 - Alerta tendón/periostio";
    return "0 - Impecable";
}

/**
 * Atajo determinista: cuerda/salto/cardio + sesión (s1d1) + protocolo (30/30).
 * Devuelve null si el mensaje no es un registro de sesión.
 * @param {string} text
 * @returns {object|null}
 */
function parseWorkoutMessage(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const folded = fold(raw);
    if (!/\b(salto|cuerda|cardio)\b/.test(folded)) return null;

    const sesionMatch = raw.match(/\bs\s*(\d+)\s*[-_\s]?\s*d\s*(\d+)\b/i);
    const protoMatch = raw.match(/(\d+)\s*s?\s*\/\s*(\d+)\s*s?/i);
    if (!sesionMatch || !protoMatch) return null;

    const notas = raw
        .replace(sesionMatch[0], " ")
        .replace(protoMatch[0], " ")
        .replace(/\b(aura|completé|complete|completado|hoy|hice|salto|cuerda|cardio|protocolo)\b/gi, " ")
        .replace(/[,.:;¡!¿?]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const completado = !/\b(no\s+complet|incomplet|no\s+termin|no\s+lo\s+hice)\b/.test(folded);

    return {
        semanaSesion: sesionMatch[0],
        protocolo: protoMatch[0],
        completado,
        molestiaArticular: inferMolestiaFromText(raw),
        notas,
        fecha: "",
    };
}

async function replyWithWorkout(token, chatId, raw, sendMessage) {
    try {
        const saved = await logWorkoutSession(raw);
        await sendMessage(token, chatId, buildWorkoutTelegramReply(saved), null, null);
    } catch (err) {
        console.error("[workout]", err);
        await sendMessage(
            token,
            chatId,
            `⚠️ ${err.message || "No pude registrar la sesión de cuerda."}`,
            null,
            null
        );
    }
}

/**
 * Registra la sesión sin pasar por Gemini cuando el mensaje ya trae sesión y protocolo.
 * @returns {Promise<boolean>}
 */
async function tryHandleWorkoutMessage(token, chatId, text, sendMessage) {
    const parsed = parseWorkoutMessage(text);
    if (!parsed) return false;
    await replyWithWorkout(token, chatId, parsed, sendMessage);
    return true;
}

/**
 * Intent WORKOUT devuelto por Gemini. Normaliza y escribe en Notion.
 * @returns {Promise<boolean>}
 */
async function handleWorkoutIntent(token, chatId, data, sendMessage) {
    await replyWithWorkout(token, chatId, data, sendMessage);
    return true;
}

module.exports = {
    WORKOUT_TENDON_WARNING,
    buildWorkoutTelegramReply,
    parseWorkoutMessage,
    tryHandleWorkoutMessage,
    handleWorkoutIntent,
    normalizeWorkoutSession,
};
