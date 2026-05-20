const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

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

function loadHandler(notionOverrides = {}) {
    const baseNotionExports = {
        createNotionTaskPage: async () => ({ ok: true, id: "x", url: "", databaseId: "db", databaseName: "DB" }),
        createNotionNotePage: async () => ({ ok: true }),
        createNotionExpensePage: async () => ({ ok: true }),
        createNotionMinutePage: async () => ({ ok: true }),
        createNotionActivityPage: async () => ({ ok: true }),
        parseExpenseAmount: () => 0,
        markHabitAsDone: async () => ({ ok: true, resolvedName: "Habito" }),
        normalizeNotionArea: (v) => v,
        readNotionTasks: async () => ({ tasks: [] }),
        getDailyTasks: async () => ({ tasks: [] }),
        getWeeklyTasks: async () => ({ tasks: [] }),
        getMonthTasks: async () => ({ tasks: [] }),
        getOverdueTasks: async () => [],
        queryNotionPlanProjects: async () => [],
        updateNotionProyectoEstado: async () => ({ ok: true, itemName: "Proyecto" }),
        PLAN_STATUS_COMPLETED: "Completado",
        rescheduleTaskDateByPageId: async () => ({ ok: true, dateYmd: "2026-04-30" }),
        updateNotionTaskStatus: async () => ({ ok: true, taskName: "Tarea" }),
        deleteNotionTask: async () => "ok",
        ensureDailyHabitPage: async () => ({ ok: true, page_id: "habit-page" }),
        getHabitsDatabaseNotionUrl: () => "",
        parseTaskText: () => ({ cleanTitle: "", taskDate: null }),
        taskDateToBogotaYmd: () => "2026-04-27",
        ...notionOverrides,
    };

    delete require.cache[webhookPath];
    delete require.cache[notionPath];
    require.cache[notionPath] = {
        id: notionPath,
        filename: notionPath,
        loaded: true,
        exports: baseNotionExports,
    };

    return require(webhookPath);
}

test("callback manage_* envía prompt correcto de ForceReply", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const sentMessages = [];

    global.fetch = async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : {};
        if (String(url).includes("/sendMessage")) {
            sentMessages.push(body);
            return { ok: true, json: async () => ({ ok: true, result: { message_id: 100 } }) };
        }
        if (String(url).includes("/answerCallbackQuery")) {
            return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadHandler();
    const cases = [
        ["manage_day", "¿Qué número de la lista diaria quieres gestionar mi papacho?"],
        ["manage_week", "¿Qué número de la lista semanal quieres gestionar mi papacho?"],
        ["manage_month", "¿Qué número de la lista mensual quieres gestionar mi papacho?"],
        ["manage_overdue", "¿Qué número de las tareas vencidas quieres gestionar mi papacho?"],
    ];

    for (const [callbackData, expectedPrompt] of cases) {
        const req = {
            method: "POST",
            body: {
                callback_query: {
                    id: `cb-${callbackData}`,
                    data: callbackData,
                    message: { chat: { id: 1 }, message_id: 10 },
                },
            },
        };
        const res = createMockRes();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
        const last = sentMessages[sentMessages.length - 1];
        assert.equal(last.text, expectedPrompt);
        assert.equal(last.reply_markup.force_reply, true);
    }
});

test("selección por número usa la lista correcta según prompt", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const sentMessages = [];
    const calls = { daily: 0, weekly: 0, month: 0, overdue: 0 };

    global.fetch = async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : {};
        if (String(url).includes("/sendMessage")) {
            sentMessages.push(body);
            return {
                ok: true,
                json: async () => ({ ok: true, result: { message_id: 500 + sentMessages.length } }),
            };
        }
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadHandler({
        getDailyTasks: async () => {
            calls.daily += 1;
            return { tasks: [{ id: "d1", name: "Daily 1", status: "Pendiente" }, { id: "d2", name: "Daily 2", status: "Haciendo" }] };
        },
        getWeeklyTasks: async () => {
            calls.weekly += 1;
            return { tasks: [{ id: "w1", name: "Week 1", status: "Pendiente" }, { id: "w2", name: "Week 2", status: "Haciendo" }] };
        },
        getMonthTasks: async () => {
            calls.month += 1;
            return { tasks: [{ id: "m1", name: "Month 1", status: "Pendiente" }, { id: "m2", name: "Month 2", status: "Haciendo" }] };
        },
        getOverdueTasks: async () => {
            calls.overdue += 1;
            return [
                { id: "o1", properties: { Name: { title: [{ text: { content: "Overdue 1" } }] }, Estado: { select: { name: "Pendiente" } } } },
                { id: "o2", properties: { Name: { title: [{ text: { content: "Overdue 2" } }] }, Estado: { select: { name: "Pausado" } } } },
            ];
        },
    });

    const promptCases = [
        ["¿Qué número de la lista diaria quieres gestionar mi papacho?", "d2", "Daily 2"],
        ["¿Qué número de la lista semanal quieres gestionar mi papacho?", "w2", "Week 2"],
        ["¿Qué número de la lista mensual quieres gestionar mi papacho?", "m2", "Month 2"],
        ["¿Qué número de las tareas vencidas quieres gestionar mi papacho?", "o2", "Overdue 2"],
    ];

    for (const [prompt, expectedPageId, expectedName] of promptCases) {
        const req = {
            method: "POST",
            body: {
                message: {
                    chat: { id: 99 },
                    text: "2",
                    reply_to_message: {
                        from: { is_bot: true },
                        text: prompt,
                        message_id: 70,
                    },
                },
            },
        };
        const res = createMockRes();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
        const last = sentMessages[sentMessages.length - 1];
        assert.match(last.text, new RegExp(expectedName));
        assert.equal(last.reply_markup.inline_keyboard[0][0].callback_data, `itask_done:${expectedPageId}`);
    }

    assert.equal(calls.daily, 1);
    assert.equal(calls.weekly, 1);
    assert.equal(calls.month, 1);
    assert.equal(calls.overdue, 1);
});

