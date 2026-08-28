const databaseId = (process.env.NOTION_DATABASE_ID || '').trim();
/** Etiqueta humana para logs/Telegram (opcional: NOTION_TASKS_DATABASE_NAME en Vercel). */
const TASKS_DATABASE_DISPLAY_NAME = (process.env.NOTION_TASKS_DATABASE_NAME || 'Base de tareas').trim();
/**
 * Esquema de la base de tareas (solo estas claves en creación/lectura de tareas).
 * Título: Name; fecha: Fecha (date YYYY-MM-DD); Area; Estado; Fecha de Cierre (date+hora al completar).
 */
const PROP_TASK_NAME = 'Name';
const PROP_TASK_ESTADO = 'Estado';
const PROP_TASK_FECHA = 'Fecha';
const PROP_TASK_AREA = 'Area';
/** Fecha y hora en que la tarea pasó a un estado completado (rellenada por el bot). */
const PROP_TASK_FECHA_CIERRE = 'Fecha de Cierre';
/** Valor exacto del select Estado para tareas nuevas (P mayúscula). */
const TASK_STATUS_PENDING = 'Pendiente';
const TASK_STATUS_PAUSED = 'Pausado';
/** Valores de Estado que cuentan como tarea completada (cierre del día / reportes). */
const TASK_STATUS_DONE_VALUES = ['Hecho', 'Done', 'Cumplida'];
const TASK_ALLOWED_AREAS = [
    'Trabajo secundario',
    'Trabajo Traffix',
    'Iglesia',
    'Familia',
    'Carrera',
    'IA Dev',
    'Universidad',
    'Personales',
    'Matrimonio',
    'Aseo',
];

const notionInboxId = (process.env.NOTION_INBOX_ID || '').trim();
/** Base de hábitos: prioridad NOTION_HABITS_ID (Vercel), alias NOTION_HABITS_DATABASE_ID. */
const habitsDatabaseId = (process.env.NOTION_HABITS_ID || process.env.NOTION_HABITS_DATABASE_ID || '').trim();
const notionExpensesId = (process.env.NOTION_EXPENSES_ID || '').trim();
/** Base de tensión arterial (`DB_Tension`). */
const notionTensionId = (process.env.NOTION_DB_TENSION_ID || '').trim();
const PROP_TENSION_TITLE = 'YYYY MM DD';
const PROP_TENSION_FECHA = 'Fecha';
const PROP_TENSION_VALUE = 'Tension';
const PROP_TENSION_QUIEN = 'Quien';
const TENSION_INVALID_FORMAT_MSG =
    '⚠️ Formato inválido. Usa: T/ <Oscar|Yulis> <Sistólica/Diastólica> (Ej: T/ Oscar 126/86)';
/** Propiedad tipo fecha en la base Inbox Gastos (`NOTION_EXPENSES_ID`). Debe coincidir con el nombre en Notion. */
const PROP_EXPENSE_FECHA = 'Fecha de gasto';
const notionMinutasId = (process.env.NOTION_MINUTAS_ID || '').trim();
const notionActividadesProyectosId = (process.env.NOTION_ACTIVIDADES_PROYECTOS_ID || '').trim();
const notionProyectoDbId = (process.env.NOTION_DB_PROYECTO_ID || '').trim();
const notionToken = (process.env.NOTION_TOKEN || '').trim();

const PROP_PROYECTO_NAME = 'Name';
const PROP_PROYECTO_ESTADO = 'Estado';
const PROP_PROYECTO_FECHA_EJECUCION = 'Fecha de Ejecución';
const PROP_PROYECTO_TIPO = 'Tipo';
const PLAN_STATUS_COMPLETED = 'Completado';

const NOTION_UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

