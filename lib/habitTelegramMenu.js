/** Prefijo de callback_data para marcar un hábito pendiente (índice corto, máx. 64 bytes en Telegram). */
const HABIT_CALLBACK_PREFIX = "hm:";

/**
 * Orden alfabético estricto compartido entre menú y callback (stateless en Vercel).
 * @param {string[]} names
 * @returns {string[]}
 */
function sortHabitCheckboxPropertyNames(names) {
    return [...(Array.isArray(names) ? names : [])].sort((a, b) =>
        String(a).localeCompare(String(b), "es")
    );
}

/**
 * Resuelve el nombre de propiedad Notion por índice en el arreglo ordenado.
 * @param {string[]} sortedCheckboxNames
 * @param {number} index
 * @returns {string|null}
 */
function resolveHabitPropertyKeyBySortedIndex(sortedCheckboxNames, index) {
    const sorted = sortHabitCheckboxPropertyNames(sortedCheckboxNames);
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= sorted.length) return null;
    return sorted[i];
}

/**
 * Codifica el índice del hábito en callback_data (ej. hm:0, hm:1).
 * @param {number} index
 */
function encodeHabitIndexCallback(index) {
    return `${HABIT_CALLBACK_PREFIX}${index}`;
}

/**
 * @param {string} callbackData
 * @returns {number|null}
 */
function decodeHabitIndexCallback(callbackData) {
    const data = String(callbackData || "");
    if (!data.startsWith(HABIT_CALLBACK_PREFIX)) return null;
    const raw = data.slice(HABIT_CALLBACK_PREFIX.length);
    if (!/^\d+$/.test(raw)) return null;
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0) return null;
    return index;
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
 * @param {string[]} sortedCheckboxNames Nombres checkbox del esquema Notion, orden alfabético estricto.
 */
function buildHabitsPendingKeyboard(pending, sortedCheckboxNames) {
    const list = Array.isArray(pending) ? pending : [];
    if (!list.length) return { inline_keyboard: [] };

    const sorted = sortHabitCheckboxPropertyNames(sortedCheckboxNames);
    const indexByKey = new Map(sorted.map((name, i) => [name, i]));

    const rows = [];
    let row = [];
    for (const habit of list) {
        const sortedIndex = indexByKey.get(habit.propertyKey);
        if (sortedIndex == null) continue;
        const label = String(habit.name || habit.propertyKey || "Hábito").slice(0, 40);
        row.push({ text: `✅ ${label}`, callback_data: encodeHabitIndexCallback(sortedIndex) });
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
    sortHabitCheckboxPropertyNames,
    resolveHabitPropertyKeyBySortedIndex,
    encodeHabitIndexCallback,
    decodeHabitIndexCallback,
    buildHabitsPendingMessage,
    buildHabitsPendingKeyboard,
};
