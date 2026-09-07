const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CATEGORY_PRIORITY_CONFIG,
    DEFAULT_CATEGORY_PRIORITY,
    DEFAULT_CATEGORY_EMOJI,
    getCategoryPriority,
    getCategoryEmoji,
    sortTasksByCategoryPriority,
} = require("../lib/categoryPriority");
const { formatSummaryTasksText } = require("../lib/notionTaskPage");
const webhook = require("../api/telegram-webhook");

test("mapeo de prioridad y emoji de rombo por categoría", () => {
    assert.equal(getCategoryPriority("Yu"), 1);
    assert.equal(getCategoryEmoji("Yu"), "🟣");
    assert.equal(getCategoryPriority("Martin"), 2);
    assert.equal(getCategoryEmoji("Martin"), "🔹");
    assert.equal(getCategoryPriority("Personales"), 3);
    assert.equal(getCategoryEmoji("Personales"), "🤍");
    assert.equal(getCategoryPriority("Iglesia"), 4);
    assert.equal(getCategoryEmoji("Iglesia"), "🟫");
    assert.equal(getCategoryPriority("F_i"), 5);
    assert.equal(getCategoryEmoji("F_i"), "🔴");
    assert.equal(getCategoryPriority("Aseo"), 6);
    assert.equal(getCategoryEmoji("Aseo"), "🩶");
    assert.equal(getCategoryPriority("Carrera"), 7);
    assert.equal(getCategoryEmoji("Carrera"), "🟡");
    assert.equal(getCategoryPriority("Universidad"), 8);
    assert.equal(getCategoryEmoji("Universidad"), "🟡");
    assert.equal(getCategoryPriority("Traffix"), 9);
    assert.equal(getCategoryEmoji("Traffix"), "🟫");
    assert.equal(getCategoryPriority("S_j"), 10);
    assert.equal(getCategoryEmoji("S_j"), "🟢");
});

test("categorías nuevas o alias usan prioridad >= 11 y emoji 🔹", () => {
    assert.equal(getCategoryPriority("IA Dev"), DEFAULT_CATEGORY_PRIORITY);
    assert.equal(getCategoryEmoji("IA Dev"), DEFAULT_CATEGORY_EMOJI);
    assert.ok(getCategoryPriority("NuevaCategoria") >= 11);
    assert.equal(getCategoryEmoji("NuevaCategoria"), "🔹");
    assert.equal(getCategoryPriority("Trabajo Traffix"), 9);
    assert.equal(getCategoryEmoji("Trabajo Traffix"), "🟫");
    assert.equal(Object.keys(CATEGORY_PRIORITY_CONFIG).length, 10);
});

test("sortTasksByCategoryPriority ordena por prioridad y conserva orden original dentro de categoría", () => {
    const tasks = [
        { name: "U1", area: "Universidad" },
        { name: "Y2", area: "Yu" },
        { name: "A1", area: "Aseo" },
        { name: "Y1", area: "Yu" },
        { name: "X1", area: "IA Dev" },
        { name: "M1", area: "Martin" },
    ];
    const ordered = sortTasksByCategoryPriority(tasks).map((t) => t.name);
    assert.deepEqual(ordered, ["Y2", "Y1", "M1", "A1", "U1", "X1"]);
});

test("formatSummaryTasksText aplica rombos y orden de categoría", () => {
    const text = formatSummaryTasksText([
        { name: "Tarea U", status: "Pendiente", area: "Universidad" },
        { name: "Tarea Y", status: "Pendiente", area: "Yu" },
        { name: "Tarea X", status: "Haciendo", area: "Familia" },
    ]);
    assert.match(text, /^📋 Tus tareas:\n1\. 🟣 \[Yu\] — Tarea Y \(Pendiente\)/);
    assert.match(text, /2\. 🟡 \[Universidad\] — Tarea U \(Pendiente\)/);
    assert.match(text, /3\. 🔹 \[Familia\] — Tarea X \(Haciendo\)/);
    assert.doesNotMatch(text, /📌/);
});