const NOTION_HEADERS = {
    Authorization: `Bearer ${notionToken}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
};

/** Locale español de chrono-node (fechas naturales: mañana, 15 de mayo, etc.). */
const chrono = { es: require('chrono-node/es') };
/** Activa ForwardDateRefiner: horas al día siguiente; weekday si ya pasó la hora implícita; año si aplica. */
const CHRONO_PARSE_OPTIONS = { forwardDate: true };
const DAY_MS = 86400000;

/** Notion limita cada fragmento de rich_text a 2000 caracteres. */
function toRichTextSegments(text) {
    const s = text == null ? '' : String(text);
    const max = 2000;
    const segments = [];
    for (let i = 0; i < s.length; i += max) {
        segments.push({ text: { content: s.slice(i, i + max) } });
    }
    return segments.length ? segments : [{ text: { content: '' } }];
}

function getLevenshteinDistance(a, b) {
    if (a === b) return 0;
    const al = a.length, bl = b.length;
    if (!al || !bl) return Math.max(al, bl);
    const matrix = Array.from({ length: bl + 1 }, (_, i) => [i]);
    for (let j = 1; j <= al; j++) matrix[0][j] = j;
    for (let i = 1; i <= bl; i++) {
        for (let j = 1; j <= al; j++) {
            const cost = b[i-1].toLowerCase() === a[j-1].toLowerCase() ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i-1][j] + 1, matrix[i][j-1] + 1, matrix[i-1][j-1] + cost);
        }
    }
    return matrix[bl][al];
}

/** Fecha local YYYY-MM-DD en zona America/Bogota. */
function getTodayBogotaYmd() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    return now.toISOString().slice(0, 10);
}

/** Fecha local YYYY-MM-DD de mañana en zona America/Bogota. */
function getTomorrowBogotaYmd() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    now.setDate(now.getDate() + 1);
    return now.toISOString().slice(0, 10);
}

/**
 * Devuelve "ahora" en America/Bogota para usar como referencia de NLP.
 * @returns {Date}
 */
function getNlpReferenceDateBogota() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
}

/**
 * Día de calendario YYYY-MM-DD en America/Bogota para un instante devuelto por chrono.
 * @param {Date} d
 * @returns {string}
 */
function taskDateToBogotaYmd(d) {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).split(' ')[0];
}

/**
 * Semana ISO (inicio lunes) para una fecha civil YYYY-MM-DD (gregoriano, sin zona).
 * @param {string} ymd
 * @returns {{ isoYear: number, week: number }}
 */
function isoWeekYearAndWeekForYmd(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const utc = Date.UTC(y, m - 1, d);
    const date = new Date(utc);
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const isoYear = date.getUTCFullYear();
    const yearStart = Date.UTC(isoYear, 0, 1);
    const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
    return { isoYear, week };
}

/** @param {string} ymdA @param {string} ymdB */
function sameIsoWeekYmd(ymdA, ymdB) {
    const a = isoWeekYearAndWeekForYmd(ymdA);
    const b = isoWeekYearAndWeekForYmd(ymdB);
    return a.isoYear === b.isoYear && a.week === b.week;
}

/**
 * Marca de tiempo actual en Bogotá (GMT-5) para propiedad date de Notion con hora.
 * @returns {string} p. ej. 2026-04-21T20:30:45.000-05:00
 */
function getNowBogotaIsoForNotionDateTime() {
    const d = new Date();
    const wall = d.toLocaleString("sv-SE", { timeZone: "America/Bogota" });
    const [datePart, timePart = "00:00:00"] = wall.split(" ");
    return `${datePart}T${timePart}.000-05:00`;
}

/** @param {string} status */
function isTaskStatusCompleted(status) {
    return TASK_STATUS_DONE_VALUES.includes(String(status || "").trim());
}

/** Marca de cierre: select 'Hecho' (u otros valores canónicos) o variantes que empiezan por "Hecho". */
function isTaskCompletionIntent(status) {
    const s = String(status || "").trim();
    return isTaskStatusCompleted(s) || /^hecho/i.test(s);
}

/**
 * Partes de calendario (año, mes, día) de "ahora" en America/Bogota.
 * Equivalente en Python: `datetime.now(ZoneInfo("America/Bogota")).date()`.
 */
function getBogotaCalendarTodayParts() {
    const f = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "numeric",
        day: "numeric",
    });
    const parts = f.formatToParts(new Date());
    const y = Number(parts.find((p) => p.type === "year").value);
    const m = Number(parts.find((p) => p.type === "month").value);
    const d = Number(parts.find((p) => p.type === "day").value);
    return { y, m, d };
}

/**
 * Rango YYYY-MM-DD del lunes al domingo de la semana que contiene hoy (Bogotá).
 * Alineado con ISO: semana empieza en lunes (como `date.weekday()` en Python con lunes=0
 * y `timedelta(days=-weekday)` para retroceder al lunes).
 * @returns {{ weekStart: string, weekEnd: string }}
 */
function getBogotaCurrentWeekMondaySundayYmd() {
    const { y, m, d } = getBogotaCalendarTodayParts();
    const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
    const dow = new Date(utcNoon).getUTCDay();
    const daysFromMonday = (dow + 6) % 7;
    const mondayMs = utcNoon - daysFromMonday * 86400000;
    const sundayMs = mondayMs + 6 * 86400000;
    const toYmd = (ms) => {
        const dt = new Date(ms);
        const yy = dt.getUTCFullYear();
        const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(dt.getUTCDate()).padStart(2, "0");
        return `${yy}-${mm}-${dd}`;
    };
    return { weekStart: toYmd(mondayMs), weekEnd: toYmd(sundayMs) };
}

/**
 * Próximo domingo (Bogotá). Si hoy es domingo, devuelve el domingo de la semana siguiente.
 * @returns {string} YYYY-MM-DD
 */
function getNextSundayBogotaYmd() {
    const todayYmd = getTodayBogotaYmd();
    const [y, m, d] = todayYmd.split("-").map(Number);
    const ref = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
    const dow = ref.getUTCDay();
    const daysUntilSunday = dow === 0 ? 7 : 7 - dow;
    return addCalendarDaysYmd(todayYmd, daysUntilSunday);
}

/**
 * Rango YYYY-MM-DD del primer al último día del mes actual en America/Bogota.
 * @returns {{ monthStart: string, monthEnd: string }}
 */
function getBogotaCurrentMonthStartEndYmd() {
    const { y, m } = getBogotaCalendarTodayParts();
    const monthStartMs = Date.UTC(y, m - 1, 1, 12, 0, 0);
    const monthEndMs = Date.UTC(y, m, 0, 12, 0, 0);
    const toYmd = (ms) => {
        const dt = new Date(ms);
        const yy = dt.getUTCFullYear();
        const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(dt.getUTCDate()).padStart(2, "0");
        return `${yy}-${mm}-${dd}`;
    };
    return { monthStart: toYmd(monthStartMs), monthEnd: toYmd(monthEndMs) };
}

/**
 * Suma días a una fecha calendario YYYY-MM-DD (UTC mediodía; sin desfases DST raros).
 * @param {string} ymd
 * @param {number} deltaDays
 * @returns {string}
 */
function addCalendarDaysYmd(ymd, deltaDays) {
    const [y, m, d] = String(ymd).split("-").map(Number);
    const ms = Date.UTC(y, m - 1, d, 12, 0, 0) + deltaDays * 86400000;
    const dt = new Date(ms);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
}

/**
 * Fecha YYYY-MM-DD en Bogotá correspondiente a un instante ISO (p. ej. last_edited_time).
 * @param {string} iso
 */
function instantToBogotaYmd(iso) {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
}

/**
 * Día civil en Bogotá (YYYY-MM-DD) de la propiedad Fecha de Cierre.
 * @returns {string | null}
 */
function getTaskCierreYmdFromPage(page) {
    const dateObj = page.properties?.[PROP_TASK_FECHA_CIERRE]?.date;
    if (!dateObj) return null;
    const raw = dateObj.start || dateObj.end;
    if (!raw) return null;
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return instantToBogotaYmd(s);
}

/**
 * Tareas completadas (Hecho / Done / Cumplida) cuya *Fecha de Cierre* cae en el día `ymd` (Bogotá).
 * @param {string} ymd YYYY-MM-DD (zona America/Bogota)
 * @returns {Promise<{ name: string, area: string, status: string }[]>}
 */
async function getCompletedTasksForBogotaDate(ymd) {
    const statusOr = TASK_STATUS_DONE_VALUES.map((name) => ({
        property: PROP_TASK_ESTADO,
        select: { equals: name },
    }));
    const filter = {
        and: [
            { or: statusOr },
            {
                property: PROP_TASK_FECHA_CIERRE,
                date: {
                    on_or_after: ymd,
                    on_or_before: ymd,
                },
            },
        ],
    };
    const pages = await queryTaskDatabaseAll(filter);
    return pages
        .filter((p) => getTaskCierreYmdFromPage(p) === ymd)
        .map((p) => ({
            name: p.properties?.[PROP_TASK_NAME]?.title?.[0]?.text?.content?.trim() || 'Sin título',
            area: p.properties?.[PROP_TASK_AREA]?.select?.name || '—',
            status: p.properties?.[PROP_TASK_ESTADO]?.select?.name || '—',
        }));
}

/**
 * Misma lógica que {@link getCompletedTasksForBogotaDate} usando la fecha actual en Bogotá.
 */
async function getCompletedTasksTodayBogota() {
    const dateYmd = getTodayBogotaYmd();
    const tasks = await getCompletedTasksForBogotaDate(dateYmd);
    return { dateYmd, tasks };
}

/**
 * Consulta paginada de la base de tareas.
 * @param {Record<string, unknown>} [filter]
 * @returns {Promise<object[]>}
 */
async function queryTaskDatabaseAll(filter) {
    if (!databaseId || !NOTION_UUID_RE.test(databaseId)) {
        throw new Error("NOTION_DATABASE_ID inválido o ausente.");
    }
    if (!notionToken) {
        throw new Error("Falta NOTION_TOKEN.");
    }
    const all = [];
    let start_cursor = undefined;
    for (;;) {
        const body = { page_size: 100 };
        if (filter) body.filter = filter;
        if (start_cursor) body.start_cursor = start_cursor;
        const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
            method: "POST",
            headers: NOTION_HEADERS,
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            const msg = data?.message || String(res.status);
            throw new Error(`Notion query: ${msg}`);
        }
        all.push(...(data.results || []));
        if (!data.has_more) break;
        start_cursor = data.next_cursor;
    }
    return all;
}

/**
 * Datos para el cron semanal (cierre de semana en America/Bogota).
 * - Pasado: Pausado con Fecha estrictamente anterior al lunes de la semana que termina.
 * - Logros: tareas completadas cuya *Fecha de Cierre* cae en esa semana (lunes–domingo, Bogotá).
 * - Vista previa: Pausado con Fecha desde el próximo lunes en adelante.
 * @returns {Promise<{ pastPaused: { name: string, area: string, ymd: string }[], previewPaused: { name: string, area: string, ymd: string }[], hechoThisWeek: number, weekStart: string, weekEnd: string, nextMonday: string }>}
 */
async function getWeeklyCronReportData() {
    const { weekStart, weekEnd } = getBogotaCurrentWeekMondaySundayYmd();
    const nextMonday = addCalendarDaysYmd(weekStart, 7);

    const pastPausedPages = await queryTaskDatabaseAll({
        and: [
            { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PAUSED } },
            { property: PROP_TASK_FECHA, date: { before: weekStart } },
        ],
    });

    const previewPausedPages = await queryTaskDatabaseAll({
        and: [
            { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PAUSED } },
            { property: PROP_TASK_FECHA, date: { on_or_after: nextMonday } },
        ],
    });

    const completedThisWeekPages = await queryTaskDatabaseAll({
        and: [
            {
                property: PROP_TASK_ESTADO,
                select: { equals: "Hecho" },
            },
            {
                property: PROP_TASK_FECHA_CIERRE,
                date: {
                    on_or_after: weekStart,
                    on_or_before: weekEnd,
                },
            },
        ],
    });
    const hechoThisWeek = completedThisWeekPages.filter((p) => {
        const ymd = getTaskCierreYmdFromPage(p);
        return ymd && ymd >= weekStart && ymd <= weekEnd;
    }).length;

    const mapPaused = (p) => {
        const ymd = getTaskScheduledYmdFromPage(p);
        return {
            name: p.properties?.[PROP_TASK_NAME]?.title?.[0]?.text?.content?.trim() || "Sin título",
            area: p.properties?.[PROP_TASK_AREA]?.select?.name || "—",
            ymd: ymd || "—",
        };
    };

    const pastPaused = pastPausedPages
        .filter((p) => {
            const ymd = getTaskScheduledYmdFromPage(p);
            return ymd && ymd < weekStart;
        })
        .map(mapPaused)
        .sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0));

    const previewPaused = previewPausedPages
        .filter((p) => {
            const ymd = getTaskScheduledYmdFromPage(p);
            return ymd && ymd >= nextMonday;
        })
        .map(mapPaused)
        .sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0));

    return {
        pastPaused,
        previewPaused,
        hechoThisWeek,
        weekStart,
        weekEnd,
        nextMonday,
    };
}

/**
 * Tareas completadas (Estado = Hecho) con *Fecha de Cierre* en los últimos 7 días civiles (Bogotá, inclusive).
 * @returns {Promise<{ count: number, startYmd: string, endYmd: string }>}
 */
async function getCompletedTasksCountLast7DaysBogota() {
    const endYmd = getTodayBogotaYmd();
    const startYmd = addCalendarDaysYmd(endYmd, -6);

    const completedPages = await queryTaskDatabaseAll({
        and: [
            {
                property: PROP_TASK_ESTADO,
                select: { equals: "Hecho" },
            },
            {
                property: PROP_TASK_FECHA_CIERRE,
                date: {
                    on_or_after: startYmd,
                    on_or_before: endYmd,
                },
            },
        ],
    });
    const count = completedPages.filter((p) => {
        const ymd = getTaskCierreYmdFromPage(p);
        return ymd && ymd >= startYmd && ymd <= endYmd;
    }).length;

    return { count, startYmd, endYmd };
}

/**
 * Fecha programada de la propiedad Fecha (inicio; si no hay, fin del rango).
 * @returns {string | null} YYYY-MM-DD
 */
function getTaskScheduledYmdFromPage(page) {
    const dateObj = page.properties?.[PROP_TASK_FECHA]?.date;
    if (!dateObj) return null;
    const raw = dateObj.start || dateObj.end;
    if (!raw) return null;
    return String(raw).slice(0, 10);
}

/**
 * Convierte texto o YYYY-MM-DD a fecha de tarea; vacío si no aplica.
 * @param {string} input
 * @returns {string} YYYY-MM-DD o ""
 */
function resolveNaturalDate(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    if (/^hoy$/i.test(raw)) return now.toISOString().slice(0, 10);
    if (/^mañana$|^manana$/i.test(raw)) {
        now.setDate(now.getDate() + 1);
        return now.toISOString().slice(0, 10);
    }
    const parsed = parseTaskText(raw);
    if (parsed.taskDate) {
        return taskDateToBogotaYmd(parsed.taskDate);
    }
    return raw;
}

/**
 * Normaliza el nombre de área para alinearlo con opciones de Notion (primera letra de cada palabra en mayúscula).
 * @param {string} area
 * @returns {string}
 */
function normalizeNotionArea(area) {
    const s = String(area == null ? '' : area).trim();
    if (!s) return s;
    return s
        .split(/\s+/)
        .map((w) => {
            if (!w) return w;
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        })
        .join(' ');
}

/**
 * Canonicaliza texto para entidades temporales:
 * - lower-case
 * - variantes de "mañana/manana" -> token "__tomorrow__"
 * @param {string} text
 * @returns {string}
 */
function normalizeDateEntitiesText(text) {
    const raw = String(text ?? '').toLowerCase();
    return raw.replace(/\bma(?:ñ|n)ana\b/g, '__tomorrow__');
}

/**
 * Crea una clave estable para comparar texto ignorando acentos/mayúsculas.
 * @param {string} text
 * @returns {string}
 */
function toComparableKey(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * Si el título llega como "Area/ tarea", extrae área válida y limpia el nombre.
 * @param {string} rawName
 * @returns {{ cleanName: string, areaFromPrefix: string }}
 */
function extractAreaPrefixFromName(rawName) {
    const trimmed = String(rawName ?? '').trim();
    if (!trimmed) return { cleanName: '', areaFromPrefix: '' };
    const m = trimmed.match(/^([^/\n]+)\s*\/\s*(.+)$/);
    if (!m) return { cleanName: trimmed, areaFromPrefix: '' };
    const prefix = normalizeNotionArea(m[1]);
    const areaByKey = new Map(TASK_ALLOWED_AREAS.map((a) => [toComparableKey(a), a]));
    const resolvedArea = areaByKey.get(toComparableKey(prefix)) || '';
    if (!resolvedArea) return { cleanName: trimmed, areaFromPrefix: '' };
    return { cleanName: String(m[2] ?? '').trim(), areaFromPrefix: resolvedArea };
}

async function findBestFuzzyMatch(searchName) {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ 
            filter: { 
                or: [
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
                    { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } },
                    { property: PROP_TASK_ESTADO, select: { equals: 'Pausado' } }
                ] 
            } 
        })
    });
    const data = await res.json();
    if (!data.results?.length) return null;
    let bestMatch = { pageId: null, name: '', distance: Infinity };
    const target = searchName.trim().toLowerCase();
    for (const page of data.results) {
        const pageName = page.properties?.[PROP_TASK_NAME]?.title?.[0]?.text?.content?.trim() || '';
        if (!pageName) continue;
        const dist = getLevenshteinDistance(target, pageName.toLowerCase());
        if (dist < bestMatch.distance) bestMatch = { pageId: page.id, name: pageName, distance: dist };
    }
    const threshold = Math.max(2, Math.floor(bestMatch.name.length * 0.4));
    return bestMatch.distance <= threshold ? bestMatch : null;
}

/**
 * Tras quitar la fecha, elimina conectores sueltos al inicio o al final (p. ej. "... el" si chrono solo quitó "domingo").
 * @param {string} s
 * @returns {string}
 */
function stripEdgeDateConnectors(s) {
    const lead = /^(?:para el|el día|del|el|la)\s+/i;
    const trail = /\s+(?:para el|el día|del|el|la)$/i;
    let t = String(s).replace(/\s+/g, ' ').trim();
    let prev;
    do {
        prev = t;
        t = t.replace(lead, '').replace(trail, '').replace(/\s+/g, ' ').trim();
    } while (t !== prev);
    return t;
}

function buildDateFromMonthDayYear(monthStr, dayStr, yearStr) {
    const month = Number(monthStr);
    const day = Number(dayStr);
    const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr);
    if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
    if (
        d.getUTCFullYear() !== year ||
        d.getUTCMonth() + 1 !== month ||
        d.getUTCDate() !== day
    ) {
        return null;
    }
    return d;
}

/**
 * Interpreta la primera fecha numérica como MM DD YY/MM DD YYYY (prioridad alta).
 * Ej: "05 08 26" => 2026-05-08.
 * @param {string} text
 * @returns {{ start: number, end: number, date: Date } | null}
 */
function parseUsNumericDatePriority(text) {
    const re = /\b(\d{1,2})\s+(\d{1,2})\s+(\d{2}|\d{4})\b/g;
    let m;
    while ((m = re.exec(String(text ?? ''))) != null) {
        const d = buildDateFromMonthDayYear(m[1], m[2], m[3]);
        if (!d) continue;
        return { start: m.index, end: m.index + m[0].length, date: d };
    }
    return null;
}

/**
 * Detecta la primera fecha en español con chrono (`parseDate` / `parse`, ref. Bogotá y `forwardDate: true`).
 * Ajustes: (1) día de semana sin "este/esta" que cae en hoy Bogotá → +7 días; (2) "próximo" con fecha
 * aún en la misma semana ISO que hoy → +7 días (p. ej. domingo → el lunes inmediato pasa a lunes siguiente).
 * @param {string} text
 * @returns {{ cleanTitle: string, taskDate: Date | null }}
 */
function parseTaskText(text) {
    const trimmed = text == null ? '' : String(text).trim();
    if (!trimmed) {
        return { cleanTitle: '', taskDate: null };
    }
    const normalizedEntities = normalizeDateEntitiesText(trimmed);
    const priorityNumeric = parseUsNumericDatePriority(trimmed);
    if (priorityNumeric) {
        const before = trimmed.slice(0, priorityNumeric.start);
        const after = trimmed.slice(priorityNumeric.end);
        let cleanTitle = `${before}${after}`.replace(/\s+/g, ' ').trim();
        cleanTitle = stripEdgeDateConnectors(cleanTitle);
        return { cleanTitle, taskDate: priorityNumeric.date };
    }
    if (normalizedEntities.includes('__tomorrow__')) {
        const tomorrowYmd = addCalendarDaysYmd(getTodayBogotaYmd(), 1);
        const taskDate = new Date(`${tomorrowYmd}T12:00:00-05:00`);
        let cleanTitle = trimmed.replace(/\bma(?:ñ|n)ana\b/gi, ' ').replace(/\s+/g, ' ').trim();
        cleanTitle = stripEdgeDateConnectors(cleanTitle);
        return { cleanTitle, taskDate };
    }
    const chronoBogotaRef = { instant: getNlpReferenceDateBogota(), timezone: 'America/Bogota' };
    if (chrono.es.parseDate(trimmed, chronoBogotaRef, CHRONO_PARSE_OPTIONS) == null) {
        return { cleanTitle: trimmed, taskDate: null };
    }
    const results = chrono.es.parse(trimmed, chronoBogotaRef, CHRONO_PARSE_OPTIONS);
    const first = results[0];
    if (!first) {
        return { cleanTitle: trimmed, taskDate: null };
    }
    let taskDate = first.date();
    if (/\b(este|esta)\b/i.test(first.text) && first.start.isOnlyWeekdayComponent()) {
        const wd = first.start.get('weekday');
        if (wd != null) {
            const { weekStart } = getBogotaCurrentWeekMondaySundayYmd();
            const daysFromMonday = (wd + 6) % 7;
            const ymd = addCalendarDaysYmd(weekStart, daysFromMonday);
            taskDate = new Date(`${ymd}T12:00:00-05:00`);
        }
    }
    const todayYmd = getTodayBogotaYmd();
    let taskYmd = taskDateToBogotaYmd(taskDate);
    if (
        first.start.isOnlyWeekdayComponent() &&
        taskYmd === todayYmd &&
        !/\b(este|esta)\b/i.test(first.text)
    ) {
        taskDate = new Date(taskDate.getTime() + 7 * DAY_MS);
        taskYmd = taskDateToBogotaYmd(taskDate);
    }
    if (/\bpr[oó]ximo\b|\bproximo\b/i.test(first.text) && sameIsoWeekYmd(todayYmd, taskYmd)) {
        taskDate = new Date(taskDate.getTime() + 7 * DAY_MS);
    }
    const before = trimmed.slice(0, first.index);
    const after = trimmed.slice(first.index + first.text.length);
    let cleanTitle = `${before}${after}`.replace(/\s+/g, ' ').trim();
    cleanTitle = stripEdgeDateConnectors(cleanTitle);
    return { cleanTitle, taskDate };
}

async function createNotionTaskPage(taskData) {
    let name = (taskData.Name || '').trim();
    const fromPrefix = extractAreaPrefixFromName(name);
    if (fromPrefix.cleanName) {
        name = fromPrefix.cleanName;
    }
    const areaRaw = String(taskData.Area != null ? taskData.Area : 'Personales').trim();
    let area = normalizeNotionArea(areaRaw).trim();
    if (fromPrefix.areaFromPrefix && (!area || toComparableKey(area) === toComparableKey('Personales'))) {
        area = fromPrefix.areaFromPrefix;
    }
    const parsedFromName = parseTaskText(name);
    if (parsedFromName.cleanTitle && parsedFromName.cleanTitle.trim()) {
        name = parsedFromName.cleanTitle.trim();
    }
    if (/\b(URGENTE|YA|IMPORTANTE)\b/i.test(name)) {
        if (!name.startsWith('🚨')) name = '🚨 ' + name;
        if (area === 'Personales') area = 'IA Dev';
    }
    area = area.trim();
    const fechaRaw = (taskData.Fecha != null ? String(taskData.Fecha) : '').trim();
    let fechaYmd = resolveNaturalDate(fechaRaw);
    if ((!fechaYmd || !/^\d{4}-\d{2}-\d{2}$/.test(fechaYmd)) && parsedFromName.taskDate) {
        fechaYmd = taskDateToBogotaYmd(parsedFromName.taskDate);
    }
    if (!fechaYmd || !/^\d{4}-\d{2}-\d{2}$/.test(fechaYmd)) {
        fechaYmd = getTodayBogotaYmd();
    }
    const properties = {
        [PROP_TASK_NAME]: { title: [{ text: { content: name } }] },
        [PROP_TASK_ESTADO]: { select: { name: TASK_STATUS_PENDING } },
        [PROP_TASK_AREA]: { select: { name: area.trim() } },
        [PROP_TASK_FECHA]: { date: { start: fechaYmd } }
    };
    const res = await fetch(`https://api.notion.com/v1/pages`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ parent: { database_id: databaseId }, properties })
    });
    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        return { ok: false, error: `❌ Error Notion (${detail}).` };
    }
    const data = await res.json();
    return {
        ok: true,
        id: data.id,
        url: typeof data.url === 'string' ? data.url.trim() : '',
        databaseId,
        databaseName: TASKS_DATABASE_DISPLAY_NAME,
        taskName: name,
        dateYmd: fechaYmd,
        area
    };
}

