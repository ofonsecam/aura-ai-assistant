const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
    parseTensionSlashContent,
    parseTensionQuery,
    parseTensionHistoryQuery,
    parseTensionTop5Query,
    formatTensionHistoryTelegramMessage,
    formatTensionTop5TelegramMessage,
    rankTopTensionReadings,
    parseTensionMmHg,
    buildTensionNotionDatePayload,
    getTensionHistoryRange,
    buildTensionHistoryQueryBody,
    normalizeTensionQuien,
    TENSION_INVALID_FORMAT_MSG,
    TENSION_HISTORY_MISSING_QUIEN_MSG,
} = require("../lib/notionTaskPage");

const webhookPath = path.resolve(__dirname, "../api/telegram-webhook.js");
const notionPath = path.resolve(__dirname, "../lib/notionTaskPage.js");

function createMockRes() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(body) {
            this.payload = body;
            return this;
        },
        json(body) {
            this.payload = body;
            return this;
        },
    };
}

test("parseTensionSlashContent acepta Oscar/Yulis/Yulieth exactos y lectura XXX/XX", () => {
    assert.deepEqual(parseTensionSlashContent("Oscar 126/86"), {
        ok: true,
        quien: "Oscar",
        tension: "126/86",
    });
    assert.deepEqual(parseTensionSlashContent("Yulis 120/80"), {
        ok: true,
        quien: "Yulis",
        tension: "120/80",
    });
    assert.deepEqual(parseTensionSlashContent("Yulieth 118/76"), {
        ok: true,
        quien: "Yulieth",
        tension: "118/76",
    });
    assert.deepEqual(parseTensionSlashContent("  Yulis   120 / 80 "), {
        ok: true,
        quien: "Yulis",
        tension: "120/80",
    });
    assert.equal(parseTensionSlashContent("yulis 120/80").ok, false);
    assert.equal(parseTensionSlashContent("OSCAR 126/86").ok, false);
    assert.equal(parseTensionSlashContent("Pedro 120/80").ok, false);
    assert.equal(parseTensionSlashContent("Oscar 126").ok, false);
    assert.equal(parseTensionSlashContent("").ok, false);
});

test("normalizeTensionQuien solo acepta etiquetas exactas del select", () => {
    assert.equal(normalizeTensionQuien("Oscar"), "Oscar");
    assert.equal(normalizeTensionQuien("Yulis"), "Yulis");
    assert.equal(normalizeTensionQuien("Yulieth"), "Yulieth");
    assert.equal(normalizeTensionQuien("OSCAR"), null);
    assert.equal(normalizeTensionQuien("yulis"), null);
    assert.equal(normalizeTensionQuien("yulieth"), null);
    assert.equal(normalizeTensionQuien("otro"), null);
});

test("T/ registra tensión y responde confirmación", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    let capturedPayload = null;

    const realNotion = require(notionPath);
    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: {
            ...realNotion,
            createNotionTensionPage: async (payload) => {
                capturedPayload = payload;
                return { ok: true, dateYmd: "2026-08-24", quien: payload.quien, tension: payload.tension };
            },
        },
    };

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };

    const handler = require(webhookPath);
    const res = createMockRes();
    await handler(
        { method: "POST", body: { message: { chat: { id: 9 }, text: "t/ Oscar 126/86" } } },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedPayload, { quien: "Oscar", tension: "126/86" });
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.match(send.body.text, /Tensión registrada con éxito.*para Oscar: 126\/86 \(2026-08-24\)/);
});

test("T/ Yulieth registra con etiqueta exacta", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    let capturedPayload = null;

    const realNotion = require(notionPath);
    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: {
            ...realNotion,
            createNotionTensionPage: async (payload) => {
                capturedPayload = payload;
                return { ok: true, dateYmd: "2026-08-24", quien: payload.quien, tension: payload.tension };
            },
        },
    };

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };

    const handler = require(webhookPath);
    const res = createMockRes();
    await handler(
        { method: "POST", body: { message: { chat: { id: 9 }, text: "T/ Yulieth 118/76" } } },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedPayload, { quien: "Yulieth", tension: "118/76" });
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.match(send.body.text, /para Yulieth: 118\/76/);
});

