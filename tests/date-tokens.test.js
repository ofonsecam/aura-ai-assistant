const test = require("node:test");
const assert = require("node:assert/strict");

const {
    parseTaskText,
    taskDateToBogotaYmd,
    rescheduleTaskDateByPageId,
} = require("../api/notionTaskPage");

function expectedTomorrowBogotaYmd() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    now.setDate(now.getDate() + 1);
    return now.toISOString().slice(0, 10);
}

test("parseTaskText resuelve tmw como mañana en Bogotá", () => {
    const tomorrow = expectedTomorrowBogotaYmd();

    for (const input of ["tmw", "TMW", "Tmw"]) {
        const parsed = parseTaskText(input);
        assert.equal(taskDateToBogotaYmd(parsed.taskDate), tomorrow, `token: ${input}`);
        assert.equal(parsed.cleanTitle, "");
    }

    const embedded = parseTaskText("Comprar pan tmw");
    assert.equal(taskDateToBogotaYmd(embedded.taskDate), tomorrow);
    assert.equal(embedded.cleanTitle, "Comprar pan");
});

test("parseTaskText mantiene mañana y manana sin regresión", () => {
    const tomorrow = expectedTomorrowBogotaYmd();

    assert.equal(taskDateToBogotaYmd(parseTaskText("mañana").taskDate), tomorrow);
    assert.equal(taskDateToBogotaYmd(parseTaskText("manana").taskDate), tomorrow);
    assert.equal(parseTaskText("Llamar al banco mañana").cleanTitle, "Llamar al banco");
});

test("rescheduleTaskDateByPageId acepta tmw como mañana", async () => {
    const tomorrow = expectedTomorrowBogotaYmd();
    let patchedBody = null;

    const originalFetch = global.fetch;
    global.fetch = async (_url, options = {}) => {
        patchedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: "page-1" }) };
    };

    try {
        const result = await rescheduleTaskDateByPageId("page-1", "tmw");
        assert.equal(result.ok, true);
        assert.equal(result.dateYmd, tomorrow);
        assert.equal(patchedBody.properties.Fecha.date.start, tomorrow);
    } finally {
        global.fetch = originalFetch;
    }
});

test("rescheduleTaskDateByPageId mantiene mañana sin regresión", async () => {
    const tomorrow = expectedTomorrowBogotaYmd();
    let patchedBody = null;

    const originalFetch = global.fetch;
    global.fetch = async (_url, options = {}) => {
        patchedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: "page-2" }) };
    };

    try {
        const result = await rescheduleTaskDateByPageId("page-2", "mañana");
        assert.equal(result.ok, true);
        assert.equal(result.dateYmd, tomorrow);
        assert.equal(patchedBody.properties.Fecha.date.start, tomorrow);
    } finally {
        global.fetch = originalFetch;
    }
});
