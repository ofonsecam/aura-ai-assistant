/**
 * Aseo diario (Notion) — modelo stateless (sin estado entre invocaciones serverless).
 * Env: NOTION_CLEANING_ID, NOTION_TOKEN.
 */

const BOGOTA_TZ = "America/Bogota";
const PAGE_TITLE_PROPERTY = "YYYY MM DD";
const DATE_PROPERTY = "Date";
const NOTION_UUID_RE =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

/** Prefijos de día (Bogotá). getDay(): 0=domingo … 6=sábado. */
const DAY_PREFIX_BY_GETDAY = Object.freeze({
    0: "[DOM]",
    1: "[LUN]",
    2: "[MAR]",
    3: "[MIE]",
    4: "[JUE]",
    5: "[VIE]",
    6: "[SAB]",
});

const DIARIO_PREFIX = "[DIARIO]";

let cleaningCheckboxSchemaCache = { names: null, fetchedAt: 0 };
const CLEANING_SCHEMA_CACHE_MS = 5 * 60 * 1000;

function getCleaningDatabaseId() {
    return (process.env.NOTION_CLEANING_ID || "").trim();
}

function notionHeadersOrThrow() {
    const notionToken = String(process.env.NOTION_TOKEN || "").trim();
    if (!notionToken) {
        throw new Error("Falta NOTION_TOKEN.");
    }
    return {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    };
}

function getBogotaNowParts() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: BOGOTA_TZ }));
    const pad = (n) => String(n).padStart(2, "0");
    return {
        now,
        dayTitle: `${now.getFullYear()} ${pad(now.getMonth() + 1)} ${pad(now.getDate())}`,
        dateIso: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        dayPrefix: DAY_PREFIX_BY_GETDAY[now.getDay()] || "[LUN]",
    };
}

/**
 * @param {string[]} names
 * @returns {string[]}
 */
function sortCleaningCheckboxPropertyNames(names) {
    return [...(Array.isArray(names) ? names : [])].sort((a, b) =>
        String(a).localeCompare(String(b), "es")
    );
}

/**
 * Filtra checkboxes aplicables hoy: [DIARIO] o prefijo del día actual.
 * @param {string[]} checkboxNames
 * @param {string} dayPrefix ej. [LUN]
 * @returns {string[]}
 */
function filterCleaningCheckboxNamesForDay(checkboxNames, dayPrefix) {
    const prefix = String(dayPrefix || "").toUpperCase();
    const diario = DIARIO_PREFIX.toUpperCase();
    return sortCleaningCheckboxPropertyNames(checkboxNames).filter((name) => {
        const upper = String(name || "")
            .trim()
            .toUpperCase();
        return upper.startsWith(diario) || upper.startsWith(prefix);
    });
}

/**
 * Etiqueta de botón: quita prefijo [DIARIO]/[LUN]/…
 * @param {string} propertyKey
 */
function cleaningDisplayName(propertyKey) {
    return String(propertyKey || "")
        .replace(/^\[[^\]]+\]\s*/i, "")
        .trim() || String(propertyKey || "Aseo");
}

/**
 * @returns {Promise<{ ok: true, names: string[] } | { ok: false, message: string }>}
 */
async function fetchCleaningDatabaseCheckboxPropertyNames() {
    const cleaningDbId = getCleaningDatabaseId();
    if (!cleaningDbId) {
        return { ok: false, message: "❌ Falta NOTION_CLEANING_ID en el entorno." };
    }
    const now = Date.now();
    if (
        cleaningCheckboxSchemaCache.names &&
        now - cleaningCheckboxSchemaCache.fetchedAt < CLEANING_SCHEMA_CACHE_MS
    ) {
        return { ok: true, names: cleaningCheckboxSchemaCache.names };
    }

    const res = await fetch(`https://api.notion.com/v1/databases/${cleaningDbId}`, {
        method: "GET",
        headers: notionHeadersOrThrow(),
    });
    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        return { ok: false, message: `❌ No se pudo leer el esquema de aseo (${detail}).` };
    }
    const data = await res.json();
    const props = data.properties || {};
    const names = Object.keys(props).filter((k) => props[k]?.type === "checkbox");
    const sorted = sortCleaningCheckboxPropertyNames(names);
    cleaningCheckboxSchemaCache = { names: sorted, fetchedAt: now };
    return { ok: true, names: sorted };
}

/**
 * Busca o crea la fila del día en la base de aseo.
 * @returns {Promise<{ ok: true, page_id: string }>}
 */