test("pick_ en lista envía mensaje de acción sin editar la lista", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.NOTION_TOKEN = "notion-test";
    process.env.NOTION_DATABASE_ID = "db-test";
    const apiCalls = [];

    global.fetch = async (url, options = {}) => {
        const urlStr = String(url);
        const endpoint = urlStr.split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        if (urlStr.includes("notion.com")) {
            return {
                ok: true,
                json: async () => ({
                    results: [
                        {
                            id: "d1",
                            properties: {
                                Name: { title: [{ plain_text: "Daily 1" }] },
                                Area: { select: { name: "Work" } },
                                Fecha: { date: { start: "2026-05-19" } },
                                Estado: { select: { name: "Pendiente" } },
                            },
                        },
                    ],
                    has_more: false,
                }),
            };
        }
        apiCalls.push({ endpoint, body });
        if (endpoint === "sendMessage") {
            return { ok: true, json: async () => ({ ok: true, result: { message_id: 901 } }) };
        }
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadHandler();

    const req = {
        method: "POST",
        body: {
            callback_query: {
                id: "cb-pick",
                data: "pick_1_listad_p1",
                message: { chat: { id: 42 }, message_id: 50 },
            },
        },
    };
    const res = createMockRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(!apiCalls.some((c) => c.endpoint === "editMessageText"));
    const send = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.ok(send);
    assert.match(send.body.text, /Daily 1/);
    assert.equal(send.body.reply_markup.inline_keyboard[0][0].callback_data, "itask_done:d1");
});

test("itask_done exitoso elimina el mensaje de acción", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadHandler();
    const req = {
        method: "POST",
        body: {
            callback_query: {
                id: "cb-done",
                data: "itask_done:page-1",
                message: { chat: { id: 7 }, message_id: 88 },
            },
        },
    };
    const res = createMockRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const deleted = apiCalls.find((c) => c.endpoint === "deleteMessage");
    assert.ok(deleted);
    assert.equal(deleted.body.chat_id, 7);
    assert.equal(deleted.body.message_id, 88);
});

test("/plan lista proyectos con paginación y pick en cascada", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        if (endpoint === "sendMessage") {
            return { ok: true, json: async () => ({ ok: true, result: { message_id: 1200 } }) };
        }
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadHandler({
        queryNotionPlanProjects: async () => [
            { id: "p1", name: "Proyecto Alpha", fechaYmd: "2026-06-01", tipo: "Infra", status: "En curso" },
        ],
    });

    const listReq = {
        method: "POST",
        body: { message: { chat: { id: 55 }, text: "/plan" } },
    };
    const listRes = createMockRes();
    await handler(listReq, listRes);
    assert.equal(listRes.statusCode, 200);
    const listSend = apiCalls.find((c) => c.endpoint === "sendMessage");
    assert.ok(listSend);
    assert.match(listSend.body.text, /Proyecto Alpha/);
    assert.match(listSend.body.text, /Infra/);
    assert.equal(listSend.body.reply_markup.inline_keyboard[0][0].callback_data, "pick_1_plan_p1");

    const pickReq = {
        method: "POST",
        body: {
            callback_query: {
                id: "cb-plan-pick",
                data: "pick_1_plan_p1",
                message: { chat: { id: 55 }, message_id: 60 },
            },
        },
    };
    const pickRes = createMockRes();
    await handler(pickReq, pickRes);
    assert.equal(pickRes.statusCode, 200);
    const pickSend = apiCalls.filter((c) => c.endpoint === "sendMessage").pop();
    assert.match(pickSend.body.text, /Proyecto Alpha/);
    assert.equal(pickSend.body.reply_markup.inline_keyboard[0][0].callback_data, "iproj_done:p1");
    assert.equal(pickSend.body.reply_markup.inline_keyboard[0][1].callback_data, "iproj_close:p1");
});

test("iproj_close elimina el mensaje de acción del plan", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const apiCalls = [];

    global.fetch = async (url, options = {}) => {
        const endpoint = String(url).split("/").pop();
        const body = options.body ? JSON.parse(options.body) : {};
        apiCalls.push({ endpoint, body });
        return { ok: true, json: async () => ({ ok: true }) };
    };

    const handler = loadHandler();
    const req = {
        method: "POST",
        body: {
            callback_query: {
                id: "cb-close",
                data: "iproj_close:p1",
                message: { chat: { id: 3 }, message_id: 44 },
            },
        },
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const deleted = apiCalls.find((c) => c.endpoint === "deleteMessage");
    assert.ok(deleted);
    assert.equal(deleted.body.message_id, 44);
});