/**
 * @returns {{ ok: true, text: string, taskName: string } | { ok: false, text: string }}
 */
async function updateNotionTaskStatus(searchNameOrId, newStatus, isId = false) {
    let pageId = isId ? searchNameOrId : null;
    let taskName = null;

    if (!isId) {
        const match = await findBestFuzzyMatch(searchNameOrId);
        if (!match) {
            return { ok: false, text: `❌ No encontré similar a "${searchNameOrId}".` };
        }
        pageId = match.pageId;
        taskName = match.name;
    }

    let data;
    try {
        data = await updateTaskStatus(pageId, newStatus);
    } catch (_) {
        return { ok: false, text: '❌ Error al actualizar.' };
    }
    const nameFromPage =
        data?.properties?.[PROP_TASK_NAME]?.title?.[0]?.text?.content?.trim() || null;
    const resolvedName = taskName || nameFromPage || 'Tarea';
    return {
        ok: true,
        text: `✅ Tarea actualizada a ${newStatus}`,
        taskName: resolvedName
    };
}

/**
 * Actualiza el select Estado de una tarea específica en Notion por page_id.
 * También sincroniza Fecha de Cierre cuando el estado es completado.
 * @param {string} pageId
 * @param {string} newStatus
 * @returns {Promise<any>} Página de Notion actualizada.
 */
