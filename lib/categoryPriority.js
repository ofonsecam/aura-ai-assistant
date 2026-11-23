/**
 * Prioridad y emoji semántico por categoría (Area) para listados y cron.
 * Categorías no registradas: prioridad Infinity y emoji ▫️.
 */

const DEFAULT_CATEGORY_PRIORITY = Number.POSITIVE_INFINITY;
const DEFAULT_CATEGORY_EMOJI = '▫️';

/** @type {Readonly<Record<string, { priority: number, emoji: string }>>} */
const CATEGORY_PRIORITY_CONFIG = Object.freeze({
    Matrimonio: { priority: 1, emoji: '💍' },
    Martin: { priority: 2, emoji: '🧸' },
    Yulis: { priority: 3, emoji: '💕' },
    Personales: { priority: 4, emoji: '🏠' },
    Iglesia: { priority: 5, emoji: '⛪' },
    Proyecto: { priority: 6, emoji: '🚀' },
    Tareas_u: { priority: 7, emoji: '📝' },
    Universidad: { priority: 8, emoji: '🎓' },
    Trabajo: { priority: 9, emoji: '💼' },
});

/**
 * Alias históricos / variantes → clave canónica de CATEGORY_PRIORITY_CONFIG.
 * Claves ya normalizadas (minúsculas, sin tildes, espacios colapsados).
 */
const CATEGORY_ALIASES = Object.freeze({
    yu: 'Yulis',
    martin: 'Martin',
    personal: 'Personales',
    proyectos: 'Proyecto',
    estudio_p: 'Proyecto',
    'tareas u': 'Tareas_u',
    traffix: 'Trabajo',
    'trabajo traffix': 'Trabajo',
    carrera: 'Trabajo',
});

/**
 * Normaliza cadenas ignorando mayúsculas, espacios extra y diacríticos (NFD).
 * @param {string} text
 * @returns {string}
 */
function toCategoryKey(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * Resuelve el nombre canónico de categoría (mapa o alias).
 * Si no coincide con ninguna clave configurada, conserva el texto limpio original.
 * @param {string} area
 * @returns {string|null} Clave canónica, texto limpio, o null si vacío.
 */
function resolveCanonicalCategory(area) {
    const raw = String(area ?? '').trim();
    if (!raw) return null;
    const key = toCategoryKey(raw);
    if (!key) return null;
    if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
    for (const name of Object.keys(CATEGORY_PRIORITY_CONFIG)) {
        if (toCategoryKey(name) === key) return name;
    }
    return raw;
}

/** @deprecated Usar resolveCanonicalCategory */
function resolveCategoryCanonical(area) {
    const resolved = resolveCanonicalCategory(area);
    if (resolved && CATEGORY_PRIORITY_CONFIG[resolved]) return resolved;
    return null;
}

/**
 * @param {string} area
 * @returns {{ priority: number, emoji: string, canonical: string|null, isConfigured: boolean }}
 */
function getCategoryMeta(area) {
    const resolved = resolveCanonicalCategory(area);
    if (resolved && CATEGORY_PRIORITY_CONFIG[resolved]) {
        const meta = CATEGORY_PRIORITY_CONFIG[resolved];
        return {
            priority: meta.priority,
            emoji: meta.emoji,
            canonical: resolved,
            isConfigured: true,
        };
    }
    return {
        priority: DEFAULT_CATEGORY_PRIORITY,
        emoji: DEFAULT_CATEGORY_EMOJI,
        canonical: null,
        isConfigured: false,
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
 * conserva el orden original (fecha/creación). Áreas no configuradas van al final.
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

/**
 * Nombres únicos de áreas presentes en `tasks` sin prioridad configurada (O(n)).
 * @param {{ area?: string }[]} tasks
 * @returns {string[]}
 */
function getUnconfiguredCategories(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    const seen = new Set();
    const out = [];
    for (const task of list) {
        const label = String(task?.area ?? '').trim();
        if (!label) continue;
        const meta = getCategoryMeta(label);
        if (!meta.isConfigured && !seen.has(label)) {
            seen.add(label);
            out.push(label);
        }
    }
    return out;
}

/**
 * Escapa caracteres que rompen parse_mode Markdown legacy de Telegram
 * (`*`, `_`, `[`, `]`, `` ` ``) en texto dinámico (p. ej. nombres de Area).
 * @param {string} text
 * @returns {string}
 */
function escapeTelegramMarkdown(text) {
    return String(text || '').replace(/([_*[\]`])/g, '\\$1');
}

/**
 * Aviso corto al final del listado si hay áreas sin prioridad.
 * Compatible con parse_mode Markdown de Telegram. Vacío si todo está configurado.
 * @param {{ area?: string }[]} tasks
 * @returns {string}
 */
function buildUnconfiguredReminder(tasks) {
    const unconfigured = getUnconfiguredCategories(tasks);
    if (!unconfigured.length) return '';
    const names = unconfigured.map(escapeTelegramMarkdown).join(', ');
    return (
        `\n\n⚠️ Área(s) sin prioridad: ${names}. ` +
        'Ajusta CATEGORY\\_PRIORITY\\_CONFIG en lib/categoryPriority.js'
    );
}

module.exports = {
    CATEGORY_PRIORITY_CONFIG,
    CATEGORY_ALIASES,
    DEFAULT_CATEGORY_PRIORITY,
    DEFAULT_CATEGORY_EMOJI,
    getCategoryMeta,
    getCategoryPriority,
    getCategoryEmoji,
    sortTasksByCategoryPriority,
    resolveCanonicalCategory,
    resolveCategoryCanonical,
    getUnconfiguredCategories,
    buildUnconfiguredReminder,
    escapeTelegramMarkdown,
};
