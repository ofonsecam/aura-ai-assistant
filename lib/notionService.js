const { Client } = require("@notionhq/client");

const BOGOTA_TZ = "America/Bogota";

/** Esquema de DB_Periodos: la fila del mes en curso tiene este select en "Current". */
const PROP_PERIODO_SELECT = (process.env.NOTION_PERIODOS_SELECT_PROP || "Select").trim();
const PERIODO_CURRENT_VALUE = "Current";

/** Esquema de DB_Gastos_Maestros (nombres exactos en Notion). */
const PROP_GASTO_NAME = "Descripcion gasto";
const PROP_GASTO_MONTO = "Monto";
const PROP_GASTO_FECHA = "Fecha de gasto";
const PROP_GASTO_CLASIFICACION = "Clasificacion Fiscal";
const PROP_GASTO_ESTADO_DIAN = "Estado DIAN";
const PROP_GASTO_PERIODO = "DB_Periodos";
const PROP_GASTO_NIT = "NIT / Cédula";
const PROP_GASTO_RAZON_SOCIAL = "Razón Social";
const PROP_GASTO_SOPORTE = "Soporte Drive";

let cachedClient = null;
const dataSourceIdCache = new Map();

/**
 * Acepta el ID con o sin guiones, o la URL completa copiada desde Notion.
 * @param {string} raw
 * @returns {string}
 */
function normalizeNotionId(raw) {
    const s = String(raw || "").trim();
    const uuid = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid) return uuid[0];
    const compact = s.match(/[0-9a-f]{32}/i);
    return compact ? compact[0] : "";
}

function getNotionClient() {
    if (cachedClient) return cachedClient;
    const auth = String(process.env.NOTION_TOKEN || "").trim();
    if (!auth) throw new Error("Falta NOTION_TOKEN.");
    cachedClient = new Client({ auth });
    return cachedClient;
}

function requireDbIdFromEnv(envName) {
    const id = normalizeNotionId(process.env[envName]);
    if (!id) throw new Error(`Falta ${envName} (o no es un ID de Notion válido).`);
    return id;
}

/**
 * Desde la API 2025-09-03 (@notionhq/client v5) las queries y los parents van contra el data source,
 * no contra la base: se resuelve una vez por instancia.
 * @param {string} databaseId
 */
async function resolveDataSourceId(databaseId) {
    if (dataSourceIdCache.has(databaseId)) return dataSourceIdCache.get(databaseId);
    const notion = getNotionClient();
    const db = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = db?.data_sources?.[0]?.id;
    if (!dataSourceId) {
        throw new Error(`La base ${databaseId} no tiene data sources accesibles para la integración.`);
    }
    dataSourceIdCache.set(databaseId, dataSourceId);
    return dataSourceId;
}

function getTodayBogotaYmd() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: BOGOTA_TZ });
}

/**
 * Busca en DB_Periodos la página marcada como "Current".
 * @returns {Promise<string>} page_id del periodo activo.
 */
async function getCurrentPeriodoPageId() {
    const notion = getNotionClient();
    const dataSourceId = await resolveDataSourceId(requireDbIdFromEnv("NOTION_PERIODOS_DB_ID"));
    const response = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: {
            property: PROP_PERIODO_SELECT,
            select: { equals: PERIODO_CURRENT_VALUE },
        },
        page_size: 1,
    });
    const pageId = response?.results?.[0]?.id;
    if (!pageId) {
        throw new Error(
            `No hay periodo con "${PROP_PERIODO_SELECT}" = "${PERIODO_CURRENT_VALUE}" en DB_Periodos.`
        );
    }
    return pageId;
}

function toRichText(value) {
    const s = String(value ?? "").trim();
    return s ? [{ text: { content: s.slice(0, 2000) } }] : [];
}

/**
 * Crea la transacción en DB_Gastos_Maestros ligada al periodo activo.
 * @param {{ descripcion: string, monto: number, clasificacionFiscal: string, estadoDian?: string|null, nitCedula?: string, razonSocial?: string, soporteDriveUrl?: string|null, periodoPageId?: string }} gasto
 * @returns {Promise<{ id: string, url: string, periodoPageId: string, fechaYmd: string }>}
 */