function notionRichTextToPlain(richText) {
    if (!Array.isArray(richText)) return '';
    return richText.map((t) => t?.plain_text || '').join('').trim();
}

function extractPlanProjectFromNotionPage(page) {
    const props = page?.properties || {};
    const title = notionRichTextToPlain(props[PROP_PROYECTO_NAME]?.title) || 'Sin título';
    const fecha = props[PROP_PROYECTO_FECHA_EJECUCION]?.date?.start || '';
    const tipo = props[PROP_PROYECTO_TIPO]?.select?.name || 'Sin tipo';
    const status = props[PROP_PROYECTO_ESTADO]?.select?.name || '---';
    return {
        id: page?.id || '',
        name: title,
        fechaYmd: fecha,
        tipo,
        status,
    };
}

function buildPlanProjectsNotionFilter() {
    return {
        property: PROP_PROYECTO_ESTADO,
        select: { does_not_equal: PLAN_STATUS_COMPLETED },
    };
}

/**
 * Proyectos activos (NOTION_DB_PROYECTO_ID), ordenados por Fecha de Ejecución ascendente.
 * @returns {Promise<{ id: string, name: string, fechaYmd: string, tipo: string, status: string }[]>}
 */
async function queryNotionPlanProjects() {
    if (!notionProyectoDbId) {
        throw new Error('Falta NOTION_DB_PROYECTO_ID.');
    }
    if (!notionToken) {
        throw new Error('Falta NOTION_TOKEN.');
    }
    const items = [];
    let nextCursor = null;
    do {
        const body = {
            page_size: 100,
            filter: buildPlanProjectsNotionFilter(),
            sorts: [{ property: PROP_PROYECTO_FECHA_EJECUCION, direction: 'ascending' }],
        };
        if (nextCursor) body.start_cursor = nextCursor;
        const res = await fetch(`https://api.notion.com/v1/databases/${notionProyectoDbId}/query`, {
            method: 'POST',
            headers: NOTION_HEADERS,
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            const detail = data?.message ? `${res.status}: ${data.message}` : String(res.status);
            throw new Error(`Error consultando plan de proyectos (${detail}).`);
        }
        const pages = Array.isArray(data?.results) ? data.results : [];
        items.push(...pages.map(extractPlanProjectFromNotionPage));
        nextCursor = data.has_more ? data.next_cursor : null;
    } while (nextCursor);
    return items;
}

/**
 * @returns {{ ok: true, text: string, itemName: string } | { ok: false, text: string }}
 */
async function updateNotionProyectoEstado(pageId, newStatus) {
    const id = String(pageId || '').trim();
    const status = String(newStatus || '').trim();
    if (!id || !NOTION_UUID_RE.test(id)) {
        return { ok: false, text: '❌ pageId inválido.' };
    }
    if (!status) {
        return { ok: false, text: '❌ Estado inválido.' };
    }
    if (!notionToken) {
        return { ok: false, text: '❌ Falta NOTION_TOKEN.' };
    }
    const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            properties: {
                [PROP_PROYECTO_ESTADO]: { select: { name: status } },
            },
        }),
    });
    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        return { ok: false, text: `❌ Error Notion (${detail}).` };
    }
    const data = await res.json();
    const nameFromPage =
        notionRichTextToPlain(data?.properties?.[PROP_PROYECTO_NAME]?.title) || 'Proyecto';
    return {
        ok: true,
        text: `✅ Proyecto actualizado a ${status}`,
        itemName: nameFromPage,
    };
}