async function ensureDailyCleaningPage() {
    const cleaningDbId = getCleaningDatabaseId();
    if (!cleaningDbId) {
        throw new Error("❌ Falta NOTION_CLEANING_ID en el entorno.");
    }
    if (!NOTION_UUID_RE.test(cleaningDbId)) {
        throw new Error("❌ NOTION_CLEANING_ID no es un UUID válido.");
    }

    const { dayTitle, dateIso } = getBogotaNowParts();
    const headers = notionHeadersOrThrow();

    const queryByDate = await fetch(`https://api.notion.com/v1/databases/${cleaningDbId}/query`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            filter: { property: DATE_PROPERTY, date: { equals: dateIso } },
        }),
    });
    if (!queryByDate.ok) {
        let detail = String(queryByDate.status);
        try {
            const errBody = await queryByDate.json();
            if (errBody?.message) detail = `${queryByDate.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        throw new Error(`❌ Error consultando base de aseo (${detail}).`);
    }
    const dateData = await queryByDate.json();
    if (dateData.object === "error" && dateData.message) {
        throw new Error(`❌ ${dateData.message}`);
    }
    let existing = dateData.results?.[0];

    if (!existing?.id) {
        const queryByTitle = await fetch(`https://api.notion.com/v1/databases/${cleaningDbId}/query`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                filter: { property: PAGE_TITLE_PROPERTY, title: { equals: dayTitle } },
            }),
        });
        if (queryByTitle.ok) {
            const titleData = await queryByTitle.json();
            existing = titleData.results?.[0];
        }
    }

    if (existing?.id) {
        return { ok: true, page_id: existing.id };
    }

    const schema = await fetchCleaningDatabaseCheckboxPropertyNames();
    if (!schema.ok) {
        throw new Error(schema.message);
    }

    const properties = {
        [PAGE_TITLE_PROPERTY]: { title: [{ text: { content: dayTitle } }] },
        [DATE_PROPERTY]: { date: { start: dateIso } },
    };
    for (const checkboxName of schema.names) {
        properties[checkboxName] = { checkbox: false };
    }

    const createRes = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers,
        body: JSON.stringify({
            parent: { database_id: cleaningDbId },
            properties,
        }),
    });
    if (!createRes.ok) {
        let detail = String(createRes.status);
        try {
            const errBody = await createRes.json();
            if (errBody?.message) detail = `${createRes.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        throw new Error(`❌ Error creando página diaria de aseo (${detail}).`);
    }
    const data = await createRes.json();
    if (!data?.id) {
        throw new Error("❌ Notion no devolvió id de página al crear el día de aseo.");
    }
    return { ok: true, page_id: data.id };
}

/**
 * @param {string} pageId
 * @param {string[]} propertyNames
 */
async function getCleaningPageCheckboxStates(pageId, propertyNames) {
    if (!pageId) {
        return { ok: false, message: "❌ page_id de aseo inválido." };
    }
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: "GET",
        headers: notionHeadersOrThrow(),
    });
    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        return { ok: false, message: `❌ No se pudo leer la página de aseo (${detail}).` };
    }
    const page = await res.json();
    const props = page?.properties || {};
    const states = {};
    for (const name of propertyNames) {
        states[name] = Boolean(props[name]?.checkbox);
    }
    return { ok: true, states };
}

/**
 * Tareas de aseo pendientes del día (filtro [DIARIO] + día actual en Bogotá).
 */
async function getPendingCleaningForToday() {
    try {
        const daily = await ensureDailyCleaningPage();
        if (!daily?.ok || !daily.page_id) {
            return { ok: false, message: "❌ No pude asegurar la página diaria de aseo." };
        }
        const schema = await fetchCleaningDatabaseCheckboxPropertyNames();
        if (!schema.ok) return schema;

        const { dayPrefix } = getBogotaNowParts();
        const sortedFilteredNames = filterCleaningCheckboxNamesForDay(schema.names, dayPrefix);
        const statesResult = await getCleaningPageCheckboxStates(daily.page_id, sortedFilteredNames);
        if (!statesResult.ok) return statesResult;

        const pending = sortedFilteredNames
            .filter((propertyKey) => !statesResult.states[propertyKey])
            .map((propertyKey) => ({
                propertyKey,
                name: cleaningDisplayName(propertyKey),
            }));

        return {
            ok: true,
            pageId: daily.page_id,
            pending,
            sortedFilteredNames,
            dayPrefix,
            allDone: pending.length === 0,
        };
    } catch (e) {
        return { ok: false, message: e?.message || String(e) };
    }
}

/**
 * Resuelve propiedad por índice en la lista filtrada+ordenada del día (stateless).
 * @param {number} index
 */
async function resolveCleaningCheckboxPropertyBySortedIndex(index) {
    const schema = await fetchCleaningDatabaseCheckboxPropertyNames();
    if (!schema.ok) return schema;
    const { dayPrefix } = getBogotaNowParts();
    const sortedFilteredNames = filterCleaningCheckboxNamesForDay(schema.names, dayPrefix);
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= sortedFilteredNames.length) {
        return { ok: false, message: "❌ Índice de aseo inválido." };
    }
    return { ok: true, propertyKey: sortedFilteredNames[i] };
}

/**
 * @param {string} propertyKey
 * @param {string} pageId
 */
async function markCleaningCheckboxDone(propertyKey, pageId) {
    if (!getCleaningDatabaseId()) {
        return { ok: false, message: "❌ Falta NOTION_CLEANING_ID en el entorno." };
    }
    const key = String(propertyKey || "").trim();
    if (!key) return { ok: false, message: "❌ Propiedad de aseo inválida." };
    if (!pageId) return { ok: false, message: "❌ page_id de aseo inválido." };

    const patchRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: "PATCH",
        headers: notionHeadersOrThrow(),
        body: JSON.stringify({ properties: { [key]: { checkbox: true } } }),
    });
    if (!patchRes.ok) {
        let detail = String(patchRes.status);
        try {
            const errBody = await patchRes.json();
            if (errBody?.message) detail = `${patchRes.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        return { ok: false, message: `❌ No se pudo marcar el aseo "${key}" (${detail}).` };
    }
    return { ok: true, resolvedName: cleaningDisplayName(key) };
}

module.exports = {
    DIARIO_PREFIX,
    DAY_PREFIX_BY_GETDAY,
    ensureDailyCleaningPage,
    getPendingCleaningForToday,
    resolveCleaningCheckboxPropertyBySortedIndex,
    markCleaningCheckboxDone,
    filterCleaningCheckboxNamesForDay,
    sortCleaningCheckboxPropertyNames,
    cleaningDisplayName,
    getBogotaNowParts,
};
