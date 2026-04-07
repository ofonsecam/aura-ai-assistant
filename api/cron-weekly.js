const databaseId = process.env.NOTION_DATABASE_ID;
const notionToken = process.env.NOTION_TOKEN;

export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.MY_TELEGRAM_CHAT_ID;

    try {
        const queryRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
            body: JSON.stringify({ filter: { property: 'Estado', select: { equals: 'Hecho' } } })
        });
        const data = await queryRes.json();
        const totalDone = data.results?.length || 0;

        const message = `🏆 **REPORTE SEMANAL DE PRODUCTIVIDAD**\n\nOscar, esta semana completaste **${totalDone} tareas**. \n\n¡Buen trabajo manteniendo el ritmo! Mañana lunes empezamos con toda la energía. 🚀`;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Cron Weekly Error:", error);
        return res.status(500).json({ error: error.message });
    }
}