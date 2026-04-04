const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function createNotionTaskPage(taskData) {
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

/**
 * Updates the Estado (status) of a Notion Task by searching for a task whose Name contains searchName.
 * @param {string} searchName
 * @param {string} newStatus
 * @returns {Promise<string>}
 */
async function updateNotionTaskStatus(searchName, newStatus) {
    const queryRes = await notion.databases.query({
        database_id: databaseId,
        filter: {
            property: 'Name',
            title: {
                contains: searchName
            }
        }
    });

    if (!queryRes.results || queryRes.results.length === 0) {
        return '❌ No encontré ninguna tarea que coincida con ese nombre';
    }

    const taskId = queryRes.results[0].id;

    await notion.pages.update({
        page_id: taskId,
        properties: {
            'Estado': {
                select: { name: newStatus }
            }
        }
    });

    return '✅ Tarea movida a: ' + newStatus;
}

/**
 * Reads tasks from Notion, optionally filtering by Area and/or Date.
 * @param {string} filterArea
 * @param {string} filterDate
 * @returns {Promise<string>}
 */
async function readNotionTasks(filterArea, filterDate) {
    let filters = [];

    if (filterArea) {
        filters.push({
            property: 'Area',
            select: {
                equals: filterArea
            }
        });
    }

    if (filterDate) {
        filters.push({
            property: 'Fecha',
            date: {
                equals: filterDate
            }
        });
    }

    // Default: show pending tasks (not 'Hecho') if no filters are given
    if (filters.length === 0) {
        filters.push({
            property: 'Estado',
            select: {
                does_not_equal: 'Hecho'
            }
        });
    }

    const queryRes = await notion.databases.query({
        database_id: databaseId,
        filter: filters.length === 1 ? filters[0] : { and: filters }
    });

    if (!queryRes.results || queryRes.results.length === 0) {
        return 'No hay tareas con esos criterios.';
    }

    const tasksList = queryRes.results.map(page => {
        // Extract title (Name), Estado
        const nameProp = page.properties['Name'];
        const estadoProp = page.properties['Estado'];
        const title = nameProp && nameProp.title.length > 0
            ? nameProp.title[0].plain_text
            : 'Sin título';
        const estado = estadoProp && estadoProp.select && estadoProp.select.name
            ? estadoProp.select.name
            : 'Desconocido';
        return `- ${title} (${estado})`;
    }).join('\n');

    return tasksList;
}

module.exports = {
    createNotionTaskPage,
    updateNotionTaskStatus,
    readNotionTasks
};