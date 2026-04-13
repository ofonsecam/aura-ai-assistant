const databaseId = (process.env.NOTION_DATABASE_ID || '').trim();
const notionInboxId = (process.env.NOTION_INBOX_ID || '').trim();
const habitsDatabaseId = (process.env.NOTION_HABITS_ID || '').trim();
const notionExpensesId = (process.env.NOTION_EXPENSES_ID || '').trim();
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

function resolveNaturalDate(input) {
    if (!input) return input;
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
    if (/^hoy$/i.test(input)) return now.toISOString().slice(0, 10);
    if (/^mañana$|^manana$/i.test(input)) {
        now.setDate(now.getDate() + 1);
        return now.toISOString().slice(0, 10);
    }
    return input;
}

/** Fecha local YYYY-MM-DD en zona America/Bogota. */
function getTodayBogotaYmd() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    return now.toISOString().slice(0, 10);
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
                    { property: 'Estado', select: { equals: 'Pendiente' } },
                    { property: 'Estado', select: { equals: 'Haciendo' } },
                    { property: 'Estado', select: { equals: 'Pausado' } }
                ] 
            } 
        })
    });
    const data = await res.json();
    if (!data.results?.length) return null;
    let bestMatch = { pageId: null, name: '', distance: Infinity };
    const target = searchName.trim().toLowerCase();
    for (const page of data.results) {
        const pageName = page.properties?.['Name']?.title?.[0]?.text?.content?.trim() || '';
        if (!pageName) continue;
        const dist = getLevenshteinDistance(target, pageName.toLowerCase());
        if (dist < bestMatch.distance) bestMatch = { pageId: page.id, name: pageName, distance: dist };
    }
    const threshold = Math.max(2, Math.floor(bestMatch.name.length * 0.4));
    return bestMatch.distance <= threshold ? bestMatch : null;
}

async function createNotionTaskPage(taskData) {
    let name = (taskData.Name || '').trim();
    let area = normalizeNotionArea(taskData.Area || 'Personales');
    const fechaRaw = (taskData.Fecha != null ? String(taskData.Fecha) : '').trim();
    let fecha = resolveNaturalDate(fechaRaw);
    if (!fecha) fecha = getTodayBogotaYmd();
    if (/\b(URGENTE|YA|IMPORTANTE)\b/i.test(name)) {
        if (!name.startsWith('🚨')) name = '🚨 ' + name;
        if (area === 'Personales') area = 'IA Dev';
    }
    const properties = {
        'Name': { title: [{ text: { content: name } }] },
        'Estado': { select: { name: 'Pendiente' } },
        'Area': { select: { name: area } },
        'Date': { date: { start: fecha } }
    };
    const res = await fetch(`https://api.notion.com/v1/pages`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ parent: { database_id: databaseId }, properties })
    });
    return res.ok ? await res.json() : `❌ Error Notion: ${res.status}`;
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
        body: JSON.stringify({ properties: { 'Estado': { select: { name: newStatus } } } })
    });
    if (!res.ok) {
        return { ok: false, text: '❌ Error al actualizar.' };
    }
    const data = await res.json();
    const nameFromPage =
        data?.properties?.['Name']?.title?.[0]?.text?.content?.trim() || null;
    const resolvedName = taskName || nameFromPage || 'Tarea';
    return {
        ok: true,
        text: `✅ Tarea actualizada a ${newStatus}`,
        taskName: resolvedName
    };
}

async function readNotionTasks(filterArea, filterDate) {
    const areaFilter = filterArea ? normalizeNotionArea(String(filterArea)) : '';
    const statusFilter = {
        or: [
            { property: 'Estado', select: { equals: 'Pendiente' } },
            { property: 'Estado', select: { equals: 'Haciendo' } },
            { property: 'Estado', select: { equals: 'Pausado' } }
        ]
    };
    const filters = [statusFilter];
    if (areaFilter) filters.push({ property: 'Area', select: { equals: areaFilter } });
    if (filterDate) filters.push({ property: 'Date', date: { equals: filterDate } });

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
        name: p.properties['Name']?.title[0]?.text?.content || 'Sin título',
        status: p.properties['Estado']?.select?.name || '---',
        area: p.properties['Area']?.select?.name || '---'
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
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
    const todayStr = now.toISOString().slice(0, 10);
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            filter: {
                and: [
                    { or: [{ property: 'Estado', select: { equals: 'Pendiente' } }, { property: 'Estado', select: { equals: 'Haciendo' } }] },
                    { property: 'Date', date: { before: todayStr } }
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
 * Convierte amount a número finito (acepta number o string con separadores locales básicos).
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
        numStr = s.replace(/,/g, '');
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

const HABIT_PAGE_TITLE_PROPERTY = 'YYYY-MM-DD';

/**
 * Marca un checkbox en la fila donde la propiedad de título `YYYY-MM-DD` coincide con la fecha del día (valor "YYYY MM DD", Bogotá).
 * @param {string} habitName Nombre exacto de la columna checkbox en Notion (ej. "Escrituras").
 */
async function markHabitAsDone(habitName) {
    if (!habitsDatabaseId) return '❌ Falta NOTION_HABITS_ID en el entorno.';
    const key = (habitName || '').trim();
    if (!key) return '❌ Indica el nombre del hábito.';

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()} ${pad(now.getMonth() + 1)} ${pad(now.getDate())}`;

    const queryRes = await fetch(`https://api.notion.com/v1/databases/${habitsDatabaseId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
            filter: { property: HABIT_PAGE_TITLE_PROPERTY, title: { equals: todayStr } }
        })
    });
    const queryData = await queryRes.json();
    const page = queryData.results?.[0];
    if (!page) return `❌ No hay página de hábitos con título "${todayStr}".`;

    const patchRes = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ properties: { [key]: { checkbox: true } } })
    });
    return patchRes.ok
        ? `✅ Hábito "${key}" marcado para ${todayStr}.`
        : `❌ No pude actualizar el hábito (¿existe la propiedad "${key}"?).`;
}

module.exports = {
    createNotionTaskPage,
    createNotionNotePage,
    createNotionExpensePage,
    parseExpenseAmount,
    markHabitAsDone,
    normalizeNotionArea,
    updateNotionTaskStatus,
    readNotionTasks,
    deleteNotionTask,
    getOverdueTasks
};