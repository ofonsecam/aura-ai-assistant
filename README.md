# Aura AI - Asistente Personal de Productividad

Aura AI conecta Telegram, Notion y modelos de IA para capturar tareas por voz o texto, organizarlas y recordarte lo pendiente.

## Features

- **Hybrid Routing** — Enrutamiento flexible entre comandos, notas de voz y flujos automáticos.
- **Fuzzy Search** — Búsqueda tolerante a variaciones al consultar o filtrar tareas.
- **Overdue Alerts** — Avisos cuando hay tareas vencidas o próximas a vencer.
- **Cron Jobs** — Tareas programadas en Vercel para resúmenes y recordatorios recurrentes.

## Comandos manuales

| Comando | Uso |
|--------|-----|
| `/lista` | Lista o consulta de tareas según la lógica del bot. |
| `/help` | Ayuda y descripción de comandos. |
| `+` | Añadir o registrar una tarea (según el contexto del mensaje). |
| `hecho` | Marcar tarea(s) como completadas. |
| `borrar` | Eliminar tarea(s) indicadas. |

## Variables de entorno

Configura estas variables en Vercel (o en un archivo `.env` local con `vercel dev`):

| Variable | Descripción |
|----------|-------------|
| `NOTION_TOKEN` | Token de integración de Notion (Internal Integration). |
| `NOTION_DATABASE_ID` | ID de la base de datos donde se crean y consultan las tareas. |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram (`BotFather`). |
| `MY_TELEGRAM_CHAT_ID` | Chat ID al que el bot envía resúmenes y alertas (crons). |
| `GEMINI_API_KEY` | Clave de la API de Google AI (Gemini) para transcripción y extracción estructurada desde audio. |

> **Nota:** Si añades otras integraciones (p. ej. webhooks adicionales), documenta aquí cualquier variable extra que uses.

## Cron schedules (COT)

Los resúmenes y alertas por cron están pensados para ejecutarse **tres veces al día** en horario **Colombia (COT, UTC−5)**:

- **7:30 AM** — Inicio de jornada.
- **12:30 PM** — Mediodía.
- **4:30 PM** — Final de la tarde.

En `vercel.json`, las expresiones cron usan **UTC**; las horas anteriores en COT corresponden a los `schedule` definidos para `/api/cron-summary` (ajusta si cambias de zona o de horario).

Además existe un job semanal en `/api/cron-weekly` (por ejemplo resumen semanal); revisa `vercel.json` para la expresión exacta.

---

© Aura Planner — documentación del repositorio Oscar Fonseca
