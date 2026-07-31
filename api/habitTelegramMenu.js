/** Prefijo de callback_data para marcar un hábito pendiente. */
const HABIT_CALLBACK_PREFIX = "hm:";

/**
 * Codifica el nombre de propiedad Notion para callback_data (máx. 64 bytes en Telegram).
 * @param {string} propertyKey
 */
function encodeHabitPropertyCallback(propertyKey) {
    const raw = Buffer.from(String(propertyKey || ""), "utf8").toString("base64url");
    return `${HABIT_CALLBACK_PREFIX}${raw}`;
}

/**
 * @param {string} callbackData
 * @returns {string|null}
 */
function decodeHabitPropertyCallback(callbackData) {
    const data = String(callbackData || "");
    if (!data.startsWith(HABIT_CALLBACK_PREFIX)) return null;
    try {
        return Buffer.from(data.slice(HABIT_CALLBACK_PREFIX.length), "base64url").toString("utf8");
    } catch {
        return null;
    }
}

function escapeTelegramMarkdown(text) {
    return String(text || "")
        .replace(/\\/g, "\\\\")
        .replace(/\*/g, "\\*")
        .replace(/_/g, "\\_")
        .replace(/\[/g, "\\[")
        .replace(/`/g, "\\`");
}

/**
 * @param {{ propertyKey: string, name: string }[]} pending
 * @param {{ cron?: boolean }} [opts]
 */
function buildHabitsPendingMessage(pending, opts = {}) {
    const list = Array.isArray(pending) ? pending : [];
    if (!list.length) {
        return "✅ *Todos los hábitos del día completados.* ¡Bien hecho mi rey!";
    }
    const header = opts.cron
        ? "⏰ *Recordatorio de hábitos* — pendientes hoy:"
        : "📋 *Hábitos pendientes hoy:*";
    const lines = list.map((h, i) => `${i + 1}. ${escapeTelegramMarkdown(h.name || h.propertyKey)}`);
    return `${header}\n\n${lines.join("\n")}\n\n_Toca un botón para marcarlo como hecho._`;
}

/**
 * @param {{ propertyKey: string, name: string }[]} pending
 */
function buildHabitsPendingKeyboard(pending) {
    const list = Array.isArray(pending) ? pending : [];
    if (!list.length) return { inline_keyboard: [] };

    const rows = [];
    let row = [];
    for (const habit of list) {
        const label = String(habit.name || habit.propertyKey || "Hábito").slice(0, 40);
        const callback = encodeHabitPropertyCallback(habit.propertyKey);
        if (callback.length > 64) continue;
        row.push({ text: `✅ ${label}`, callback_data: callback });
        if (row.length >= 2) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length) rows.push(row);
    return { inline_keyboard: rows };
}

module.exports = {
    HABIT_CALLBACK_PREFIX,
    encodeHabitPropertyCallback,
    decodeHabitPropertyCallback,
    buildHabitsPendingMessage,
    buildHabitsPendingKeyboard,
};
