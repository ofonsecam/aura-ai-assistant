const { Client } = require('@notionhq/client');

// Inicializamos el cliente de Notion con el Token que pusimos en Vercel
const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
    // Solo permitimos peticiones POST (enviar datos)
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Método no permitido. Usa POST.' });
    }

    try {
        // Extraemos la tarea que nos enviará el frontend
        const { taskName } = req.body;

        if (!taskName) {
            return res.status(400).json({ error: 'Falta el nombre de la tarea (taskName)' });
        }

        // Creamos la página (fila) en Notion
        const response = await notion.pages.create({
            parent: { database_id: process.env.NOTION_DATABASE_ID },
            properties: {
                // 'Name' debe coincidir EXACTAMENTE con el nombre de tu columna en Notion
                'Name': {
                    title: [
                        { text: { content: taskName } }
                    ]
                },
                // 'Estado' debe coincidir EXACTAMENTE y 'Pendiente' debe existir como opción
                'Estado': {
                    select: { name: 'Pendiente' }
                }
            }
        });

        // Respondemos con éxito
        res.status(200).json({ success: true, message: 'Tarea creada en Notion', data: response });

    } catch (error) {
        console.error("Error conectando con Notion:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}