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

const notionInboxId = (process.env.NOTION_INBOX_ID || '').trim();
/** Base de hábitos: prioridad NOTION_HABITS_ID (Vercel), alias NOTION_HABITS_DATABASE_ID. */
const habitsDatabaseId = (process.env.NOTION_HABITS_ID || process.env.NOTION_HABITS_DATABASE_ID || '').trim();
const notionExpensesId = (process.env.NOTION_EXPENSES_ID || '').trim();
/** Propiedad tipo fecha en la base Inbox Gastos (`NOTION_EXPENSES_ID`). Debe coincidir con el nombre en Notion. */
const PROP_EXPENSE_FECHA = 'Fecha de gasto';
const notionMinutasId = (process.env.NOTION_MINUTAS_ID || '').trim();
const notionActividadesProyectosId = (process.env.NOTION_ACTIVIDADES_PROYECTOS_ID || '').trim();
const notionToken = (process.env.NOTION_TOKEN || '').trim();

const NOTION_UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

const NOTION_HEADERS = {
    Authorization: `Bearer ${notionToken}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
};

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

    const doneStatusOr = TASK_STATUS_DONE_VALUES.map((name) => ({
        property: PROP_TASK_ESTADO,
        select: { equals: name },
    }));
    const completedThisWeekPages = await queryTaskDatabaseAll({
        and: [
            { or: doneStatusOr },
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

async function createNotionTaskPage(taskData) {
    let name = (taskData.Name || '').trim();
    const areaRaw = String(taskData.Area != null ? taskData.Area : 'Personales').trim();
    let area = normalizeNotionArea(areaRaw).trim();
    if (/\b(URGENTE|YA|IMPORTANTE)\b/i.test(name)) {
        if (!name.startsWith('🚨')) name = '🚨 ' + name;
        if (area === 'Personales') area = 'IA Dev';
    }
    area = area.trim();
    const fechaRaw = (taskData.Fecha != null ? String(taskData.Fecha) : '').trim();
    let fechaYmd = resolveNaturalDate(fechaRaw);
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
        databaseName: TASKS_DATABASE_DISPLAY_NAME
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

    const properties = {
        [PROP_TASK_ESTADO]: { select: { name: newStatus } },
    };
    if (isTaskStatusCompleted(newStatus)) {
        properties[PROP_TASK_FECHA_CIERRE] = {
            date: { start: getNowBogotaIsoForNotionDateTime() },
        };
    } else {
        properties[PROP_TASK_FECHA_CIERRE] = { date: null };
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
        return { ok: false, text: '❌ Error al actualizar.' };
    }
    const data = await res.json();
    const nameFromPage =
        data?.properties?.[PROP_TASK_NAME]?.title?.[0]?.text?.content?.trim() || null;
    const resolvedName = taskName || nameFromPage || 'Tarea';
    return {
        ok: true,
        text: `✅ Tarea actualizada a ${newStatus}`,
        taskName: resolvedName
    };
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

async function getOverdueTasks() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    const todayStr = now.toISOString().slice(0, 10);
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            filter: {
                and: [
                    {
                        or: [
                            { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
                            { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } }
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
    names.sort((a, b) => a.localeCompare(b, 'es'));
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

    const queryRes = await fetch(`https://api.notion.com/v1/databases/${habitsDbId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            filter: { property: HABIT_PAGE_TITLE_PROPERTY, title: { equals: dayTitle } }
        })
    });
    if (!queryRes.ok) {
        let detail = String(queryRes.status);
        try {
            const errBody = await queryRes.json();
            if (errBody?.message) detail = `${queryRes.status}: ${errBody.message}`;
        } catch (_) { /* ignore */ }
        throw new Error(`❌ Error consultando base de hábitos (${detail}).`);
    }
    const queryData = await queryRes.json();
    if (queryData.object === 'error' && queryData.message) {
        throw new Error(`❌ ${queryData.message}`);
    }
    const existing = queryData.results?.[0];
    if (existing?.id) {
        return { ok: true, page_id: existing.id };
    }

    const properties = {
        [HABIT_PAGE_TITLE_PROPERTY]: { title: [{ text: { content: dayTitle } }] },
        Date: { date: { start: dateIso } }
    };
    const createRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            parent: { database_id: habitsDbId },
            properties
        })
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
    createNotionNotePage,
    createNotionExpensePage,
    createNotionMinutePage,
    createNotionActivityPage,
    parseExpenseAmount,
    markHabitAsDone,
    normalizeNotionArea,
    updateNotionTaskStatus,
    readNotionTasks,
    deleteNotionTask,
    getOverdueTasks,
    getWeeklyCronReportData,
    getCompletedTasksTodayBogota,
    ensureDailyHabitPage,
    getHabitsDatabaseNotionUrl,
};