test("COMMAND_TASKS_PAGE_SIZE es 7 y pagina de a 7", () => {
    assert.equal(webhook.COMMAND_TASKS_PAGE_SIZE, 7);
    const tasks = Array.from({ length: 15 }, (_, i) => ({
        name: `Tarea ${i + 1}`,
        area: "Yu",
        fechaYmd: "2026-09-07",
    }));
    const page0 = webhook.buildListCommandMessage(tasks, 0, webhook.COMMAND_TASKS_PAGE_SIZE, {
        commandKey: "ld",
        dateLabel: "7 de septiembre",
    });
    assert.equal(page0.totalPages, 3);
    assert.match(page0.text, /^📄 Página 1 de 3 — 7 de septiembre/);
    assert.match(page0.text, /1\. 🟣 Yu - Tarea 1/);
    assert.match(page0.text, /7\. 🟣 Yu - Tarea 7/);
    assert.doesNotMatch(page0.text, /Tarea 8/);
    assert.doesNotMatch(page0.text, /📅/);

    const keyboard = webhook.buildListCommandKeyboard(tasks, "ld", 0, webhook.COMMAND_TASKS_PAGE_SIZE);
    const numberButtons = keyboard.inline_keyboard
        .slice(0, 2)
        .flat()
        .map((b) => b.text);
    assert.deepEqual(numberButtons, ["1", "2", "3", "4", "5", "6", "7"]);
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, "pick_1_ld_p1");
});

test("página 2 usa numeración global correlativa en texto y botones", () => {
    const tasks = Array.from({ length: 13 }, (_, i) => ({
        name: `Tarea ${i + 1}`,
        area: "Yu",
        fechaYmd: "2026-09-07",
    }));
    const page1 = webhook.buildListCommandMessage(tasks, 1, webhook.COMMAND_TASKS_PAGE_SIZE, {
        commandKey: "ld",
        dateLabel: "7 de septiembre",
    });
    assert.equal(page1.totalPages, 2);
    assert.match(page1.text, /^📄 Página 2 de 2 — 7 de septiembre/);
    assert.match(page1.text, /8\. 🟣 Yu - Tarea 8/);
    assert.match(page1.text, /13\. 🟣 Yu - Tarea 13/);
    assert.doesNotMatch(page1.text, /^1\. /m);
    assert.doesNotMatch(page1.text, /Tarea 7/);

    const keyboard = webhook.buildListCommandKeyboard(tasks, "ld", 1, webhook.COMMAND_TASKS_PAGE_SIZE);
    const numberButtons = keyboard.inline_keyboard
        .slice(0, 2)
        .flat()
        .map((b) => b.text);
    assert.deepEqual(numberButtons, ["8", "9", "10", "11", "12", "13"]);
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, "pick_1_ld_p2");
    assert.equal(keyboard.inline_keyboard[1][2].callback_data, "pick_6_ld_p2");
});

test("/lm omite fecha bajo tarea; /lv la conserva", () => {
    const tasks = [{ name: "Vencer", area: "Martin", fechaYmd: "2026-09-01" }];
    const lm = webhook.buildListCommandMessage(tasks, 0, 7, {
        commandKey: "lm",
        dateLabel: "8 de septiembre",
    });
    assert.match(lm.text, /^📄 Página 1 de 1 — 8 de septiembre/);
    assert.match(lm.text, /1\. 🔹 Martin - Vencer$/);
    assert.doesNotMatch(lm.text, /📅/);

    const lv = webhook.buildListCommandMessage(tasks, 0, 7, { commandKey: "lv" });
    assert.match(lv.text, /^📄 Página 1 de 1\n\n/);
    assert.doesNotMatch(lv.text, /— /);
    assert.match(lv.text, /1\. 🔹 Martin - Vencer\n📅 \*/);
});

test("helpMessage reporta v2.9.3.3", () => {
    assert.match(webhook.helpMessage, /Aura AI v2\.9\.3\.3/);
});
