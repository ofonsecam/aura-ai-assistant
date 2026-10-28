const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const notionServicePath = path.resolve(__dirname, "../lib/notionService.js");
const workoutTrackerPath = path.resolve(__dirname, "../lib/workoutTracker.js");
const webhookPath = path.resolve(__dirname, "../api/telegram-webhook.js");
const notionClientPath = require.resolve("@notionhq/client");

const DB_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function mockModule(modulePath, exports) {
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
}

function loadNotionService(calls) {
    class FakeClient {
        constructor() {
            this.pages = {
                create: async (args) => {
                    calls.create = args;
                    return { id: "workout-1", url: "https://notion.so/workout-1" };
                },
            };
        }
    }
    mockModule(notionClientPath, { Client: FakeClient });
    delete require.cache[notionServicePath];
    delete require.cache[workoutTrackerPath];
    process.env.NOTION_TOKEN = "secret";
    process.env.NOTION_WORKOUT_DB_ID = DB_ID;
    return require(notionServicePath);
}

function bogotaToday() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
}

test("logWorkoutSession normaliza abreviaturas y usa el esquema exacto", async () => {
    const calls = {};
    const { logWorkoutSession } = loadNotionService(calls);
    const saved = await logWorkoutSession({
        semanaSesion: "s1d1",
        protocolo: "30/30",
        completado: true,
        molestiaArticular: "todo bien sin dolor",
        notas: "",
        fecha: "",
    });

    assert.equal(saved.semanaSesion, "S1-D1");
    assert.equal(saved.protocolo, "30s/30s");
    assert.equal(saved.molestiaArticular, "0 - Impecable");
    assert.equal(saved.notas, "Sesión completada");
    assert.equal(saved.fecha, bogotaToday());
    assert.equal(saved.completado, true);
    assert.deepEqual(calls.create.parent, { database_id: process.env.NOTION_WORKOUT_DB_ID });

    const props = calls.create.properties;
    assert.deepEqual(Object.keys(props).sort(), [
        "Completado",
        "Fecha",
        "Molestia articular",
        "Notas rapidas",
        "Protocolo",
        "Semana / Sesión",
    ]);
    assert.deepEqual(props["Notas rapidas"], { title: [{ text: { content: "Sesión completada" } }] });
    assert.deepEqual(props.Fecha, { date: { start: bogotaToday() } });
    assert.deepEqual(props["Semana / Sesión"], { select: { name: "S1-D1" } });
    assert.deepEqual(props.Protocolo, { select: { name: "30s/30s" } });
    assert.deepEqual(props.Completado, { checkbox: true });
    assert.deepEqual(props["Molestia articular"], { select: { name: "0 - Impecable" } });
});

test("logWorkoutSession mapea fatiga, tendón y deja el checkbox en false", async () => {
    const calls = {};
    const { logWorkoutSession } = loadNotionService(calls);

    const fatiga = await logWorkoutSession({
        semanaSesion: "S2-D1",
        protocolo: "35s/25s",
        completado: "sí",
        molestiaArticular: "sentí algo de fatiga en gemelos",
        notas: "Fatiga en gemelos",
        fecha: "2026-10-27T21:00:00-05:00",
    });
    assert.equal(fatiga.semanaSesion, "S2-D1");
    assert.equal(fatiga.protocolo, "35s/25s");
    assert.equal(fatiga.molestiaArticular, "1 - Fatiga muscular");
    assert.equal(fatiga.fecha, "2026-10-27");
    assert.equal(calls.create.properties.Completado.checkbox, true);

    const tendon = await logWorkoutSession({
        semanaSesion: "s3d1",
        protocolo: "40/20",
        completado: false,
        molestiaArticular: "dolor de espinilla",
        notas: "Dolor de espinilla",
    });
    assert.equal(tendon.semanaSesion, "S3-D1");
    assert.equal(tendon.protocolo, "40s/20s");
    assert.equal(tendon.molestiaArticular, "2 - Alerta tendón/periostio");
    assert.equal(tendon.completado, false);
    assert.deepEqual(calls.create.properties.Completado, { checkbox: false });
    assert.deepEqual(calls.create.properties["Molestia articular"], {
        select: { name: "2 - Alerta tendón/periostio" },
    });
});

