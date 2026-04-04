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

module.exports = { createNotionTaskPage };