async function updateTaskStatus(pageId, newStatus) {
    const id = String(pageId || '').trim();
    const status = String(newStatus || '').trim();
    if (!id || !NOTION_UUID_RE.test(id)) {
        throw new Error('pageId inválido.');
    }
    if (!status) {
        throw new Error('newStatus inválido.');
    }

    const completing = isTaskCompletionIntent(status);
    const notionEstado = completing ? 'Hecho' : status;

    const properties = {
        [PROP_TASK_ESTADO]: { select: { name: notionEstado } },
    };
    if (completing) {
        properties[PROP_TASK_FECHA_CIERRE] = {
            date: { start: new Date().toISOString() },
        };
    } else {
        properties[PROP_TASK_FECHA_CIERRE] = { date: null };
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        throw new Error(`Error Notion actualizando estado (${detail}).`);
    }
    return await res.json();
}

async function readNotionTasks(filterArea, filterDate) {
    const areaFilter = filterArea ? normalizeNotionArea(String(filterArea).trim()) : '';
    const { weekStart, weekEnd } = getBogotaCurrentWeekMondaySundayYmd();

    /** Pausadas: solo si Fecha cae en la semana actual (lunes–domingo, Bogotá). */
    const pausedThisWeek = {
        and: [
            { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PAUSED } },
            { property: PROP_TASK_FECHA, date: { on_or_after: weekStart } },
            { property: PROP_TASK_FECHA, date: { on_or_before: weekEnd } },
        ],
    };

    const statusFilter = {
        or: [
            { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
            { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } },
            pausedThisWeek,
        ],
    };
    const filters = [statusFilter];
    if (areaFilter) filters.push({ property: PROP_TASK_AREA, select: { equals: areaFilter } });
    if (filterDate) filters.push({ property: PROP_TASK_FECHA, date: { equals: String(filterDate).trim() } });

    const filter = filters.length === 1 ? filters[0] : { and: filters };

    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ filter })
    });
    const data = await res.json();
    
    if (!data.results?.length) return { text: '🔍 Sin pendientes.', tasks: [] };

    const resultsFiltered = data.results.filter((p) => {
        const st = p.properties?.[PROP_TASK_ESTADO]?.select?.name;
        if (st !== TASK_STATUS_PAUSED) return true;
        const ymd = getTaskScheduledYmdFromPage(p);
        if (!ymd) return false;
        return ymd >= weekStart && ymd <= weekEnd;
    });

    if (!resultsFiltered.length) return { text: '🔍 Sin pendientes.', tasks: [] };

    const tasks = resultsFiltered.map((p) => ({
        id: p.id,
        name: p.properties[PROP_TASK_NAME]?.title[0]?.text?.content || 'Sin título',
        status: p.properties[PROP_TASK_ESTADO]?.select?.name || '---',
        area: p.properties[PROP_TASK_AREA]?.select?.name || '---'
    }));

    const text =
        '📋 Tus tareas:\n' +
        tasks.map((t, i) => `${i + 1}. 📌 [${t.area}] — ${t.name} (${t.status})`).join('\n');
    return { text, tasks };
}

/**
 * Normaliza una página Notion al formato de tarea para resúmenes de Telegram.
 * @param {any} p
 * @returns {{ id: string, name: string, status: string, area: string }}
 */
function mapTaskPageToSummaryTask(p) {
    return {
        id: p.id,
        name: p.properties?.[PROP_TASK_NAME]?.title?.[0]?.text?.content || 'Sin título',
        status: p.properties?.[PROP_TASK_ESTADO]?.select?.name || '---',
        area: p.properties?.[PROP_TASK_AREA]?.select?.name || '---',
    };
}

/**
 * Formatea la lista de tareas para Telegram.
 * @param {{ id: string, name: string, status: string, area: string }[]} tasks
 * @returns {string}
 */
function formatSummaryTasksText(tasks) {
    if (!tasks.length) return '🔍 Sin pendientes.';
    return '📋 Tus tareas:\n' + tasks.map((t, i) => `${i + 1}. 📌 [${t.area}] — ${t.name} (${t.status})`).join('\n');
}

/**
 * Consulta tareas cuya propiedad Fecha coincide exactamente con hoy (Bogotá).
 * Incluye estados activos: Pendiente, Haciendo y Pausado.
 * @returns {Promise<{ text: string, tasks: { id: string, name: string, status: string, area: string }[], dateYmd: string }>}
 */
async function getDailyTasks() {
    const dateYmd = getTodayBogotaYmd();
    const pages = await queryTaskDatabaseAll({
        and: [
            {
                or: [
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
                    { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } },
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PAUSED } }
                ]
            },
            { property: PROP_TASK_FECHA, date: { equals: dateYmd } }
        ]
    });
    const tasks = pages.map(mapTaskPageToSummaryTask);
    return { text: formatSummaryTasksText(tasks), tasks, dateYmd };
}

/**
 * Consulta tareas cuya propiedad Fecha coincide exactamente con mañana (Bogotá).
 * Incluye estados activos: Pendiente, Haciendo y Pausado.
 * @returns {Promise<{ text: string, tasks: { id: string, name: string, status: string, area: string }[], dateYmd: string }>}
 */
async function getTomorrowTasks() {
    const dateYmd = getTomorrowBogotaYmd();
    const pages = await queryTaskDatabaseAll({
        and: [
            {
                or: [
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
                    { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } },
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PAUSED } }
                ]
            },
            { property: PROP_TASK_FECHA, date: { equals: dateYmd } }
        ]
    });
    const tasks = pages.map(mapTaskPageToSummaryTask);
    return { text: formatSummaryTasksText(tasks), tasks, dateYmd };
}

/**
 * Consulta tareas cuya propiedad Fecha está dentro de la semana en curso (Bogotá, lunes-domingo).
 * Incluye estados activos: Pendiente, Haciendo y Pausado.
 * @returns {Promise<{ text: string, tasks: { id: string, name: string, status: string, area: string }[], weekStart: string, weekEnd: string }>}
 */
async function getWeeklyTasks() {
    const { weekStart, weekEnd } = getBogotaCurrentWeekMondaySundayYmd();
    const pages = await queryTaskDatabaseAll({
        and: [
            {
                or: [
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
                    { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } },
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PAUSED } }
                ]
            },
            { property: PROP_TASK_FECHA, date: { on_or_after: weekStart } },
            { property: PROP_TASK_FECHA, date: { on_or_before: weekEnd } }
        ]
    });
    const tasks = pages.map(mapTaskPageToSummaryTask);
    return { text: formatSummaryTasksText(tasks), tasks, weekStart, weekEnd };
}

/**
 * Consulta tareas cuya propiedad Fecha está dentro del mes en curso (Bogotá).
 * Incluye estados activos: Pendiente, Haciendo y Pausado.
 * @returns {Promise<{ text: string, tasks: { id: string, name: string, status: string, area: string }[], monthStart: string, monthEnd: string }>}
 */
async function getMonthTasks() {
    const { monthStart, monthEnd } = getBogotaCurrentMonthStartEndYmd();
    const pages = await queryTaskDatabaseAll({
        and: [
            {
                or: [
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
                    { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } },
                    { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PAUSED } }
                ]
            },
            { property: PROP_TASK_FECHA, date: { on_or_after: monthStart } },
            { property: PROP_TASK_FECHA, date: { on_or_before: monthEnd } }
        ]
    });
    const tasks = pages.map(mapTaskPageToSummaryTask);
    return { text: formatSummaryTasksText(tasks), tasks, monthStart, monthEnd };
}

async function deleteNotionTask(searchNameOrId, isId = false) {
    let pageId = isId ? searchNameOrId : null;
    if (!isId) {
        const match = await findBestFuzzyMatch(searchNameOrId);
        if (!match) return `❌ No encontré "${searchNameOrId}".`;
        pageId = match.pageId;
    }
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ archived: true })
    });
    return res.ok ? `🗑️ Tarea eliminada correctamente.` : `❌ Error al eliminar.`;
}

/**
 * Reprograma la propiedad Fecha de una tarea por page_id usando texto natural en español.
 * El parseo usa la configuración actual de chrono.es (Bogotá, forwardDate).
 * @param {string} pageId
 * @param {string} naturalDateText
 * @returns {Promise<{ ok: true, dateYmd: string } | { ok: false, error: string }>}
 */
async function rescheduleTaskDateByPageId(pageId, naturalDateText) {
    const id = String(pageId || "").trim();
    if (!id) {
        return { ok: false, error: "❌ page_id inválido para reprogramar." };
    }
    const text = String(naturalDateText || "").trim();
    if (!text) {
        return { ok: false, error: "❌ Escribe una fecha válida (ej. `para el próximo viernes`)." };
    }
    const { taskDate } = parseTaskText(text);
    if (!taskDate) {
        return { ok: false, error: "❌ No pude interpretar la fecha. Intenta con un formato como `próximo viernes`." };
    }
    const dateYmd = taskDateToBogotaYmd(taskDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
        return { ok: false, error: "❌ Fecha inválida tras el parseo." };
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: "PATCH",
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            properties: {
                [PROP_TASK_FECHA]: { date: { start: dateYmd } },
            },
        }),
    });

    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        return { ok: false, error: `❌ Error al reprogramar en Notion (${detail}).` };
    }

    return { ok: true, dateYmd };
}

