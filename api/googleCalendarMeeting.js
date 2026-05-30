const { google } = require("googleapis");

const BOGOTA_TZ = "America/Bogota";

function pad2(n) {
    return String(n).padStart(2, "0");
}

/**
 * Escucha el prefijo meeting/ y extrae MM DD YYYY HH:MM [DURACION] TITULO.
 * @returns {null | { ok: true, month: number, day: number, year: number, hour: number, minute: number, durationHours: number, title: string } | { ok: false, error: string }}
 */
function parseMeetingSlashMessage(text) {
    if (!text || text.startsWith("/") || !text.includes("/")) return null;
    if (/^https?:\/\//i.test(text)) return null;

    const slashIdx = text.indexOf("/");
    const prefix = text.slice(0, slashIdx).trim().toLowerCase();
    if (prefix !== "meeting") return null;

    const content = text.slice(slashIdx + 1).trim();
    if (!content) {
        return {
            ok: false,
            error:
                "⚠️ Falta el contenido del comando. Usa: `meeting/ MM DD YYYY HH:MM [DURACION] TITULO` — ej. `meeting/ 05 30 2026 14:30 1.5 Entrevista con Handoff`.",
        };
    }

    const tokens = content.split(/\s+/);
    if (tokens.length < 5) {
        return {
            ok: false,
            error:
                "⚠️ Faltan datos. Necesitas al menos mes, día, año, hora y título. Formato: `meeting/ MM DD YYYY HH:MM [DURACION] TITULO`.",
        };
    }

    const mmStr = tokens[0];
    if (!/^\d{1,2}$/.test(mmStr)) {
        return {
            ok: false,
            error: "❌ El mes (MM) debe ser un número de 1 o 2 dígitos, ej. `05`. Revisa el primer valor después de `meeting/`.",
        };
    }
    const month = Number(mmStr);
    if (month < 1 || month > 12) {
        return {
            ok: false,
            error: "❌ El mes (MM) debe estar entre 01 y 12. El valor que enviaste no es válido.",
        };
    }

    const ddStr = tokens[1];
    if (!/^\d{1,2}$/.test(ddStr)) {
        return {
            ok: false,
            error: "❌ El día (DD) debe ser un número de 1 o 2 dígitos, ej. `30`. Revisa el segundo valor del comando.",
        };
    }
    const day = Number(ddStr);
    if (day < 1 || day > 31) {
        return {
            ok: false,
            error: "❌ El día (DD) debe estar entre 01 y 31. El valor que enviaste no es válido.",
        };
    }

    const yyyyStr = tokens[2];
    if (!/^\d{4}$/.test(yyyyStr)) {
        return {
            ok: false,
            error: "❌ El año (YYYY) debe tener exactamente 4 dígitos, ej. `2026`. Revisa el tercer valor del comando.",
        };
    }
    const year = Number(yyyyStr);

    const dateCheck = new Date(Date.UTC(year, month - 1, day));
    if (
        dateCheck.getUTCFullYear() !== year ||
        dateCheck.getUTCMonth() !== month - 1 ||
        dateCheck.getUTCDate() !== day
    ) {
        return {
            ok: false,
            error: `❌ La fecha ${pad2(month)} ${pad2(day)} ${year} (MM DD YYYY) no existe en el calendario. Revísala e inténtalo de nuevo.`,
        };
    }

    const timeStr = tokens[3];
    if (!/^\d{2}:\d{2}$/.test(timeStr)) {
        return {
            ok: false,
            error: "❌ La hora (HH:MM) debe usar formato 24 horas con dos dígitos, ej. `14:30`. Revisa el cuarto valor del comando.",
        };
    }
    const [hhStr, minStr] = timeStr.split(":");
    const hour = Number(hhStr);
    const minute = Number(minStr);
    if (hour < 0 || hour > 23) {
        return {
            ok: false,
            error: "❌ La hora (HH) debe estar entre 00 y 23 en formato 24 horas. El valor que enviaste no es válido.",
        };
    }
    if (minute < 0 || minute > 59) {
        return {
            ok: false,
            error: "❌ Los minutos (MM de HH:MM) deben estar entre 00 y 59. Revisa la hora del comando.",
        };
    }

    let tokenIdx = 4;
    let durationHours = 0.5;
    if (tokens.length > 4 && /^\d+(?:\.\d+)?$/.test(tokens[4])) {
        durationHours = Number(tokens[4]);
        if (!Number.isFinite(durationHours) || durationHours <= 0) {
            return {
                ok: false,
                error: "❌ La duración debe ser un número decimal positivo en horas (ej. `0.5`, `1`, `1.5`). El valor que enviaste no es válido.",
            };
        }
        tokenIdx = 5;
    }

    const title = tokens.slice(tokenIdx).join(" ").trim();
    if (!title) {
        return {
            ok: false,
            error: "❌ Falta el TITULO del evento. Todo el texto después de la duración (o de la hora, si omites duración) se usa como título.",
        };
    }

    return {
        ok: true,
        month,
        day,
        year,
        hour,
        minute,
        durationHours,
        title,
    };
}

function computeEndDateTime({ year, month, day, hour, minute, durationHours }) {
    const durationMinutes = Math.round(durationHours * 60);
    const startTotalMinutes = hour * 60 + minute;
    const endTotalMinutes = startTotalMinutes + durationMinutes;
    const dayOffset = Math.floor(endTotalMinutes / (24 * 60));
    const remainderMinutes = endTotalMinutes % (24 * 60);
    const endHour = Math.floor(remainderMinutes / 60);
    const endMinute = remainderMinutes % 60;

    const endDate = new Date(Date.UTC(year, month - 1, day));
    endDate.setUTCDate(endDate.getUTCDate() + dayOffset);

    return {
        year: endDate.getUTCFullYear(),
        month: endDate.getUTCMonth() + 1,
        day: endDate.getUTCDate(),
        hour: endHour,
        minute: endMinute,
    };
}

function buildGoogleDateTime({ year, month, day, hour, minute }) {
    return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00`;
}

function getGoogleCalendarClient() {
    const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    // Validación estricta antes de proceder
    if (!jsonEnv || !calendarId) {
        throw new Error(`Error fatal: Variables de entorno faltantes. JSON_PROVISTO: ${!!jsonEnv}, CALENDAR_ID_PROVISTO: ${!!calendarId}`);
    }

    const credentials = JSON.parse(jsonEnv);

    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
        },
        scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const calendar = google.calendar({ version: 'v3', auth: auth });

    return {
        ok: true,
        calendarId,
        calendar,
    };
}

/**
 * Crea un evento en Google Calendar (zona horaria America/Bogota).
 * @param {{ month: number, day: number, year: number, hour: number, minute: number, durationHours: number, title: string }} meeting
 */
async function createGoogleCalendarMeetingEvent(meeting) {
    const clientResult = getGoogleCalendarClient();
    if (!clientResult.ok) {
        return clientResult;
    }

    const start = {
        year: meeting.year,
        month: meeting.month,
        day: meeting.day,
        hour: meeting.hour,
        minute: meeting.minute,
    };
    const end = computeEndDateTime({
        ...start,
        durationHours: meeting.durationHours,
    });

    try {
        const eventData = {
            summary: meeting.title,
            start: {
                dateTime: buildGoogleDateTime(start),
                timeZone: BOGOTA_TZ,
            },
            end: {
                dateTime: buildGoogleDateTime(end),
                timeZone: BOGOTA_TZ,
            },
        };

        const response = await clientResult.calendar.events.insert({
            calendarId: 'fonsecaoscarestudios@gmail.com',
            requestBody: eventData,
        });

        return {
            ok: true,
            eventId: response.data.id,
            htmlLink: response.data.htmlLink || "",
            startDateTime: buildGoogleDateTime(start),
            endDateTime: buildGoogleDateTime(end),
        };
    } catch (error) {
        throw new Error("NUEVO ERROR API: " + error.message);
    }
}

function formatDurationLabel(durationHours) {
    const totalMinutes = Math.round(durationHours * 60);
    if (totalMinutes % 60 === 0) {
        return `${totalMinutes / 60} h`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins} min`;
    return `${hours} h ${mins} min`;
}

/**
 * @param {(token: string, chatId: string|number, text: string, replyMarkup?: *, parseMode?: string) => Promise<void>} sendMessage
 * @returns {Promise<boolean>} true si el mensaje era meeting/ (procesado o error de formato).
 */
async function tryHandleMeetingSlashCommand(token, chatId, text, sendMessage) {
    const parsed = parseMeetingSlashMessage(text);
    if (parsed === null) return false;

    if (!parsed.ok) {
        await sendMessage(token, chatId, parsed.error);
        return true;
    }

    const created = await createGoogleCalendarMeetingEvent(parsed);
    if (!created.ok) {
        await sendMessage(token, chatId, created.error);
        return true;
    }

    const dateLabel = `${pad2(parsed.month)}/${pad2(parsed.day)}/${parsed.year}`;
    const timeLabel = `${pad2(parsed.hour)}:${pad2(parsed.minute)}`;
    const durationLabel = formatDurationLabel(parsed.durationHours);
    let msg =
        `✅ Reunión agendada en Google Calendar mi rey!\n` +
        `📅 *${parsed.title}*\n` +
        `🕐 ${dateLabel} ${timeLabel} (Bogotá) · ${durationLabel}`;
    if (created.htmlLink) {
        msg += `\n🔗 ${created.htmlLink}`;
    }
    await sendMessage(token, chatId, msg);
    return true;
}

module.exports = {
    BOGOTA_TZ,
    parseMeetingSlashMessage,
    createGoogleCalendarMeetingEvent,
    tryHandleMeetingSlashCommand,
};
