const { Client } = require('@notionhq/client');

// No instanciamos el cliente aquí de forma global para evitar "TypeError: is not a function"
const databaseId = process.env.NOTION_DATABASE_ID;

async function createNotionTaskPage(taskData) {
    const notion = new Client({ auth: process.env.NOTION_TOKEN }); // Instancia fresca

    const properties = {
        'Name': {
            title: [{ text: { content: taskData.Name } }]
        },
        'Estado': {
            select: { name: 'Pendiente' }
        }
    };

    if (taskData.Area) {
        properties['Area'] = {
            select: { name: taskData.Area }
        };
    }

    if (taskData.Fecha) {
        properties['Fecha'] = {
            date: { start: taskData.Fecha }
        };
    }

    const response = await notion.pages.create({
        parent: { database_id: databaseId },
        properties: properties
    });

    return response;
}

async function updateNotionTaskStatus(searchName, newStatus) {
    const notion = new Client({ auth: process.env.NOTION_TOKEN }); // Instancia fresca

    // 1. Buscar la tarea por nombre
    const response = await notion.databases.query({
        database_id: databaseId,
        filter: {
            property: 'Name',
            title: {
                contains: searchName
            }
        }
    });

    if (response.results.length === 0) {
        return `❌ No encontré ninguna tarea que coincida con "${searchName}".`;
    }

    // 2. Tomar el ID de la primera coincidencia
    const pageId = response.results[0].id;

    // 3. Actualizar el estado
    await notion.pages.update({
        page_id: pageId,
        properties: {
            'Estado': {
                select: { name: newStatus }
            }
        }
    });

    return `✅ Tarea "${searchName}" movida a: ${newStatus}`;
}

async function readNotionTasks(filterArea, filterDate) {
    const notion = new Client({ auth: process.env.NOTION_TOKEN }); // Instancia fresca
    const filters = [];

    // Filtro dinámico de Área
    if (filterArea) {
        filters.push({
            property: 'Area', 
            select: { equals: filterArea }
        });
    }

    // Filtro dinámico de Fecha
    if (filterDate) {
        filters.push({
            property: 'Fecha',
            date: { equals: filterDate }
        });
    }

    // Si no pides un área ni fecha específica, te mostramos todo lo que NO esté 'Hecho'
    if (filters.length === 0) {
        filters.push({
            property: 'Estado',
            select: { does_not_equal: 'Hecho' }
        });
    }

    // Ejecutar la consulta con los filtros combinados
    const response = await notion.databases.query({
        database_id: databaseId,
        filter: { and: filters }
    });

    if (response.results.length === 0) {
        return '🔍 No tienes tareas pendientes con esos criterios.';
    }

    // Formatear la lista para Telegram
    const taskStrings = response.results.map(page => {
        const nameObj = page.properties['Name']?.title[0];
        const nameText = nameObj ? nameObj.text.content : 'Sin título';
        const estadoObj = page.properties['Estado']?.select;
        const estadoText = estadoObj ? estadoObj.name : 'Sin estado';
        return `- ${nameText} (${estadoText})`;
    });

    return '📋 Tus tareas:\n' + taskStrings.join('\n');
}

module.exports = { 
    createNotionTaskPage, 
    updateNotionTaskStatus, 
    readNotionTasks 
};