test("T/ con formato inválido no llama a Notion", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    let created = false;

    const realNotion = require("../lib/notionTaskPage");
    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: {
            ...realNotion,
            createNotionTensionPage: async () => {
                created = true;
                return { ok: true };
            },
        },
    };

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };

    const handler = require(webhookPath);
    const res = createMockRes();
    await handler(
        { method: "POST", body: { message: { chat: { id: 9 }, text: "T/ Oscar" } } },
        res
    );

    assert.equal(created, false);
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.equal(send.body.text, TENSION_INVALID_FORMAT_MSG);
});

test("/help incluye el comando de tensión", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    const realNotion = require(notionPath);

    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: realNotion,
    };

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };

    const handler = require(webhookPath);
    const res = createMockRes();
    await handler(
        { method: "POST", body: { message: { chat: { id: 9 }, text: "/help" } } },
        res
    );

    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.match(send.body.text, /Tensión/);
    assert.match(send.body.text, /T\/ Oscar\|Yulis\|Yulieth/);
    assert.match(send.body.text, /his tension/i);
    assert.match(send.body.text, /top5 tension/i);
    assert.match(send.body.text, /Aura AI v2\.9\.3\.3\.8/);
    assert.equal(send.body.parse_mode, undefined);
});

test("buildTensionNotionDatePayload usa reloj de pared America/Bogota y offset -05:00", () => {
    const instant = new Date("2026-09-14T21:10:05.000Z");
    const payload = buildTensionNotionDatePayload(instant);
    assert.equal(payload.dateYmd, "2026-09-14");
    assert.equal(payload.title, "2026-09-14 16:10");
    assert.equal(payload.iso, "2026-09-14T16:10:05-05:00");
});

test("getTensionHistoryRange resta 21 días continuos en Bogotá", () => {
    const instant = new Date("2026-09-14T21:10:05.000Z");
    const range = getTensionHistoryRange(instant);
    assert.equal(range.toIso, "2026-09-14T16:10:05-05:00");
    assert.equal(range.fromIso, "2026-08-24T16:10:05-05:00");
    assert.equal(range.fromYmd, "2026-08-24");
    assert.equal(range.toYmd, "2026-09-14");
});

test("buildTensionHistoryQueryBody filtra Quien + Fecha y ordena descendente", () => {
    const body = buildTensionHistoryQueryBody("Yulis", "2026-08-24T16:10:05-05:00");
    assert.deepEqual(body, {
        filter: {
            and: [
                { property: "Quien", select: { equals: "Yulis" } },
                { property: "Fecha", date: { on_or_after: "2026-08-24T16:10:05-05:00" } },
            ],
        },
        sorts: [{ property: "Fecha", direction: "descending" }],
    });
});

test("parseTensionHistoryQuery detecta persona y no intercepta T/", () => {
    assert.deepEqual(parseTensionHistoryQuery("tensión de Yulis últimas 3 semanas"), {
        ok: true,
        quien: "Yulis",
    });
    assert.deepEqual(parseTensionHistoryQuery("historial tension Oscar"), {
        ok: true,
        quien: "Oscar",
    });
    assert.deepEqual(parseTensionHistoryQuery("his tension Oscar"), {
        ok: true,
        quien: "Oscar",
    });
    assert.deepEqual(parseTensionHistoryQuery("hist tension yulis"), {
        ok: true,
        quien: "Yulis",
    });
    assert.deepEqual(parseTensionHistoryQuery("Historial de tensión de yulieth"), {
        ok: true,
        quien: "Yulieth",
    });
    assert.equal(parseTensionHistoryQuery("T/ Oscar 126/86").ok, false);
    assert.equal(parseTensionHistoryQuery("Oscar 126/86").ok, false);
    assert.equal(parseTensionHistoryQuery("ver tareas de hoy").ok, false);
    assert.equal(parseTensionHistoryQuery("top5 tension Oscar").ok, false);
    assert.deepEqual(parseTensionHistoryQuery("historial de tensión últimas 3 semanas"), {
        ok: false,
        missingQuien: true,
    });
    assert.deepEqual(parseTensionHistoryQuery("his tension"), {
        ok: false,
        missingQuien: true,
    });
});

