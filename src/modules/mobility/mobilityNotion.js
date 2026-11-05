/**
 * Rutina de movilidad activa (Notion) — caché en memoria 24h.
 * Env: NOTION_ROUTINES_ID, NOTION_EXERCISES_ID, NOTION_TOKEN.
 */

const PROP_ACTIVA = "Activa";
const PROP_TIEMPO = "Tiempo Estimado";
const PROP_EJERCICIOS_REL = "Ejercicios";
const PROP_EJERCICIO_TITLE = "Ejercicio";
const PROP_DOSIS = "Dosis Recomendada";
const PROP_INSTRUCCION = "Instruccion Clave";
const PROP_ENLACE = "Enlace/GIF";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let mobilityCache = { fetchedAt: 0, payload: null };

function getRoutinesDatabaseId() {
    return (process.env.NOTION_ROUTINES_ID || "").trim();
}

function getExercisesDatabaseId() {
    return (process.env.NOTION_EXERCISES_ID || "").trim();
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

function richTextToPlain(richText) {
    if (!Array.isArray(richText)) return "";
    return richText.map((t) => t?.plain_text || "").join("").trim();
}

function readTitleFromProperties(properties) {
    const props = properties && typeof properties === "object" ? properties : {};
    if (props[PROP_EJERCICIO_TITLE]?.type === "title") {
        return richTextToPlain(props[PROP_EJERCICIO_TITLE].title);
    }
    for (const key of Object.keys(props)) {
        const p = props[key];
        if (p?.type === "title") {
            const title = richTextToPlain(p.title);
            if (title) return title;
        }
    }
    return "";
}

function readPlainProperty(prop) {
    if (!prop || typeof prop !== "object") return "";
    if (prop.type === "rich_text") return richTextToPlain(prop.rich_text);
    if (prop.type === "title") return richTextToPlain(prop.title);
    if (prop.type === "url") return String(prop.url || "").trim();
    if (prop.type === "formula" && prop.formula?.type === "string") {
        return String(prop.formula.string || "").trim();
    }
    return "";
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
 * @param {{
 *   name: string,
 *   tiempoEstimado: string,
 *   exercises: { name: string, dosis: string, instruccion: string, enlace: string }[],
 * }} routine
 */
function formatMobilityRoutineMessage(routine) {
    const name = escapeTelegramMarkdown(routine?.name || "Sin nombre");
    const tiempo = String(routine?.tiempoEstimado || "").trim();
    const tiempoPart = tiempo ? ` (~ ${escapeTelegramMarkdown(tiempo)})` : "";
    const lines = [`🏋️‍♂️ *Rutina Activa:* ${name}${tiempoPart}`, ""];

    const exercises = Array.isArray(routine?.exercises) ? routine.exercises : [];
    if (!exercises.length) {
        lines.push("_No hay ejercicios vinculados a esta rutina._");
    } else {
        exercises.forEach((ex, i) => {
            const exName = escapeTelegramMarkdown(ex.name || `Ejercicio ${i + 1}`);
            const dosis = escapeTelegramMarkdown(ex.dosis || "—");
            lines.push(`${i + 1}. *${exName}:* ${dosis}`);
            if (ex.instruccion) {
                lines.push(`_${escapeTelegramMarkdown(ex.instruccion)}_`);
            }
            if (ex.enlace) {
                lines.push(`[Ver ejemplo](${ex.enlace})`);
            }
            lines.push("");
        });
    }

    lines.push("_Abre la app Bend para el cronómetro y sigue el tempo de cada ejercicio._");
    return lines.join("\n").trim();
}

async function fetchExercisePage(pageId, headers) {
    const res = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
        method: "GET",
        headers,
    });
    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        throw new Error(`No se pudo leer ejercicio ${pageId} (${detail}).`);
    }
    return res.json();
}

/**
 * Consulta la rutina con Activa=true y sus ejercicios relacionados.
 * @returns {Promise<
 *   | { ok: true, routine: object, fromCache: boolean }
 *   | { ok: false, message: string }
 * >}
 */
async function getActiveMobilityRoutine() {
    const now = Date.now();
    if (mobilityCache.payload && now - mobilityCache.fetchedAt < CACHE_TTL_MS) {
        return { ok: true, routine: mobilityCache.payload, fromCache: true };
    }

    const routinesDbId = getRoutinesDatabaseId();
    const exercisesDbId = getExercisesDatabaseId();
    if (!routinesDbId) {
        return { ok: false, message: "❌ Falta NOTION_ROUTINES_ID en el entorno." };
    }
    if (!exercisesDbId) {
        return { ok: false, message: "❌ Falta NOTION_EXERCISES_ID en el entorno." };
    }

    try {
        const headers = notionHeadersOrThrow();
        const queryRes = await fetch(`https://api.notion.com/v1/databases/${routinesDbId}/query`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                page_size: 5,
                filter: { property: PROP_ACTIVA, checkbox: { equals: true } },
            }),
        });
        if (!queryRes.ok) {
            let detail = String(queryRes.status);
            try {
                const errBody = await queryRes.json();
                if (errBody?.message) detail = `${queryRes.status}: ${errBody.message}`;
            } catch (_) {
                /* ignore */
            }
            return { ok: false, message: `❌ Error consultando rutinas (${detail}).` };
        }
        const queryData = await queryRes.json();
        const page = queryData.results?.[0];
        if (!page?.id) {
            return { ok: false, message: "❌ No hay ninguna rutina con el checkbox Activa marcado." };
        }

        const props = page.properties || {};
        const routineName = readTitleFromProperties(props) || "Rutina activa";
        const tiempoEstimado = readPlainProperty(props[PROP_TIEMPO]);
        const relation = props[PROP_EJERCICIOS_REL]?.relation;
        const exerciseIds = Array.isArray(relation)
            ? relation.map((r) => String(r?.id || "").trim()).filter(Boolean)
            : [];

        const exercises = [];
        for (const exerciseId of exerciseIds) {
            const exercisePage = await fetchExercisePage(exerciseId, headers);
            const eProps = exercisePage?.properties || {};
            exercises.push({
                id: exerciseId,
                name: readTitleFromProperties(eProps) || readPlainProperty(eProps[PROP_EJERCICIO_TITLE]),
                dosis: readPlainProperty(eProps[PROP_DOSIS]),
                instruccion: readPlainProperty(eProps[PROP_INSTRUCCION]),
                enlace: readPlainProperty(eProps[PROP_ENLACE]) || String(eProps[PROP_ENLACE]?.url || "").trim(),
            });
        }

        const routine = {
            pageId: page.id,
            name: routineName,
            tiempoEstimado,
            exercises,
        };
        mobilityCache = { fetchedAt: now, payload: routine };
        return { ok: true, routine, fromCache: false };
    } catch (e) {
        return { ok: false, message: e?.message || String(e) };
    }
}

/** Solo para tests. */
function __resetMobilityCacheForTests() {
    mobilityCache = { fetchedAt: 0, payload: null };
}

module.exports = {
    getActiveMobilityRoutine,
    formatMobilityRoutineMessage,
    __resetMobilityCacheForTests,
    CACHE_TTL_MS,
};
