const databaseId = process.env.NOTION_DATABASE_ID;
const notionInboxId = process.env.NOTION_INBOX_ID;
const habitsDatabaseId = process.env.NOTION_HABITS_ID;
const notionToken = process.env.NOTION_TOKEN;

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
    let area = taskData.Area || 'Personales';
    let fecha = resolveNaturalDate(taskData.Fecha);
    if (/\b(URGENTE|YA|IMPORTANTE)\b/i.test(name)) {
        if (!name.startsWith('🚨')) name = '🚨 ' + name;
        if (area === 'Personales') area = 'IA Dev';
    }
    const properties = {
        'Name': { title: [{ text: { content: name } }] },
        'Estado': { select: { name: 'Pendiente' } },
        'Area': { select: { name: area } }
    };
    if (fecha) properties['Date'] = { date: { start: fecha } };
    const res = await fetch(`https://api.notion.com/v1/pages`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ parent: { database_id: databaseId }, properties })
    });
    return res.ok ? await res.json() : `❌ Error Notion: ${res.status}`;
}

async function updateNotionTaskStatus(searchNameOrId, newStatus, isId = false) {
    let pageId = isId ? searchNameOrId : null;
    let taskName = "Tarea";

    if (!isId) {
        const match = await findBestFuzzyMatch(searchNameOrId);
        if (!match) return `❌ No encontré similar a "${searchNameOrId}".`;
        pageId = match.pageId;
        taskName = match.name;
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ properties: { 'Estado': { select: { name: newStatus } } } })
    });
    return res.ok ? `✅ Tarea actualizada a ${newStatus}` : `❌ Error al actualizar.`;
}

async function readNotionTasks(filterArea, filterDate) {
    const filters = [];
    if (filterArea) filters.push({ property: 'Area', select: { equals: filterArea } });
    if (filterDate) filters.push({ property: 'Date', date: { equals: filterDate } });
    
    // Filtro por defecto: Todo lo que NO esté hecho
    if (filters.length === 0) {
        filters.push({
            or: [
                { property: 'Estado', select: { equals: 'Pendiente' } },
                { property: 'Estado', select: { equals: 'Haciendo' } },
                { property: 'Estado', select: { equals: 'Pausado' } }
            ]
        });
    }

    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ filter: filters.length === 1 ? filters[0] : { and: filters } })
    });
    const data = await res.json();
    
    if (!data.results?.length) return { text: '🔍 Sin pendientes.', tasks: [] };

    const tasks = data.results.map((p, i) => ({
        id: p.id,
        name: p.properties['Name']?.title[0]?.text?.content || 'Sin título',
        status: p.properties['Estado']?.select?.name || '---'
    }));

    const text = '📋 Tus tareas:\n' + tasks.map((t, i) => `${i + 1}. ${t.name} (${t.status})`).join('\n');
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
 * @param {string} title
 * @param {string} content
 */
async function createNotionNotePage(title, content) {
    if (!notionInboxId) return '❌ Falta NOTION_INBOX_ID en el entorno.';
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
    return res.ok ? await res.json() : `❌ Error Notion: ${res.status}`;
}

const HABIT_PAGE_TITLE_PROPERTY = 'Name';

/**
 * Marca un checkbox de hábito en la fila del día actual (título = YYYY-MM-DD, zona Bogotá).
 * @param {string} habitName Nombre exacto de la columna checkbox en Notion (ej. "Escrituras").
 */
async function markHabitAsDone(habitName) {
    if (!habitsDatabaseId) return '❌ Falta NOTION_HABITS_ID en el entorno.';
    const key = (habitName || '').trim();
    if (!key) return '❌ Indica el nombre del hábito.';

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const todayStr = now.toISOString().slice(0, 10);

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
    markHabitAsDone,
    updateNotionTaskStatus,
    readNotionTasks,
    deleteNotionTask,
    getOverdueTasks
};