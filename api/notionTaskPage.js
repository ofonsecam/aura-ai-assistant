const { Client } = require('@notionhq/client');

const databaseId = process.env.NOTION_DATABASE_ID;
const notionToken = process.env.NOTION_TOKEN;

async function createNotionTaskPage(taskData) {
    const notion = new Client({ auth: notionToken });
    const properties = {
        'Name': { title: [{ text: { content: taskData.Name } }] },
        'Estado': { select: { name: 'Pendiente' } }
    };
    if (taskData.Area) properties['Area'] = { select: { name: taskData.Area } };
    if (taskData.Fecha) properties['Fecha'] = { date: { start: taskData.Fecha } };

    return await notion.pages.create({ parent: { database_id: databaseId }, properties });
}

async function updateNotionTaskStatus(searchName, newStatus) {
    // Bypass del SDK: Petición HTTP nativa a Notion
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            filter: { property: 'Name', title: { contains: searchName } }
        })
    });
    
    const data = await queryRes.json();
    
    if (!data.results || data.results.length === 0) {
        return `❌ No encontré ninguna tarea que coincida con "${searchName}".`;
    }

    const pageId = data.results[0].id;

    // Actualización directa vía HTTP PATCH
    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            properties: { 'Estado': { select: { name: newStatus } } }
        })
    });

    return `✅ Tarea "${searchName}" movida a: ${newStatus}`;
}

async function readNotionTasks(filterArea, filterDate) {
    const filters = [];
    if (filterArea) filters.push({ property: 'Area', select: { equals: filterArea } });
    if (filterDate) filters.push({ property: 'Fecha', date: { equals: filterDate } });
    if (filters.length === 0) filters.push({ property: 'Estado', select: { does_not_equal: 'Hecho' } });

    // Bypass del SDK: Consulta nativa
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            filter: filters.length === 1 ? filters[0] : { and: filters }
        })
    });
    
    const data = await queryRes.json();
    
    if (!data.results || data.results.length === 0) {
        return '🔍 No tienes tareas pendientes con esos criterios.';
    }

    const taskStrings = data.results.map(page => {
        const nameObj = page.properties['Name']?.title[0];
        const nameText = nameObj ? nameObj.text.content : 'Sin título';
        const estadoObj = page.properties['Estado']?.select;
        const estadoText = estadoObj ? estadoObj.name : 'Sin estado';
        return `- ${nameText} (${estadoText})`;
    });

    return '📋 Tus tareas:\n' + taskStrings.join('\n');
}

module.exports = { createNotionTaskPage, updateNotionTaskStatus, readNotionTasks };