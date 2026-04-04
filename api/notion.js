const { createNotionTaskPage } = require("./notionTaskPage");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ message: "Método no permitido. Usa POST." });
    }

    try {
        const { taskName } = req.body;

        if (!taskName) {
            return res.status(400).json({ error: "Falta el nombre de la tarea (taskName)" });
        }

        const response = await createNotionTaskPage(taskName);

        res.status(200).json({ success: true, message: "Tarea creada en Notion", data: response });
    } catch (error) {
        console.error("Error conectando con Notion:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
