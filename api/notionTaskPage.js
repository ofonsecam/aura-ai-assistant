const databaseId = (process.env.NOTION_DATABASE_ID || '').trim();
/** Etiqueta humana para logs/Telegram (opcional: NOTION_TASKS_DATABASE_NAME en Vercel). */
const TASKS_DATABASE_DISPLAY_NAME = (process.env.NOTION_TASKS_DATABASE_NAME || 'Base de tareas').trim();
/**
 * Esquema de la base de tareas (solo estas claves en creación/lectura de tareas).
 * Título: Name; fecha: Fecha (date YYYY-MM-DD); Area; Estado.
 */
const PROP_TASK_NAME = 'Name';
const PROP_TASK_ESTADO = 'Estado';
const PROP_TASK_FECHA = 'Fecha';
const PROP_TASK_AREA = 'Area';
/** Valor exacto del select Estado para tareas nuevas (P mayúscula). */
const TASK_STATUS_PENDING = 'Pendiente';

const notionInboxId = (process.env.NOTION_INBOX_ID || '').trim();
/** Base de hábitos: prioridad NOTION_HABITS_ID (Vercel), alias NOTION_HABITS_DATABASE_ID. */
const habitsDatabaseId = (process.env.NOTION_HABITS_ID || process.env.NOTION_HABITS_DATABASE_ID || '').trim();
const notionExpensesId = (process.env.NOTION_EXPENSES_ID || '').trim();
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

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ properties: { [PROP_TASK_ESTADO]: { select: { name: newStatus } } } })
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
    const statusFilter = {
        or: [
            { property: PROP_TASK_ESTADO, select: { equals: TASK_STATUS_PENDING } },
            { property: PROP_TASK_ESTADO, select: { equals: 'Haciendo' } },
            { property: PROP_TASK_ESTADO, select: { equals: 'Pausado' } }
        ]
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

    const tasks = data.results.map((p) => ({
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
        Fecha: { date: { start: fecha } }
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

/**
 * Buscar o crear la fila del día en la base de hábitos.
 * @returns {Promise<{ ok: true, page_id: string }>}
 */
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
 * @param {string} habitName Nombre exacto de la columna checkbox en Notion (ej. "Escrituras").
 * @param {string} [pageId] Si viene de ensureDailyHabitPage, se omite la query.
 * @returns {Promise<string>} Mensaje de éxito o error (prefijo ❌).
 */
async function markHabitAsDone(habitName, pageId) {
    if (!habitsDatabaseId) {
        return '❌ Falta NOTION_HABITS_ID (o NOTION_HABITS_DATABASE_ID) en el entorno.';
    }
    const key = (habitName || '').trim();
    if (!key) return '❌ Indica el nombre del hábito.';

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
            return `❌ Error buscando la página del día (${detail}).`;
        }
        const queryData = await queryRes.json();
        const page = queryData.results?.[0];
        if (!page?.id) {
            return `❌ No hay página de hábitos con título "${todayStr}". Usa habito/ tras crear el día o revisa la base.`;
        }
        targetPageId = page.id;
    }

    const patchRes = await fetch(`https://api.notion.com/v1/pages/${targetPageId}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ properties: { [key]: { checkbox: true } } })
    });
    if (!patchRes.ok) {
        let detail = String(patchRes.status);
        try {
            const errBody = await patchRes.json();
            if (errBody?.message) detail = `${patchRes.status}: ${errBody.message}`;
        } catch (_) { /* ignore */ }
        return `❌ No se pudo marcar el hábito "${key}" (${detail}).`;
    }
    return `✅ Hábito "${key}" marcado para ${todayStr}.`;
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
    ensureDailyHabitPage,
    getHabitsDatabaseNotionUrl,
};