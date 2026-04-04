const { Client } = require("@notionhq/client");

/**
 * Crea una fila (página) en la base de Notion configurada por env.
 * @param {object} taskData Objeto JSON con claves: Name (string), Area (string opcional), Fecha (string, formato YYYY-MM-DD o "" opcional).
 * @returns {Promise<import('@notionhq/client').CreatePageResponse>}
 */
async function createNotionTaskPage(taskData) {
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const databaseId = process.env.NOTION_DATABASE_ID;

    const databaseResponse = await notion.databases.retrieve({ database_id: databaseId });
    console.log('--- NOTION DATABASE SCHEMA ---');
    console.log(JSON.stringify(databaseResponse.properties, null, 2));
    console.log('------------------------------');

    // Mapear los campos requeridos según instrucciones
    const properties = {
        Name: {
            title: [
                {
                    text: {
                        content: taskData.Name || "",
                    },
                },
            ],
        },
        Estado: {
            select: { name: "Pendiente" },
        },
    };

    // // Si existe Area, agregarla con el campo acentuado exacto
    // if (typeof taskData.Area === "string" && taskData.Area.trim()) {
    //     properties["Area"] = {
    //         select: { name: taskData.Area },
    //     };
    // }

    // Si Fecha no es cadena vacía, agregarla con clave exacta "Fecha" (start: taskData.Fecha)
    if (
        typeof taskData.Fecha === "string" &&
        taskData.Fecha.trim() !== ""
    ) {
        properties["Fecha"] = {
            date: { start: taskData.Fecha },
        };
    }

    return notion.pages.create({
        parent: { database_id: databaseId },
        properties,
    });
}

module.exports = { createNotionTaskPage };
