const databaseId = process.env.NOTION_DATABASE_ID;
const notionToken = process.env.NOTION_TOKEN;

/**
 * Calcula la distancia de Levenshtein para permitir errores ortográficos.
 * Referencia: Levenshtein (1966).
 */
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

/**
 * Resuelve fechas relativas ajustadas a la zona horaria de Colombia (UTC-5).
 */
function resolveNaturalDate(input) {
    if (!input) return input;
    // Ajuste manual de zona horaria para Colombia en servidores UTC
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
    
    if (/^hoy$/i.test(input)) {
        return now.toISOString().slice(0, 10);
    } else if (/^mañana$|^manana$/i.test(input)) {
        now.setDate(now.getDate() + 1);
        return now.toISOString().slice(0, 10);
    }
    return input;
}

/**
 * Busca la página más similar que no esté 'Hecha'.
 */
async function findBestFuzzyMatch(searchName) {
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            filter: { property: 'Estado', select: { does_not_equal: 'Hecho' } }
        })
    });
    const data = await queryRes.json();
    if (!data.results || data.results.length === 0) return null;

    let bestMatch = { pageId: null, name: '', distance: Infinity };
    const target = searchName.trim().toLowerCase();

    for (const page of data.results) {
        const pageName = page.properties?.['Name']?.title?.[0]?.text?.content?.trim() || '';
        if (!pageName) continue;
        
        const dist = getLevenshteinDistance(target, pageName.toLowerCase());
        if (dist < bestMatch.distance) {
            bestMatch = { pageId: page.id, name: pageName, distance: dist };
        }
    }

    // Umbral dinámico: la distancia no debe superar el 40% de la longitud de la palabra encontrada
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
    if (fecha) properties['Fecha'] = { date: { start: fecha } };

    const result = await fetch(`https://api.notion.com/v1/pages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ parent: { database_id: databaseId }, properties })
    });
    return result.ok ? await result.json() : `❌ Error Notion: ${result.status}`;
}

async function updateNotionTaskStatus(searchName, newStatus) {
    const match = await findBestFuzzyMatch(searchName);
    if (!match) return `❌ No encontré una tarea similar a "${searchName}".`;

    const result = await fetch(`https://api.notion.com/v1/pages/${match.pageId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ properties: { 'Estado': { select: { name: newStatus } } } })
    });
    return result.ok ? `✅ "${match.name}" movida a ${newStatus}` : `❌ Error al actualizar.`;
}

async function readNotionTasks(filterArea, filterDate) {
    const filters = [];
    if (filterArea) filters.push({ property: 'Area', select: { equals: filterArea } });
    if (filterDate) filters.push({ property: 'Fecha', date: { equals: filterDate } });
    if (filters.length === 0) filters.push({ property: 'Estado', select: { does_not_equal: 'Hecho' } });

    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filter: filters.length === 1 ? filters[0] : { and: filters } })
    });
    const data = await res.json();
    if (!data.results?.length) return '🔍 Sin pendientes.';
    
    return '📋 Tus tareas:\n' + data.results.map(p => {
        const n = p.properties['Name']?.title[0]?.text?.content || 'Sin título';
        const e = p.properties['Estado']?.select?.name || '---';
        return `- ${n} (${e})`;
    }).join('\n');
}

async function deleteNotionTask(searchName) {
    const match = await findBestFuzzyMatch(searchName);
    if (!match) return `❌ No pude encontrar "${searchName}" para eliminar.`;

    const res = await fetch(`https://api.notion.com/v1/pages/${match.pageId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ archived: true })
    });
    return res.ok ? `🗑️ "${match.name}" eliminada correctamente.` : `❌ Error al eliminar.`;
}

module.exports = { createNotionTaskPage, updateNotionTaskStatus, readNotionTasks, deleteNotionTask };