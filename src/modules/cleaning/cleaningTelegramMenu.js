const { sortCleaningCheckboxPropertyNames } = require("./cleaningNotion");

/** Prefijo de callback_data para marcar aseo (no colisiona con hm: de hábitos). */
const CLEANING_CALLBACK_PREFIX = "cl:";

/**
 * @param {number} index
 */
function encodeCleaningIndexCallback(index) {
    return `${CLEANING_CALLBACK_PREFIX}${index}`;
}

/**
 * @param {string} callbackData
 * @returns {number|null}
 */
function decodeCleaningIndexCallback(callbackData) {
    const data = String(callbackData || "");
    if (!data.startsWith(CLEANING_CALLBACK_PREFIX)) return null;
    const raw = data.slice(CLEANING_CALLBACK_PREFIX.length);
    if (!/^\d+$/.test(raw)) return null;
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0) return null;
    return index;
}

/**
 * @param {string[]} sortedFilteredNames
 * @param {number} index
 * @returns {string|null}
 */
function resolveCleaningPropertyKeyBySortedIndex(sortedFilteredNames, index) {
    const sorted = sortCleaningCheckboxPropertyNames(sortedFilteredNames);
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= sorted.length) return null;
    return sorted[i];
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
 * @param {{ cron?: boolean, dayPrefix?: string }} [opts]
 */
function buildCleaningPendingMessage(pending, opts = {}) {
    const list = Array.isArray(pending) ? pending : [];
    if (!list.length) {
        return "✅ *Aseo del día completado.* ¡Bien hecho mi rey!";
    }
    const dayLabel = opts.dayPrefix ? ` ${opts.dayPrefix}` : "";
    const header = opts.cron
        ? `🧹 *Recordatorio de aseo* — pendientes hoy${dayLabel}:`
        : `🧹 *Aseo pendiente hoy${dayLabel}:*`;
    const lines = list.map((h, i) => `${i + 1}. ${escapeTelegramMarkdown(h.name || h.propertyKey)}`);
    return `${header}\n\n${lines.join("\n")}\n\n_Toca un botón para marcarlo como hecho._`;
}

/**
 * @param {{ propertyKey: string, name: string }[]} pending
 * @param {string[]} sortedFilteredNames Nombres filtrados del día, orden alfabético.
 */
function buildCleaningPendingKeyboard(pending, sortedFilteredNames) {
    const list = Array.isArray(pending) ? pending : [];
    if (!list.length) return { inline_keyboard: [] };

    const sorted = sortCleaningCheckboxPropertyNames(sortedFilteredNames);
    const indexByKey = new Map(sorted.map((name, i) => [name, i]));

    const rows = [];
    let row = [];
    for (const item of list) {
        const sortedIndex = indexByKey.get(item.propertyKey);
        if (sortedIndex == null) continue;
        const label = String(item.name || item.propertyKey || "Aseo").slice(0, 40);
        row.push({ text: `✅ ${label}`, callback_data: encodeCleaningIndexCallback(sortedIndex) });
        if (row.length >= 2) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length) rows.push(row);
    return { inline_keyboard: rows };
}

module.exports = {
    CLEANING_CALLBACK_PREFIX,
    encodeCleaningIndexCallback,
    decodeCleaningIndexCallback,
    resolveCleaningPropertyKeyBySortedIndex,
    buildCleaningPendingMessage,
    buildCleaningPendingKeyboard,
};