async function createGastoMaestro(gasto) {
    const notion = getNotionClient();
    const gastosDbId = String(process.env.NOTION_GASTOS_DB_ID || "").trim();
    const periodosDbId = String(process.env.NOTION_PERIODOS_DB_ID || "").trim();
    if (!gastosDbId) throw new Error("Falta NOTION_GASTOS_DB_ID (o no es un ID de Notion válido).");
    if (periodosDbId && gastosDbId === periodosDbId) {
        throw new Error("NOTION_GASTOS_DB_ID no puede ser el mismo valor que NOTION_PERIODOS_DB_ID.");
    }
    const periodoPageId = gasto.periodoPageId || (await getCurrentPeriodoPageId());
    const fechaYmd = getTodayBogotaYmd();

    const properties = {
        [PROP_GASTO_NAME]: { title: [{ text: { content: String(gasto.descripcion || "Gasto").slice(0, 2000) } }] },
        [PROP_GASTO_MONTO]: { number: Number.isFinite(gasto.monto) ? gasto.monto : null },
        [PROP_GASTO_FECHA]: { date: { start: fechaYmd } },
        [PROP_GASTO_CLASIFICACION]: { select: { name: gasto.clasificacionFiscal } },
        [PROP_GASTO_PERIODO]: { relation: [{ id: periodoPageId }] },
    };
    // Las propiedades status no admiten crear opciones vía API: el valor debe existir en Notion.
    if (gasto.estadoDian) {
        properties[PROP_GASTO_ESTADO_DIAN] = { status: { name: gasto.estadoDian } };
    }
    // Notion rechaza url y rich_text vacíos o null en pages.create.
    const nitRich = toRichText(gasto.nitCedula);
    if (nitRich.length) properties[PROP_GASTO_NIT] = { rich_text: nitRich };
    const razonRich = toRichText(gasto.razonSocial);
    if (razonRich.length) properties[PROP_GASTO_RAZON_SOCIAL] = { rich_text: razonRich };
    const soporte = String(gasto.soporteDriveUrl ?? "").trim();
    if (soporte) properties[PROP_GASTO_SOPORTE] = { url: soporte };

    const page = await notion.pages.create({
        parent: { database_id: process.env.NOTION_GASTOS_DB_ID },
        properties,
    });
    return { id: page.id, url: page.url || "", periodoPageId, fechaYmd };
}

/** Esquema exacto de DB_Workout_Tracker (nombres y tipos de Notion). */
const PROP_WORKOUT_NOTAS = "Notas rapidas";
const PROP_WORKOUT_FECHA = "Fecha";
const PROP_WORKOUT_SESION = "Semana / Sesión";
const PROP_WORKOUT_PROTOCOLO = "Protocolo";
const PROP_WORKOUT_COMPLETADO = "Completado";
const PROP_WORKOUT_MOLESTIA = "Molestia articular";

const WORKOUT_PROTOCOLOS = Object.freeze(["30s/30s", "35s/25s", "40s/20s", "45s/15s"]);
const WORKOUT_MOLESTIAS = Object.freeze([
    "0 - Impecable",
    "1 - Fatiga muscular",
    "2 - Alerta tendón/periostio",
]);
const WORKOUT_DEFAULT_NOTAS = "Sesión completada";
const WORKOUT_MOLESTIA_ALERTA = "2 - Alerta tendón/periostio";

function foldWorkoutText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