test("parseTensionQuery enruta historial y top5 con regex híbrida", () => {
    assert.deepEqual(parseTensionQuery("his tension Oscar"), {
        ok: true,
        intent: "history",
        quien: "Oscar",
    });
    assert.deepEqual(parseTensionQuery("hist tension Yulis"), {
        ok: true,
        intent: "history",
        quien: "Yulis",
    });
    assert.deepEqual(parseTensionQuery("top5 tension Oscar"), {
        ok: true,
        intent: "top5",
        quien: "Oscar",
    });
    assert.deepEqual(parseTensionQuery("top 5 tension de yulis"), {
        ok: true,
        intent: "top5",
        quien: "Yulis",
    });
    assert.deepEqual(parseTensionTop5Query("top 5 tensión Yulieth"), {
        ok: true,
        quien: "Yulieth",
    });
    assert.equal(parseTensionTop5Query("his tension Oscar").ok, false);
    assert.deepEqual(parseTensionQuery("top 5 tension"), {
        ok: false,
        missingQuien: true,
        intent: "top5",
    });
});

test("rankTopTensionReadings ordena por sistólica y descarta corruptos", () => {
    assert.deepEqual(parseTensionMmHg("138/78"), { sis: 138, dia: 78 });
    assert.equal(parseTensionMmHg(""), null);
    assert.equal(parseTensionMmHg("n/a"), null);

    const ranked = rankTopTensionReadings(
        [
            { tension: "120/80", display: "12/09/2026 18:00" },
            { tension: "138/78", display: "14/09/2026 07:15" },
            { tension: "126/86", display: "14/09/2026 16:10" },
            { tension: "", display: "bad" },
            { tension: "118/82", display: "13/09/2026 18:57" },
            { tension: "116/80", display: "13/09/2026 18:18" },
            { tension: "126/90", display: "11/09/2026 09:00" },
            { tension: "110/70", display: "10/09/2026 08:00" },
        ],
        5
    );
    assert.equal(ranked.length, 5);
    assert.deepEqual(
        ranked.map((r) => r.tension),
        ["138/78", "126/90", "126/86", "120/80", "118/82"]
    );
});

test("formatTensionTop5TelegramMessage lista ranking", () => {
    const empty = formatTensionTop5TelegramMessage({ quien: "Oscar", readings: [] });
    assert.match(empty, /No hay tomas válidas de tensión de Oscar/);

    const ranked = formatTensionTop5TelegramMessage({
        quien: "Oscar",
        readings: [
            { tension: "138/78", display: "14/09/2026 07:15" },
            { tension: "126/86", display: "14/09/2026 16:10" },
            { tension: "120/80", display: "12/09/2026 18:00" },
            { tension: "118/82", display: "13/09/2026 18:57" },
            { tension: "116/80", display: "13/09/2026 18:18" },
        ],
    });
    assert.match(ranked, /Top 5 Tensiones más altas — Oscar/);
    assert.match(ranked, /1️⃣ 🩸 138\/78 mmHg \| 📅 14\/09\/2026 07:15/);
    assert.match(ranked, /5️⃣ 🩸 116\/80 mmHg \| 📅 13\/09\/2026 18:18/);
});

test("formatTensionHistoryTelegramMessage lista tomas y promedio", () => {
    const empty = formatTensionHistoryTelegramMessage({
        quien: "Yulis",
        fromYmd: "2026-08-24",
        toYmd: "2026-09-14",
        readings: [],
    });
    assert.match(empty, /No hay tomas de tensión de Yulis/);
    assert.match(empty, /21 días/);

    const withRows = formatTensionHistoryTelegramMessage({
        quien: "Oscar",
        fromYmd: "2026-08-24",
        toYmd: "2026-09-14",
        readings: [
            { display: "14/09/2026 16:10", tension: "126/86" },
            { display: "10/09/2026 08:05", tension: "118/76" },
        ],
    });
    assert.match(withRows, /Tensión de Oscar/);
    assert.match(withRows, /24\/08\/2026 → 14\/09\/2026/);
    assert.match(withRows, /📅 14\/09\/2026 16:10 \| 🩸 126\/86 mmHg/);
    assert.match(withRows, /📅 10\/09\/2026 08:05 \| 🩸 118\/76 mmHg/);
    assert.match(withRows, /📊 Promedio: 122\/81 mmHg \(2 tomas\)/);
});

