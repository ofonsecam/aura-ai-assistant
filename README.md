# Aura AI - Asistente Personal de Productividad

Aura AI conecta Telegram, Notion y modelos de IA para capturar tareas por voz o texto, organizarlas y recordarte lo pendiente.

## Description

Ecosistema de automatización proactiva con Telegram Bot API y Notion API sobre Node.js / Vercel Serverless. Enruta comandos deterministas (fuzzy search / Levenshtein) y delega lenguaje natural a Gemini, con crons para resúmenes, hábitos, aseo y reportes semanales.

## Features

- **Hybrid Routing** — Comandos slash, prefijos (`Área/`, `T/`, `meeting/`) y flujos de voz/texto vía Telegram.
- **Fuzzy Search** — Búsqueda tolerante al marcar o filtrar tareas.
- **Overdue Alerts** — Avisos de vencidas en los resúmenes programados.
- **Cron Jobs** — Recordatorios y reportes en Vercel (autenticados con `CRON_SECRET`).

## Entrypoints activos (`api/`)

| Ruta | Disparador |
|------|------------|
| `/api/telegram-webhook` | Webhook de Telegram |
| `/api/cron-summary` | Cron (4× día) |
| `/api/cron-daily-close` | Cron (cierre diario) |
| `/api/cron-weekly` | Cron (semanal) |
| `/api/cron-habitos` | Cron (3× día) |
| `/api/cron-aseo` | Cron (lun–vie, 2×) |
| `/api/cron-detalle` | Cron (jueves) |

Endpoints legacy eliminados: `api/notion.js`, `api/process-voice.js`, `api/cron-weekly-summary.js`.

## Comandos manuales

| Comando | Uso |
|--------|-----|
| `/help` | Manual de comandos. |
| `/ld` `/lm` `/lv` | Tareas de hoy, mañana o vencidas. |
| `/h` | Hábitos pendientes del día. |
| `/aseo` | Limpieza del día. |
| `/movilidad` | Rutina de movilidad activa. |
| `/syncminutas` | Tareas desde minutas listas en Notion. |
| `/gasto` | Registrar gasto fiscal. |
| `/detalle` | Idea de detalle para Yulian. |
| `T/` | Registrar tensión (`T/ Oscar 126/86`). |
| Salto de cuerda | Lenguaje natural → `DB_Workout_Tracker`. |

## Variables de entorno

Configura estas variables en Vercel (o `.env.local` con `vercel dev`). Referencia completa: `.env.example`.

| Variable | Descripción |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token del bot (`BotFather`). |
| `MY_TELEGRAM_CHAT_ID` | Chat destino de crons / alertas. |
| `CRON_SECRET` | Secreto Bearer que Vercel envía a los crons. |
| `NOTION_TOKEN` | Token de la integración Notion. |
| `NOTION_DATABASE_ID` | Base de tareas. |
| `NOTION_MINUTAS_ID` | Base de minutas para `/syncminutas`. |
| `GEMINI_API_KEY` | Google AI (Gemini). |
| `NOTION_DB_TENSION_ID` | Base `DB_Tension`. |
| `NOTION_WORKOUT_DB_ID` | Base `DB_Workout_Tracker`. |

## Cron schedules (UTC → Bogotá UTC−5)

Definidos en `vercel.json`. Todos requieren `Authorization: Bearer <CRON_SECRET>`.

| Path | Schedule UTC | Bogotá (aprox.) |
|------|--------------|-----------------|
| `/api/cron-summary` | `20 12`, `30 15`, `30 18`, `30 21` | 07:20, 10:30, 13:30, 16:30 |
| `/api/cron-daily-close` | `30 0 * * *` | 19:30 |
| `/api/cron-weekly` | `0 0 * * 1` | domingo 19:00 |
| `/api/cron-habitos` | `50 10`, `0 19`, `0 0` | 05:50, 14:00, 19:00 |
| `/api/cron-aseo` | `30 15`, `30 20` (lun–vie) | 10:30, 15:30 |
| `/api/cron-detalle` | `0 21 * * 4` | jueves 16:00 |

---

© Aura Planner — documentación del repositorio Oscar Fonseca