/**
 * "s1d1", "S1 D1" o "S1-D1" → "S1-D1".
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeSemanaSesion(raw) {
    const s = String(raw ?? "").trim();
    const m = s.match(/\bs\s*(\d+)\s*[-_\s]?\s*d\s*(\d+)\b/i);
    if (!m) {
        throw new Error(`No reconocí la Semana / Sesión "${s}". Usa el formato S1-D1, S2-D3, etc.`);
    }
    return `S${m[1]}-D${m[2]}`;
}

/**
 * "30/30" o "30s/30s" → opción exacta del select Protocolo.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeProtocolo(raw) {
    const s = String(raw ?? "").trim();
    const m = s.match(/(\d+)\s*s?\s*\/\s*(\d+)\s*s?/i);
    const canonical = m ? `${m[1]}s/${m[2]}s` : "";
    if (!WORKOUT_PROTOCOLOS.includes(canonical)) {
        throw new Error(`Protocolo no válido "${s}". Opciones: ${WORKOUT_PROTOCOLOS.join(", ")}.`);
    }
    return canonical;
}

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
function normalizeCompletado(raw) {
    if (typeof raw === "boolean") return raw;
    if (raw == null || String(raw).trim() === "") return true;
    const n = foldWorkoutText(raw).trim();
    if (["false", "0", "no", "incompleto", "no completado"].includes(n) || n.startsWith("no ")) return false;
    return true;
}

/**
 * Mapea texto libre a las opciones exactas de `Molestia articular`.
 * Dolor de tendón, espinilla, periostio o Aquiles → alerta 2.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeMolestiaArticular(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return WORKOUT_MOLESTIAS[0];
    const exact = WORKOUT_MOLESTIAS.find((option) => option.toLowerCase() === s.toLowerCase());
    if (exact) return exact;
    const n = foldWorkoutText(s);
    if (/tendon|periostio|espinilla|aquiles|canilla|\bshin\b/.test(n)) return WORKOUT_MOLESTIA_ALERTA;
    if (/\bfatiga\b/.test(n) || n === "1" || n.startsWith("1 ") || n.startsWith("1-")) return WORKOUT_MOLESTIAS[1];
    if (/impecable|sin dolor|todo bien|sin molestia/.test(n) || n === "0" || n.startsWith("0 ") || n.startsWith("0-")) {
        return WORKOUT_MOLESTIAS[0];
    }
    if (/\bdolor\b/.test(n)) return WORKOUT_MOLESTIA_ALERTA;
    throw new Error(`No reconocí la molestia articular "${s}". Opciones: ${WORKOUT_MOLESTIAS.join(" | ")}.`);
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeWorkoutNotas(raw) {
    const s = String(raw ?? "").replace(/\s+/g, " ").trim();
    return (s || WORKOUT_DEFAULT_NOTAS).slice(0, 2000);
}

/**
 * Fecha ISO 8601 (día) en America/Bogota si no llega una fecha válida.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeWorkoutFecha(raw) {
    const s = String(raw ?? "").trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : getTodayBogotaYmd();
}

/**
 * Normaliza el payload de Gemini o del parser antes de escribir en Notion.
 * @param {object} input
 */
function normalizeWorkoutSession(input) {
    const src = input && typeof input === "object" ? input : {};
    const completadoRaw = src.completado !== undefined ? src.completado : src.Completado;
    return {
        fecha: normalizeWorkoutFecha(src.fecha ?? src.Fecha),
        semanaSesion: normalizeSemanaSesion(src.semanaSesion ?? src[PROP_WORKOUT_SESION] ?? src.sesion),
        protocolo: normalizeProtocolo(src.protocolo ?? src.Protocolo),
        completado: normalizeCompletado(completadoRaw),
        molestiaArticular: normalizeMolestiaArticular(
            src.molestiaArticular ?? src[PROP_WORKOUT_MOLESTIA] ?? src.molestia
        ),
        notas: normalizeWorkoutNotas(src.notas ?? src[PROP_WORKOUT_NOTAS] ?? src.notasRapidas),
    };
}

/**
 * Inserta una sesión de salto de cuerda en DB_Workout_Tracker.
 * @param {object} input
 * @returns {Promise<{ id: string, url: string, fecha: string, semanaSesion: string, protocolo: string, completado: boolean, molestiaArticular: string, notas: string }>}
 */
async function logWorkoutSession(input) {
    const session = normalizeWorkoutSession(input);
    const notion = getNotionClient();
    const databaseId = String(process.env.NOTION_WORKOUT_DB_ID || "").trim();
    if (!normalizeNotionId(databaseId)) {
        throw new Error("Falta NOTION_WORKOUT_DB_ID (o no es un ID de Notion válido).");
    }

    const page = await notion.pages.create({
        parent: { database_id: process.env.NOTION_WORKOUT_DB_ID },
        properties: {
            [PROP_WORKOUT_NOTAS]: { title: [{ text: { content: session.notas } }] },
            [PROP_WORKOUT_FECHA]: { date: { start: session.fecha } },
            [PROP_WORKOUT_SESION]: { select: { name: session.semanaSesion } },
            [PROP_WORKOUT_PROTOCOLO]: { select: { name: session.protocolo } },
            [PROP_WORKOUT_COMPLETADO]: { checkbox: session.completado },
            [PROP_WORKOUT_MOLESTIA]: { select: { name: session.molestiaArticular } },
        },
    });

    return { ...session, id: page.id, url: page.url || "" };
}

module.exports = {
    normalizeNotionId,
    getCurrentPeriodoPageId,
    createGastoMaestro,
    normalizeWorkoutSession,
    logWorkoutSession,
    WORKOUT_PROTOCOLOS,
    WORKOUT_MOLESTIAS,
    WORKOUT_DEFAULT_NOTAS,
    WORKOUT_MOLESTIA_ALERTA,
};
