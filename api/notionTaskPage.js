const { Client } = require("@notionhq/client");

/**
 * Crea una fila (página) en la base de Notion configurada por env.
 * @param {string} taskName Texto del título (propiedad Name).
 * @returns {Promise<import('@notionhq/client').CreatePageResponse>}
 */
async function createNotionTaskPage(taskName) {
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    return notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
            Name: {
                title: [{ text: { content: taskName } }],
            },
            Estado: {
                select: { name: "Pendiente" },
            },
        },
    });
}

module.exports = { createNotionTaskPage };