test("consulta de historial responde listado de 21 días", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    let capturedQuien = null;

    const realNotion = require(notionPath);
    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: {
            ...realNotion,
            queryNotionTensionLast21Days: async (quien) => {
                capturedQuien = quien;
                return {
                    ok: true,
                    quien,
                    fromYmd: "2026-08-24",
                    toYmd: "2026-09-14",
                    readings: [
                        { display: "14/09/2026 16:10", tension: "120/80" },
                        { display: "01/09/2026 07:00", tension: "118/76" },
                    ],
                };
            },
        },
    };

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };

    const handler = require(webhookPath);
    const res = createMockRes();
    await handler(
        { method: "POST", body: { message: { chat: { id: 9 }, text: "tensión de Yulis últimas 3 semanas" } } },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(capturedQuien, "Yulis");
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.match(send.body.text, /Tensión de Yulis/);
    assert.match(send.body.text, /🩸 120\/80 mmHg/);
    assert.match(send.body.text, /Promedio: 119\/78 mmHg/);
});

test("consulta de historial sin persona pide etiqueta Quien", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    let queried = false;

    const realNotion = require(notionPath);
    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: {
            ...realNotion,
            queryNotionTensionLast21Days: async () => {
                queried = true;
                return { ok: true, readings: [] };
            },
        },
    };

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };

    const handler = require(webhookPath);
    const res = createMockRes();
    await handler(
        { method: "POST", body: { message: { chat: { id: 9 }, text: "historial de tensión últimas 3 semanas" } } },
        res
    );

    assert.equal(queried, false);
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.equal(send.body.text, TENSION_HISTORY_MISSING_QUIEN_MSG);
});

test("his tension dispara historial de 21 días", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    let capturedQuien = null;

    const realNotion = require(notionPath);
    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: {
            ...realNotion,
            queryNotionTensionLast21Days: async (quien) => {
                capturedQuien = quien;
                return {
                    ok: true,
                    quien,
                    fromYmd: "2026-08-24",
                    toYmd: "2026-09-14",
                    readings: [{ display: "14/09/2026 16:10", tension: "120/80" }],
                };
            },
        },
    };

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };

    const handler = require(webhookPath);
    const res = createMockRes();
    await handler(
        { method: "POST", body: { message: { chat: { id: 9 }, text: "his tension Oscar" } } },
        res
    );

    assert.equal(capturedQuien, "Oscar");
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.match(send.body.text, /Tensión de Oscar/);
    assert.match(send.body.text, /🩸 120\/80 mmHg/);
});

test("top5 tension responde ranking en Telegram", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    let capturedQuien = null;
    let historyCalled = false;

    const realNotion = require(notionPath);
    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: {
            ...realNotion,
            queryNotionTensionLast21Days: async () => {
                historyCalled = true;
                return { ok: true, readings: [] };
            },
            queryNotionTensionTop5: async (quien) => {
                capturedQuien = quien;
                return {
                    ok: true,
                    quien,
                    readings: [
                        { tension: "138/78", display: "14/09/2026 07:15" },
                        { tension: "126/86", display: "14/09/2026 16:10" },
                    ],
                };
            },
        },
    };

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };

    const handler = require(webhookPath);
    const res = createMockRes();
    await handler(
        { method: "POST", body: { message: { chat: { id: 9 }, text: "top 5 tension de Yulis" } } },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(historyCalled, false);
    assert.equal(capturedQuien, "Yulis");
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.match(send.body.text, /Top 5 Tensiones más altas — Yulis/);
    assert.match(send.body.text, /1️⃣ 🩸 138\/78 mmHg/);
});
