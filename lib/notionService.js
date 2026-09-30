const { Client } = require("@notionhq/client");

const BOGOTA_TZ = "America/Bogota";

/** Esquema de DB_Periodos: la fila del mes en curso tiene este select en "Current". */
const PROP_PERIODO_SELECT = (process.env.NOTION_PERIODOS_SELECT_PROP || "Select").trim();
const PERIODO_CURRENT_VALUE = "Current";

/** Esquema de DB_Gastos_Maestros (nombres exactos en Notion). */
const PROP_GASTO_NAME = "Name";
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
    const dataSourceId = await resolveDataSourceId(requireDbIdFromEnv("NOTION_GASTOS_DB_ID"));
    const periodoPageId = gasto.periodoPageId || (await getCurrentPeriodoPageId());
    const fechaYmd = getTodayBogotaYmd();

    const properties = {
        [PROP_GASTO_NAME]: { title: [{ text: { content: String(gasto.descripcion || "Gasto").slice(0, 2000) } }] },
        [PROP_GASTO_MONTO]: { number: Number.isFinite(gasto.monto) ? gasto.monto : null },
        [PROP_GASTO_FECHA]: { date: { start: fechaYmd } },
        [PROP_GASTO_CLASIFICACION]: { select: { name: gasto.clasificacionFiscal } },
        [PROP_GASTO_PERIODO]: { relation: [{ id: periodoPageId }] },
        [PROP_GASTO_NIT]: { rich_text: toRichText(gasto.nitCedula) },
        [PROP_GASTO_RAZON_SOCIAL]: { rich_text: toRichText(gasto.razonSocial) },
        [PROP_GASTO_SOPORTE]: { url: gasto.soporteDriveUrl || null },
    };
    // Las propiedades status no admiten crear opciones vía API: el valor debe existir en Notion.
    if (gasto.estadoDian) {
        properties[PROP_GASTO_ESTADO_DIAN] = { status: { name: gasto.estadoDian } };
    }

    const page = await notion.pages.create({
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties,
    });
    return { id: page.id, url: page.url || "", periodoPageId, fechaYmd };
}

module.exports = {
    normalizeNotionId,
    getCurrentPeriodoPageId,
    createGastoMaestro,
};
