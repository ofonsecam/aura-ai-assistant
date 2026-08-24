const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
    parseTensionSlashContent,
    normalizeTensionQuien,
    TENSION_INVALID_FORMAT_MSG,
} = require("../api/notionTaskPage");

const webhookPath = path.resolve(__dirname, "../api/telegram-webhook.js");
const notionPath = path.resolve(__dirname, "../api/notionTaskPage.js");

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

test("parseTensionSlashContent acepta Oscar/Yulis y lectura XXX/XX", () => {
    assert.deepEqual(parseTensionSlashContent("Oscar 126/86"), {
        ok: true,
        quien: "Oscar",
        tension: "126/86",
    });
    assert.deepEqual(parseTensionSlashContent("  yulis   120 / 80 "), {
        ok: true,
        quien: "Yulis",
        tension: "120/80",
    });
    assert.equal(parseTensionSlashContent("Pedro 120/80").ok, false);
    assert.equal(parseTensionSlashContent("Oscar 126").ok, false);
    assert.equal(parseTensionSlashContent("").ok, false);
});

test("normalizeTensionQuien mapea al select de Notion", () => {
    assert.equal(normalizeTensionQuien("OSCAR"), "Oscar");
    assert.equal(normalizeTensionQuien("Yulis"), "Yulis");
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
        { method: "POST", body: { message: { chat: { id: 9 }, text: "t/ oscar 126/86" } } },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedPayload, { quien: "Oscar", tension: "126/86" });
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.match(send.body.text, /Tensión registrada con éxito para Oscar: 126\/86 \(2026-08-24\)/);
});

test("T/ con formato inválido no llama a Notion", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];
    let created = false;

    const realNotion = require("../api/notionTaskPage");
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
    assert.match(send.body.text, /T\/ Oscar\|Yulis/);
    assert.equal(send.body.parse_mode, undefined);
});