async function getOverdueTasks() {
    const todayStr = getTodayBogotaYmd();
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            filter: {
                and: [
                    {
                        or: [
                            { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
                            { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } },
                            { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PAUSED } }
                        ]
                    },
                    { property: PROP_TASK_FECHA, date: { before: todayStr } }
                ]
            }
        })
    });
    const data = await res.json();
    return data.results || [];
}

/**
 * Crea una fila en la base de Notas (inbox): Name = título, Text = cuerpo.
 * Parent: base cuyo ID está en NOTION_INBOX_ID (debe ser UUID y la integración debe tener acceso).
 * @param {string} title
 * @param {string} content
 */
async function createNotionNotePage(title, content) {
    if (!notionInboxId) {
        return '❌ Falta NOTION_INBOX_ID en el entorno (Vercel → Variables).';
    }
    if (!NOTION_UUID_RE.test(notionInboxId)) {
        return '❌ NOTION_INBOX_ID no es un UUID válido (sin comillas ni espacios extra). Revisa Vercel.';
    }
    if (!notionToken) {
        return '❌ Falta NOTION_TOKEN en el entorno.';
    }
    const name = (title || '').trim();
    const properties = {
        Name: { title: [{ text: { content: name } }] },
        Text: { rich_text: toRichTextSegments(content) }
    };
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ parent: { database_id: notionInboxId }, properties })
    });
    if (res.ok) return await res.json();
    let detail = String(res.status);
    try {
        const errBody = await res.json();
        if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
    } catch (_) {
        /* ignore */
    }
    const hint404 =
        res.status === 404
            ? ' Comprueba en Notion que la integración tenga acceso a esa base y que el ID sea el de la base (no una página suelta).'
            : '';
    return `❌ Error Notion (${detail}).${hint404}`;
}

/**
 * Convierte amount a número finito (acepta number o string con separadores locales).
 * Quita miles con coma (15,000) o con punto (15.000 / 1.234.567); no envía strings sucios a Notion Number.
 * @param {number|string} amount
 * @returns {number}
 */
function parseExpenseAmount(amount) {
    if (typeof amount === 'number' && Number.isFinite(amount)) return amount;
    const raw = String(amount ?? '').trim();
    if (!raw) return NaN;
    const cleaned = raw.replace(/[\s$€]/gi, '').replace(/[^\d.,\-]/g, '');
    if (!cleaned || cleaned === '-') return NaN;
    const neg = cleaned.startsWith('-');
    let s = cleaned.replace(/^-/, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let numStr;
    if (lastComma > lastDot) {
        numStr = s.replace(/\./g, '').replace(',', '.');
    } else {
        let t = s.replace(/,/g, '');
        if (!t.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(t)) {
            numStr = t.replace(/\./g, '');
        } else {
            numStr = t;
        }
    }
    const n = parseFloat(numStr);
    if (!Number.isFinite(n)) return NaN;
    return neg ? -n : n;
}

/**
 * Registra un gasto en la base Inbox Gastos (NOTION_EXPENSES_ID).
 * Propiedades: Name (title), Monto (number), Fecha de gasto (date).
 * @param {number|string} amount
 * @param {string} description
 */
async function createNotionExpensePage(amount, description) {
    if (!notionExpensesId) {
        return '❌ Falta NOTION_EXPENSES_ID en el entorno (Vercel → Variables).';
    }
    if (!NOTION_UUID_RE.test(notionExpensesId)) {
        return '❌ NOTION_EXPENSES_ID no es un UUID válido (sin comillas ni espacios extra). Revisa Vercel.';
    }
    if (!notionToken) {
        return '❌ Falta NOTION_TOKEN en el entorno.';
    }
    const monto = parseExpenseAmount(amount);
    if (!Number.isFinite(monto)) {
        return '❌ El monto no es un número válido.';
    }
    const name = String(description ?? '').trim() || 'Gasto';
    const fecha = getTodayBogotaYmd();
    const properties = {
        Name: { title: [{ text: { content: name } }] },
        Monto: { number: monto },
        [PROP_EXPENSE_FECHA]: { date: { start: fecha } },
    };
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ parent: { database_id: notionExpensesId }, properties })
    });
    if (res.ok) return await res.json();
    let detail = String(res.status);
    try {
        const errBody = await res.json();
        if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
    } catch (_) {
        /* ignore */
    }
    const hint404 =
        res.status === 404
            ? ' Comprueba en Notion que la integración tenga acceso a Inbox Gastos y que el ID sea el de la base.'
            : '';
    return `❌ Error Notion (${detail}).${hint404}`;
}

/**
 * Normaliza Quién al valor exacto del select en Notion (`Oscar` | `Yulis`).
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeTensionQuien(raw) {
    const key = String(raw || '').trim().toLowerCase();
    if (key === 'oscar') return 'Oscar';
    if (key === 'yulis') return 'Yulis';
    return null;
}

/**
 * Parsea el contenido tras `T/` / `t/`: persona + sistólica/diastólica.
 * @param {string} content
 * @returns {{ ok: true, quien: string, tension: string } | { ok: false }}
 */
function parseTensionSlashContent(content) {
    const raw = String(content || '').replace(/\s+/g, ' ').trim();
    const m = raw.match(/^(\S+)\s+(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!m) return { ok: false };
    const quien = normalizeTensionQuien(m[1]);
    if (!quien) return { ok: false };
    return { ok: true, quien, tension: `${m[2]}/${m[3]}` };
}

/**
 * Crea una fila en DB_Tension (NOTION_DB_TENSION_ID).
 * Título `YYYY MM DD` = fecha civil Bogotá; Fecha = ISO 8601 con offset -05:00;
 * Tension = rich_text; Quien = select Oscar|Yulis.
 * @param {{ quien: string, tension: string }} payload
 */
async function createNotionTensionPage({ quien, tension }) {
    if (!notionTensionId) {
        return '❌ Falta NOTION_DB_TENSION_ID en el entorno (Vercel → Variables).';
    }
    if (!NOTION_UUID_RE.test(notionTensionId)) {
        return '❌ NOTION_DB_TENSION_ID no es un UUID válido (sin comillas ni espacios extra). Revisa Vercel.';
    }
    if (!notionToken) {
        return '❌ Falta NOTION_TOKEN en el entorno.';
    }
    const quienExact = normalizeTensionQuien(quien);
    if (!quienExact) {
        return TENSION_INVALID_FORMAT_MSG;
    }
    const reading = String(tension ?? '').replace(/\s+/g, '').trim();
    if (!/^\d{2,3}\/\d{2,3}$/.test(reading)) {
        return TENSION_INVALID_FORMAT_MSG;
    }
    const nowIso = getNowBogotaIsoForNotionDateTime();
    const dateYmd = nowIso.slice(0, 10);
    const properties = {
        [PROP_TENSION_TITLE]: { title: [{ text: { content: dateYmd } }] },
        [PROP_TENSION_FECHA]: { date: { start: nowIso } },
        [PROP_TENSION_VALUE]: { rich_text: toRichTextSegments(reading) },
        [PROP_TENSION_QUIEN]: { select: { name: quienExact } },
    };
    try {
        const res = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: NOTION_HEADERS,
            body: JSON.stringify({ parent: { database_id: notionTensionId }, properties }),
        });
        if (res.ok) {
            const data = await res.json();
            return { ok: true, id: data.id, url: data.url, dateYmd, quien: quienExact, tension: reading };
        }
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) {
            /* ignore */
        }
        const hint404 =
            res.status === 404
                ? ' Comprueba en Notion que la integración tenga acceso a DB_Tension y que el ID sea el de la base.'
                : '';
        return `❌ Error Notion (${detail}).${hint404}`;
    } catch (err) {
        return `❌ Error Notion (${err.message || 'red o API'}).`;
    }
}

/**
 * Minutas (NOTION_MINUTAS_ID): propiedades — Name (title), Fecha (date). Renombra aquí si en Notion usas otro título.
 * @param {string} title
 */
