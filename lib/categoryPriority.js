/**
 * Prioridad y emoji de rombo por categoría (Area) para listados y cron.
 * Categorías no registradas: prioridad >= 12 y emoji 🔹.
 */

const DEFAULT_CATEGORY_PRIORITY = 12;
const DEFAULT_CATEGORY_EMOJI = '🔹';

/** @type {Readonly<Record<string, { priority: number, emoji: string }>>} */
const CATEGORY_PRIORITY_CONFIG = Object.freeze({
    Yu: { priority: 1, emoji: '🟣' },
    Martin: { priority: 2, emoji: '🔹' },
    Personales: { priority: 3, emoji: '🤍' },
    Tareas_u: { priority: 4, emoji: '🔵' },
    Iglesia: { priority: 5, emoji: '🟫' },
    F_i: { priority: 6, emoji: '🔴' },
    Aseo: { priority: 7, emoji: '🩶' },
    Carrera: { priority: 8, emoji: '🟡' },
    Universidad: { priority: 9, emoji: '🟡' },
    Traffix: { priority: 10, emoji: '🟫' },
    S_j: { priority: 11, emoji: '🟢' },
});

/** Alias canónicos → clave de CATEGORY_PRIORITY_CONFIG. */
const CATEGORY_ALIASES = Object.freeze({
    'trabajo traffix': 'Traffix',
    traffix: 'Traffix',
    fi: 'F_i',
    f_i: 'F_i',
    sj: 'S_j',
    s_j: 'S_j',
    tareas_u: 'Tareas_u',
});

function toCategoryKey(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Resuelve el nombre canónico de categoría si está en el mapa (o alias).
 * @param {string} area
 * @returns {string|null}
 */
function resolveCategoryCanonical(area) {
    const key = toCategoryKey(area);
    if (!key) return null;
    if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
    for (const name of Object.keys(CATEGORY_PRIORITY_CONFIG)) {
        if (toCategoryKey(name) === key) return name;
    }
    return null;
}

/**
 * @param {string} area
 * @returns {{ priority: number, emoji: string, canonical: string|null }}
 */
function getCategoryMeta(area) {
    const canonical = resolveCategoryCanonical(area);
    if (canonical && CATEGORY_PRIORITY_CONFIG[canonical]) {
        const meta = CATEGORY_PRIORITY_CONFIG[canonical];
        return { priority: meta.priority, emoji: meta.emoji, canonical };
    }
    return {
        priority: DEFAULT_CATEGORY_PRIORITY,
        emoji: DEFAULT_CATEGORY_EMOJI,
        canonical: null,
    };
}

function getCategoryPriority(area) {
    return getCategoryMeta(area).priority;
}

function getCategoryEmoji(area) {
    return getCategoryMeta(area).emoji;
}

/**
 * Orden estable: prioridad de categoría ascendente; dentro de la misma prioridad
 * conserva el orden original (fecha/creación).
 * @template {{ area?: string }} T
 * @param {T[]} tasks
 * @returns {T[]}
 */
function sortTasksByCategoryPriority(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    return list
        .map((task, index) => ({ task, index, priority: getCategoryPriority(task?.area) }))
        .sort((a, b) => a.priority - b.priority || a.index - b.index)
        .map((entry) => entry.task);
}

module.exports = {
    CATEGORY_PRIORITY_CONFIG,
    DEFAULT_CATEGORY_PRIORITY,
    DEFAULT_CATEGORY_EMOJI,
    getCategoryMeta,
    getCategoryPriority,
    getCategoryEmoji,
    sortTasksByCategoryPriority,
    resolveCategoryCanonical,
};