test("parseWorkoutMessage entiende los ejemplos de cuerda", () => {
    delete require.cache[workoutTrackerPath];
    const { parseWorkoutMessage, buildWorkoutTelegramReply, WORKOUT_TENDON_WARNING } = require(workoutTrackerPath);

    const impecable = parseWorkoutMessage("Aura, completé salto s1d1, 30/30, todo bien sin dolor");
    assert.equal(impecable.semanaSesion.replace(/\s/g, "").toLowerCase(), "s1d1");
    assert.match(impecable.protocolo, /30\s*\/\s*30/);
    assert.equal(impecable.molestiaArticular, "0 - Impecable");
    assert.equal(impecable.completado, true);
    assert.match(impecable.notas, /todo bien sin dolor/);

    const fatiga = parseWorkoutMessage("Hoy hice cuerda s2d1 35/25, sentí algo de fatiga en gemelos");
    assert.match(fatiga.semanaSesion.toLowerCase(), /s2d1/);
    assert.match(fatiga.protocolo, /35\s*\/\s*25/);
    assert.equal(fatiga.molestiaArticular, "1 - Fatiga muscular");
    assert.match(fatiga.notas, /fatiga en gemelos/);

    const reply = buildWorkoutTelegramReply({
        fecha: "2026-10-27",
        semanaSesion: "S1-D1",
        protocolo: "30s/30s",
        completado: true,
        molestiaArticular: "2 - Alerta tendón/periostio",
        notas: "Dolor de tendón",
    });
    assert.match(reply, /caminadora inclinada/);
    assert.match(reply, /descanso activo/);
    assert.match(reply, /tendón de Aquiles/);
    assert.ok(reply.includes(WORKOUT_TENDON_WARNING));

    const sinAlerta = buildWorkoutTelegramReply({
        fecha: "2026-10-27",
        semanaSesion: "S1-D1",
        protocolo: "30s/30s",
        completado: true,
        molestiaArticular: "0 - Impecable",
        notas: "Sesión completada",
    });
    assert.doesNotMatch(sinAlerta, /tendón de Aquiles/);
    assert.equal(parseWorkoutMessage("comprar cuerda para el tende"), null);
});

test("el prompt de Gemini declara el intent WORKOUT y la herramienta logWorkoutSession", () => {
    delete require.cache[webhookPath];
    const { buildSystemInstruction } = require(webhookPath);
    const prompt = buildSystemInstruction("10-27-26");
    assert.match(prompt, /"WORKOUT"/);
    assert.match(prompt, /logWorkoutSession/);
    assert.match(prompt, /s1d1/);
    assert.match(prompt, /30s\/30s/);
    assert.match(prompt, /2 - Alerta tendón\/periostio/);
    assert.match(prompt, /1 - Fatiga muscular/);
    assert.match(prompt, /0 - Impecable/);
});

function loadWebhook() {
    class FakeClient {
        constructor() {
            this.pages = {
                create: async (args) => {
                    loadWebhook.created.push(args);
                    return { id: "workout-1", url: "https://notion.so/workout-1" };
                },
            };
        }
    }
    mockModule(notionClientPath, { Client: FakeClient });
    delete require.cache[notionServicePath];
    delete require.cache[workoutTrackerPath];
    delete require.cache[webhookPath];
    process.env.NOTION_TOKEN = "secret";
    process.env.NOTION_WORKOUT_DB_ID = DB_ID;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.GEMINI_API_KEY = "test-gemini";
    return require(webhookPath);
}
loadWebhook.created = [];

