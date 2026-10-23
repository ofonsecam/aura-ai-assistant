const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const cronPath = path.resolve(__dirname, "../api/cron-detalle.js");
const geminiPath = path.resolve(__dirname, "../lib/geminiService.js");

function createMockRes() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.payload = body;
            return this;
        },
    };
}

function loadCron(generarIdeaDetalle) {
    delete require.cache[cronPath];
    delete require.cache[geminiPath];
    require.cache[geminiPath] = {
        id: geminiPath,
        filename: geminiPath,
        loaded: true,
        exports: { generarIdeaDetalle },
    };
    return require(cronPath);
}

test("cron-detalle rechaza si falta o no coincide CRON_SECRET", async () => {
    const previousSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const handler = loadCron(async () => "no debería llamarse");
    try {
        const res = createMockRes();
        await handler({ headers: {} }, res);
        assert.equal(res.statusCode, 500);
        assert.match(res.payload.error, /CRON_SECRET/);

        process.env.CRON_SECRET = "secreto";
        const unauthorized = createMockRes();
        await handler({ headers: { authorization: "Bearer otro" } }, unauthorized);
        assert.equal(unauthorized.statusCode, 401);
    } finally {
        if (previousSecret == null) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previousSecret;
    }
});

test("cron-detalle genera idea automática y la envía a TELEGRAM_CHAT_ID", async () => {
    const previous = {
        CRON_SECRET: process.env.CRON_SECRET,
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
        MY_TELEGRAM_CHAT_ID: process.env.MY_TELEGRAM_CHAT_ID,
    };
    process.env.CRON_SECRET = "secreto";
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
    delete process.env.MY_TELEGRAM_CHAT_ID;

    const detalleCalls = [];
    const sent = [];
    global.fetch = async (url, options = {}) => {
        sent.push({ url, body: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadCron(async (esAutomatico) => {
        detalleCalls.push(esAutomatico);
        return "Hazle un masaje de 5 minutos.";
    });

    try {
        const res = createMockRes();
        await handler({ headers: { authorization: "Bearer secreto" } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(detalleCalls, [true]);
        assert.equal(sent.length, 1);
        assert.match(sent[0].url, /botbot-token\/sendMessage/);
        assert.equal(sent[0].body.chat_id, "12345");
        assert.equal(sent[0].body.text, "Hazle un masaje de 5 minutos.");
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value == null) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