async function createNotionMinutePage(title) {
    if (!notionMinutasId) {
        return '❌ Falta NOTION_MINUTAS_ID en el entorno (Vercel → Variables).';
    }
    if (!NOTION_UUID_RE.test(notionMinutasId)) {
        return '❌ NOTION_MINUTAS_ID no es un UUID válido (sin comillas ni espacios extra). Revisa Vercel.';
    }
    if (!notionToken) {
        return '❌ Falta NOTION_TOKEN en el entorno.';
    }
    const name = String(title ?? '').trim() || 'Minuta';
    const fecha = getTodayBogotaYmd();
    const properties = {
        Name: { title: [{ text: { content: name } }] },
        Fecha: { date: { start: fecha } }
    };
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ parent: { database_id: notionMinutasId }, properties })
    });
    if (res.ok) return await res.json();
    let detail = String(res.status);
    try {
        const errBody = await res.json();
        if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
    } catch (_) {
        /* ignore */
    }
    const hint404 =
        res.status === 404
            ? ' Comprueba en Notion que la integración tenga acceso a la base de minutas y que el ID sea el de la base.'
            : '';
    return `❌ Error Notion (${detail}).${hint404}`;
}

/**
 * Actividades (NOTION_ACTIVIDADES_PROYECTOS_ID): Actividad (title), Estado (select).
 * El option del select debe existir en Notion (p. ej. "Planificación").
 * @param {string} name
 */
async function createNotionActivityPage(name) {
    if (!notionActividadesProyectosId) {
        return '❌ Falta NOTION_ACTIVIDADES_PROYECTOS_ID en el entorno (Vercel → Variables).';
    }
    if (!NOTION_UUID_RE.test(notionActividadesProyectosId)) {
        return '❌ NOTION_ACTIVIDADES_PROYECTOS_ID no es un UUID válido (sin comillas ni espacios extra). Revisa Vercel.';
    }
    if (!notionToken) {
        return '❌ Falta NOTION_TOKEN en el entorno.';
    }
    const actividad = String(name ?? '').trim() || 'Actividad';
    const properties = {
        Actividad: { title: [{ text: { content: actividad } }] },
        Estado: { select: { name: 'Planificación' } }
    };
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ parent: { database_id: notionActividadesProyectosId }, properties })
    });
    if (res.ok) return await res.json();
    let detail = String(res.status);
    try {
        const errBody = await res.json();
        if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
    } catch (_) {
        /* ignore */
    }
    const hint404 =
        res.status === 404
            ? ' Comprueba en Notion que la integración tenga acceso a la base de actividades y que el ID sea el de la base.'
            : '';
    return `❌ Error Notion (${detail}).${hint404}`;
}

/** Nombre exacto de la columna de título en la base de hábitos (plantilla). */
const HABIT_PAGE_TITLE_PROPERTY = 'YYYY MM DD';

/** Caché de nombres de columnas checkbox (schema GET). */
let habitsCheckboxSchemaCache = { names: null, fetchedAt: 0 };
const HABITS_SCHEMA_CACHE_MS = 5 * 60 * 1000;

/**
 * Normaliza texto para comparar hábitos: minúsculas, espacios colapsados, sin tildes.
 * @param {string} str
 * @returns {string}
 */
const normalizeString = (str) =>
    String(str ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

/**
 * Lee la base de hábitos y devuelve los nombres reales de propiedades tipo checkbox.
 * @returns {Promise<{ ok: true, names: string[] } | { ok: false, message: string }>}
 */
async function fetchHabitsDatabaseCheckboxPropertyNames() {
    if (!habitsDatabaseId) {
        return { ok: false, message: '❌ Falta NOTION_HABITS_ID (o NOTION_HABITS_DATABASE_ID) en el entorno.' };
    }
    const now = Date.now();
    if (
        habitsCheckboxSchemaCache.names &&
        now - habitsCheckboxSchemaCache.fetchedAt < HABITS_SCHEMA_CACHE_MS
    ) {
        return { ok: true, names: habitsCheckboxSchemaCache.names };
    }

    const res = await fetch(`https://api.notion.com/v1/databases/${habitsDatabaseId}`, {
        method: 'GET',
        headers: NOTION_HEADERS
    });
    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) { /* ignore */ }
        return { ok: false, message: `❌ No se pudo leer el esquema de la base de hábitos (${detail}).` };
    }
    const data = await res.json();
    const props = data.properties || {};
    const names = Object.keys(props).filter((k) => props[k]?.type === 'checkbox');
    names.sort((a, b) => String(a).localeCompare(String(b), 'es'));
    habitsCheckboxSchemaCache = { names, fetchedAt: now };
    return { ok: true, names };
}

/**
 * Resuelve el nombre de columna checkbox: igualdad normalizada y, si no hay, distancia de Levenshtein sobre cadenas normalizadas.
 * @param {string} userInput
 * @param {string[]} checkboxNames
 * @returns {string | null}
 */
function resolveHabitPropertyName(userInput, checkboxNames) {
    const target = normalizeString(userInput);
    if (!target) return null;

    for (const name of checkboxNames) {
        if (normalizeString(name) === target) return name;
    }

    let bestName = null;
    let bestDist = Infinity;
    for (const name of checkboxNames) {
        const n = normalizeString(name);
        const d = getLevenshteinDistance(target, n);
        if (d < bestDist) {
            bestDist = d;
            bestName = name;
        }
    }
    if (!bestName) return null;
    const maxLen = Math.max(target.length, normalizeString(bestName).length);
    const threshold = Math.max(2, Math.floor(maxLen * 0.35));
    return bestDist <= threshold ? bestName : null;
}

/**
 * Enlace a la base de hábitos en Notion (UUID sin guiones). Opcional: NOTION_HABITS_URL completo.
 * @returns {string}
 */
function getHabitsDatabaseNotionUrl() {
    const custom = (process.env.NOTION_HABITS_URL || '').trim();
    if (custom) return custom;
    const id = (process.env.NOTION_HABITS_ID || process.env.NOTION_HABITS_DATABASE_ID || '').trim();
    if (!id) return '';
    return `https://www.notion.so/${id.replace(/-/g, '')}`;
}

/** Propiedad fecha en la base de hábitos. */
const HABIT_DATE_PROPERTY = 'Date';

/**
 * Buscar o crear la fila del día en la base de hábitos.
 * @returns {Promise<{ ok: true, page_id: string }>}
 */
async function ensureDailyHabitPage() {
    const habitsDbId = (process.env.NOTION_HABITS_ID || process.env.NOTION_HABITS_DATABASE_ID || '').trim();
    if (!habitsDbId) {
        throw new Error('❌ Falta NOTION_HABITS_ID (o NOTION_HABITS_DATABASE_ID) en el entorno.');
    }
    if (!NOTION_UUID_RE.test(habitsDbId)) {
        throw new Error('❌ NOTION_HABITS_ID no es un UUID válido.');
    }

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const pad = (n) => String(n).padStart(2, '0');
    const dayTitle = `${now.getFullYear()} ${pad(now.getMonth() + 1)} ${pad(now.getDate())}`;
    const dateIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const queryByTitle = await fetch(`https://api.notion.com/v1/databases/${habitsDbId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            filter: { property: HABIT_PAGE_TITLE_PROPERTY, title: { equals: dayTitle } },
        }),
    });
    if (!queryByTitle.ok) {
        let detail = String(queryByTitle.status);
        try {
            const errBody = await queryByTitle.json();
            if (errBody?.message) detail = `${queryByTitle.status}: ${errBody.message}`;
        } catch (_) { /* ignore */ }
        throw new Error(`❌ Error consultando base de hábitos (${detail}).`);
    }
    const titleData = await queryByTitle.json();
    if (titleData.object === 'error' && titleData.message) {
        throw new Error(`❌ ${titleData.message}`);
    }
    let existing = titleData.results?.[0];

    if (!existing?.id) {
        const queryByDate = await fetch(`https://api.notion.com/v1/databases/${habitsDbId}/query`, {
            method: 'POST',
            headers: NOTION_HEADERS,
            body: JSON.stringify({
                filter: { property: HABIT_DATE_PROPERTY, date: { equals: dateIso } },
            }),
        });
        if (queryByDate.ok) {
            const dateData = await queryByDate.json();
            existing = dateData.results?.[0];
        }
    }

    if (existing?.id) {
        return { ok: true, page_id: existing.id };
    }

    const schema = await fetchHabitsDatabaseCheckboxPropertyNames();
    if (!schema.ok) {
        throw new Error(schema.message);
    }

    const properties = {
        [HABIT_PAGE_TITLE_PROPERTY]: { title: [{ text: { content: dayTitle } }] },
        [HABIT_DATE_PROPERTY]: { date: { start: dateIso } },
    };
    for (const checkboxName of schema.names) {
        properties[checkboxName] = { checkbox: false };
    }

    const createRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            parent: { database_id: habitsDbId },
            properties,
        }),
    });
    if (!createRes.ok) {
        let detail = String(createRes.status);
        try {
            const errBody = await createRes.json();
            if (errBody?.message) detail = `${createRes.status}: ${errBody.message}`;
        } catch (_) { /* ignore */ }
        throw new Error(`❌ Error creando página diaria de hábitos (${detail}).`);
    }
    const data = await createRes.json();
    if (!data?.id) {
        throw new Error('❌ Notion no devolvió id de página al crear el día.');
    }
    return { ok: true, page_id: data.id };
}