test("Telegram registra la sesión abreviada sin llamar a Gemini y advierte si hay dolor de tendón", async () => {
    loadWebhook.created = [];
    const fetched = [];
    global.fetch = async (url, options = {}) => {
        const urlStr = String(url);
        const body = options.body ? JSON.parse(options.body) : {};
        fetched.push({ url: urlStr, body });
        if (urlStr.endsWith("/sendMessage")) {
            return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
        }
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadWebhook();
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send() {
            return this;
        },
    };
    await handler(
        {
            method: "POST",
            body: {
                message: {
                    chat: { id: 77 },
                    text: "Hoy hice cuerda s2d1 35/25, dolor en el tendón",
                },
            },
        },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(fetched.some((call) => call.url.includes("generativelanguage")), false);
    assert.equal(loadWebhook.created.length, 1);
    const props = loadWebhook.created[0].properties;
    assert.deepEqual(props["Semana / Sesión"], { select: { name: "S2-D1" } });
    assert.deepEqual(props.Protocolo, { select: { name: "35s/25s" } });
    assert.deepEqual(props["Molestia articular"], { select: { name: "2 - Alerta tendón/periostio" } });
    assert.deepEqual(props.Completado, { checkbox: true });
    const send = fetched.find((call) => call.url.endsWith("/sendMessage"));
    assert.match(send.body.text, /caminadora inclinada/);
    assert.match(send.body.text, /descanso activo/);
    assert.match(send.body.text, /tendón de Aquiles/);
    assert.equal(send.body.chat_id, 77);
});

test("el intent WORKOUT de Gemini también registra la sesión", async () => {
    loadWebhook.created = [];
    const fetched = [];
    global.fetch = async (url, options = {}) => {
        const urlStr = String(url);
        const body = options.body ? JSON.parse(options.body) : {};
        fetched.push({ url: urlStr, body });
        if (urlStr.includes("generativelanguage")) {
            return {
                ok: true,
                json: async () => ({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify({
                                            intent: "WORKOUT",
                                            data: {
                                                semanaSesion: "s1d2",
                                                protocolo: "45/15",
                                                completado: true,
                                                molestiaArticular: "1 - Fatiga muscular",
                                                notas: "",
                                                fecha: "",
                                            },
                                        }),
                                    },
                                ],
                            },
                        },
                    ],
                }),
            };
        }
        if (urlStr.endsWith("/sendMessage")) {
            return { ok: true, json: async () => ({ ok: true, result: { message_id: 2 } }) };
        }
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadWebhook();
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send() {
            return this;
        },
    };
    await handler(
        {
            method: "POST",
            body: { message: { chat: { id: 9 }, text: "anota la sesión de cardio de esta mañana" } },
        },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(fetched.some((call) => call.url.includes("generativelanguage")), true);
    assert.equal(loadWebhook.created.length, 1);
    const props = loadWebhook.created[0].properties;
    assert.deepEqual(props["Semana / Sesión"], { select: { name: "S1-D2" } });
    assert.deepEqual(props.Protocolo, { select: { name: "45s/15s" } });
    assert.deepEqual(props["Notas rapidas"], { title: [{ text: { content: "Sesión completada" } }] });
    assert.deepEqual(props["Molestia articular"], { select: { name: "1 - Fatiga muscular" } });
    const send = fetched.find((call) => call.url.endsWith("/sendMessage"));
    assert.match(send.body.text, /S1-D2/);
    assert.doesNotMatch(send.body.text, /tendón de Aquiles/);
});

test("un protocolo 30/30 no se interpreta como comando área/tarea", async () => {
    loadWebhook.created = [];
    const fetched = [];
    global.fetch = async (url, options = {}) => {
        const urlStr = String(url);
        const body = options.body ? JSON.parse(options.body) : {};
        fetched.push({ url: urlStr, body });
        if (urlStr.includes("generativelanguage")) {
            return {
                ok: true,
                json: async () => ({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify({
                                            intent: "WORKOUT",
                                            data: {
                                                semanaSesion: "s2d2",
                                                protocolo: "30/30",
                                                completado: true,
                                                molestiaArticular: "0 - Impecable",
                                                notas: "",
                                            },
                                        }),
                                    },
                                ],
                            },
                        },
                    ],
                }),
            };
        }
        if (urlStr.endsWith("/sendMessage")) {
            return { ok: true, json: async () => ({ ok: true, result: { message_id: 3 } }) };
        }
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadWebhook();
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send() {
            return this;
        },
    };
    await handler(
        {
            method: "POST",
            body: { message: { chat: { id: 4 }, text: "anota el cardio de hoy 30/30, todo bien" } },
        },
        res
    );

    assert.equal(fetched.some((call) => call.url.includes("generativelanguage")), true);
    assert.equal(loadWebhook.created.length, 1);
    assert.deepEqual(loadWebhook.created[0].properties.Protocolo, { select: { name: "30s/30s" } });
    assert.deepEqual(loadWebhook.created[0].properties["Semana / Sesión"], { select: { name: "S2-D2" } });
});