/**
 * Lee los estados checkbox de una página de hábitos.
 * @param {string} pageId
 * @returns {Promise<{ ok: true, states: Record<string, boolean> } | { ok: false, message: string }>}
 */
async function getHabitPageCheckboxStates(pageId) {
    if (!pageId) {
        return { ok: false, message: '❌ page_id de hábitos inválido.' };
    }
    const schema = await fetchHabitsDatabaseCheckboxPropertyNames();
    if (!schema.ok) return { ok: false, message: schema.message };

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'GET',
        headers: NOTION_HEADERS,
    });
    if (!res.ok) {
        let detail = String(res.status);
        try {
            const errBody = await res.json();
            if (errBody?.message) detail = `${res.status}: ${errBody.message}`;
        } catch (_) { /* ignore */ }
        return { ok: false, message: `❌ No se pudo leer la página de hábitos (${detail}).` };
    }
    const page = await res.json();
    const props = page?.properties || {};
    const states = {};
    for (const name of schema.names) {
        states[name] = Boolean(props[name]?.checkbox);
    }
    return { ok: true, states };
}

/**
 * Hábitos pendientes (checkbox false) del día actual en Bogotá.
 * @returns {Promise<
 *   | {
 *       ok: true,
 *       pageId: string,
 *       pending: { propertyKey: string, name: string }[],
 *       sortedCheckboxNames: string[],
 *       allDone: boolean,
 *     }
 *   | { ok: false, message: string }
 * >}
 */
async function getPendingHabitsForToday() {
    try {
        const daily = await ensureDailyHabitPage();
        if (!daily?.ok || !daily.page_id) {
            return { ok: false, message: '❌ No pude asegurar la página diaria de hábitos.' };
        }
        const statesResult = await getHabitPageCheckboxStates(daily.page_id);
        if (!statesResult.ok) return statesResult;

        const schema = await fetchHabitsDatabaseCheckboxPropertyNames();
        if (!schema.ok) return schema;

        const pending = schema.names
            .filter((propertyKey) => !statesResult.states[propertyKey])
            .map((propertyKey) => ({ propertyKey, name: propertyKey }));

        return {
            ok: true,
            pageId: daily.page_id,
            pending,
            sortedCheckboxNames: schema.names,
            allDone: pending.length === 0,
        };
    } catch (e) {
        return { ok: false, message: e?.message || String(e) };
    }
}

/**
 * Resuelve el nombre exacto de propiedad checkbox por índice en el esquema ordenado alfabéticamente.
 * Stateless: reconsulta Notion en cada invocación.
 * @param {number} index
 * @returns {Promise<{ ok: true, propertyKey: string } | { ok: false, message: string }>}
 */
async function resolveHabitCheckboxPropertyBySortedIndex(index) {
    const schema = await fetchHabitsDatabaseCheckboxPropertyNames();
    if (!schema.ok) return schema;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= schema.names.length) {
        return { ok: false, message: '❌ Índice de hábito inválido.' };
    }
    return { ok: true, propertyKey: schema.names[i] };
}

/**
 * Marca un checkbox de hábito por nombre exacto de propiedad Notion.
 * @param {string} propertyKey
 * @param {string} pageId
 */
async function markHabitCheckboxDone(propertyKey, pageId) {
    if (!habitsDatabaseId) {
        return { ok: false, message: '❌ Falta NOTION_HABITS_ID (o NOTION_HABITS_DATABASE_ID) en el entorno.' };
    }
    const key = String(propertyKey || '').trim();
    if (!key) return { ok: false, message: '❌ Propiedad de hábito inválida.' };
    if (!pageId) return { ok: false, message: '❌ page_id de hábitos inválido.' };

    const patchRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ properties: { [key]: { checkbox: true } } }),
    });
    if (!patchRes.ok) {
        let detail = String(patchRes.status);
        try {
            const errBody = await patchRes.json();
            if (errBody?.message) detail = `${patchRes.status}: ${errBody.message}`;
        } catch (_) { /* ignore */ }
        return { ok: false, message: `❌ No se pudo marcar el hábito "${key}" (${detail}).` };
    }
    return { ok: true, resolvedName: key };
}

/**
 * Marca el checkbox del hábito en la página del día (Bogotá).
 * Resuelve el nombre de columna contra el esquema Notion (checkbox): normalizeString + fuzzy Levenshtein.
 * @param {string} habitName Texto del usuario (ej. "oracion", "ORACIÓN").
 * @param {string} [pageId] Si viene de ensureDailyHabitPage, se omite la query.
 * @returns {Promise<{ ok: true, resolvedName: string } | { ok: false, message: string }>}
 */
async function markHabitAsDone(habitName, pageId) {
    if (!habitsDatabaseId) {
        return { ok: false, message: '❌ Falta NOTION_HABITS_ID (o NOTION_HABITS_DATABASE_ID) en el entorno.' };
    }
    const raw = (habitName || '').trim();
    if (!raw) return { ok: false, message: '❌ Indica el nombre del hábito.' };

    const schema = await fetchHabitsDatabaseCheckboxPropertyNames();
    if (!schema.ok) return { ok: false, message: schema.message };
    if (!schema.names.length) {
        return { ok: false, message: '❌ La base de hábitos no tiene columnas de tipo checkbox.' };
    }

    const resolvedKey = resolveHabitPropertyName(raw, schema.names);
    if (!resolvedKey) {
        const list = schema.names.join(', ');
        return {
            ok: false,
            message: `❌ No encontré el hábito "${raw}". Los hábitos disponibles son: ${list}`
        };
    }

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()} ${pad(now.getMonth() + 1)} ${pad(now.getDate())}`;

    let targetPageId = pageId;
    if (!targetPageId) {
        const queryRes = await fetch(`https://api.notion.com/v1/databases/${habitsDatabaseId}/query`, {
            method: 'POST',
            headers: NOTION_HEADERS,
            body: JSON.stringify({
                filter: { property: HABIT_PAGE_TITLE_PROPERTY, title: { equals: todayStr } }
            })
        });
        if (!queryRes.ok) {
            let detail = String(queryRes.status);
            try {
                const errBody = await queryRes.json();
                if (errBody?.message) detail = `${queryRes.status}: ${errBody.message}`;
            } catch (_) { /* ignore */ }
            return { ok: false, message: `❌ Error buscando la página del día (${detail}).` };
        }
        const queryData = await queryRes.json();
        const page = queryData.results?.[0];
        if (!page?.id) {
            return {
                ok: false,
                message: `❌ No hay página de hábitos con título "${todayStr}". Usa habito/ tras crear el día o revisa la base.`
            };
        }
        targetPageId = page.id;
    }

    const patchRes = await fetch(`https://api.notion.com/v1/pages/${targetPageId}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ properties: { [resolvedKey]: { checkbox: true } } })
    });
    if (!patchRes.ok) {
        let detail = String(patchRes.status);
        try {
            const errBody = await patchRes.json();
            if (errBody?.message) detail = `${patchRes.status}: ${errBody.message}`;
        } catch (_) { /* ignore */ }
        return { ok: false, message: `❌ No se pudo marcar el hábito "${resolvedKey}" (${detail}).` };
    }
    return { ok: true, resolvedName: resolvedKey };
}

module.exports = {
    createNotionTaskPage,
    parseTaskText,
    taskDateToBogotaYmd,
    createNotionNotePage,
    createNotionExpensePage,
    createNotionTensionPage,
    parseTensionSlashContent,
    normalizeTensionQuien,
    TENSION_INVALID_FORMAT_MSG,
    createNotionMinutePage,
    createNotionActivityPage,
    parseExpenseAmount,
    markHabitAsDone,
    normalizeNotionArea,
    updateNotionTaskStatus,
    updateTaskStatus,
    readNotionTasks,
    getDailyTasks,
    getTomorrowTasks,
    getWeeklyTasks,
    getMonthTasks,
    deleteNotionTask,
    rescheduleTaskDateByPageId,
    getOverdueTasks,
    getWeeklyCronReportData,
    getCompletedTasksCountLast7DaysBogota,
    getCompletedTasksTodayBogota,
    getNextSundayBogotaYmd,
    ensureDailyHabitPage,
    getHabitsDatabaseNotionUrl,
    getPendingHabitsForToday,
    resolveHabitCheckboxPropertyBySortedIndex,
    markHabitCheckboxDone,
    queryNotionPlanProjects,
    updateNotionProyectoEstado,
    PLAN_STATUS_COMPLETED,
};