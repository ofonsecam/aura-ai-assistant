const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CATEGORY_PRIORITY_CONFIG,
    DEFAULT_CATEGORY_PRIORITY,
    DEFAULT_CATEGORY_EMOJI,
    getCategoryPriority,
    getCategoryEmoji,
    getCategoryMeta,
    sortTasksByCategoryPriority,
    resolveCanonicalCategory,
    buildUnconfiguredReminder,
    getUnconfiguredCategories,
} = require("../lib/categoryPriority");
const { formatSummaryTasksText, normalizeNotionArea } = require("../lib/notionTaskPage");
const webhook = require("../api/telegram-webhook");

test("orden estricto de prioridad 1 a 9 (Matrimonio → Trabajo)", () => {
    assert.equal(Object.keys(CATEGORY_PRIORITY_CONFIG).length, 9);
    assert.equal(getCategoryPriority("Matrimonio"), 1);
    assert.equal(getCategoryEmoji("Matrimonio"), "💍");
    assert.equal(getCategoryPriority("Martin"), 2);
    assert.equal(getCategoryEmoji("Martin"), "🧸");
    assert.equal(getCategoryPriority("Yulis"), 3);
    assert.equal(getCategoryEmoji("Yulis"), "💕");
    assert.equal(getCategoryPriority("Personales"), 4);
    assert.equal(getCategoryEmoji("Personales"), "🏠");
    assert.equal(getCategoryPriority("Iglesia"), 5);
    assert.equal(getCategoryEmoji("Iglesia"), "⛪");
    assert.equal(getCategoryPriority("Proyecto"), 6);
    assert.equal(getCategoryEmoji("Proyecto"), "🚀");
    assert.equal(getCategoryPriority("Tareas_u"), 7);
    assert.equal(getCategoryEmoji("Tareas_u"), "📝");
    assert.equal(getCategoryPriority("Universidad"), 8);
    assert.equal(getCategoryEmoji("Universidad"), "🎓");
    assert.equal(getCategoryPriority("Trabajo"), 9);
    assert.equal(getCategoryEmoji("Trabajo"), "💼");

    const shuffled = [
        { name: "9", area: "Trabajo" },
        { name: "1", area: "Matrimonio" },
        { name: "5", area: "Iglesia" },
        { name: "3", area: "Yulis" },
        { name: "8", area: "Universidad" },
        { name: "2", area: "Martin" },
        { name: "6", area: "Proyecto" },
        { name: "4", area: "Personales" },
        { name: "7", area: "Tareas_u" },
    ];
    assert.deepEqual(
        sortTasksByCategoryPriority(shuffled).map((t) => t.name),
        ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
    );
});

test("aliases históricos resuelven a claves canónicas y emojis semánticos", () => {
    assert.equal(resolveCanonicalCategory("Yu"), "Yulis");
    assert.equal(getCategoryPriority("Yu"), 3);
    assert.equal(getCategoryEmoji("Yu"), "💕");

    assert.equal(resolveCanonicalCategory("Traffix"), "Trabajo");
    assert.equal(getCategoryPriority("Traffix"), 9);
    assert.equal(getCategoryEmoji("Traffix"), "💼");
    assert.equal(resolveCanonicalCategory("Trabajo Traffix"), "Trabajo");
    assert.equal(getCategoryEmoji("trabajo traffix"), "💼");

    assert.equal(resolveCanonicalCategory("Martín"), "Martin");
    assert.equal(getCategoryEmoji("Martín"), "🧸");

    assert.equal(resolveCanonicalCategory("Estudio_p"), "Proyecto");
    assert.equal(getCategoryEmoji("Estudio_p"), "🚀");
    assert.equal(resolveCanonicalCategory("proyectos"), "Proyecto");

    assert.equal(resolveCanonicalCategory("personal"), "Personales");
    assert.equal(resolveCanonicalCategory("tareas u"), "Tareas_u");
    assert.equal(resolveCanonicalCategory("Carrera"), "Trabajo");

    assert.equal(normalizeNotionArea("Yu"), "Yulis");
    assert.equal(normalizeNotionArea("Traffix"), "Trabajo");
    assert.equal(normalizeNotionArea(""), "Personales");
    assert.equal(normalizeNotionArea(null), "Personales");
});

test("áreas nuevas se conservan y el reminder escapa guiones bajos para Markdown", () => {
    assert.equal(normalizeNotionArea("Salud_fisica"), "Salud_fisica");
    assert.equal(getCategoryMeta("Salud_fisica").isConfigured, false);
    assert.equal(getCategoryEmoji("Salud_fisica"), "▫️");

    const reminder = buildUnconfiguredReminder([{ title: "Test", area: "Salud_fisica" }]);
    assert.match(reminder, /Salud\\_fisica/);
    assert.doesNotMatch(reminder, /(?<!\\)Salud_fisica/);
});

test("áreas desconocidas van al final con ▫️ y conservan orden relativo", () => {
    assert.equal(DEFAULT_CATEGORY_PRIORITY, Number.POSITIVE_INFINITY);
    assert.equal(DEFAULT_CATEGORY_EMOJI, "▫️");
    assert.equal(getCategoryPriority("IA Dev"), Number.POSITIVE_INFINITY);
    assert.equal(getCategoryEmoji("IA Dev"), "▫️");
    assert.equal(getCategoryMeta("Aseo").isConfigured, false);
    assert.equal(getCategoryEmoji("Aseo"), "▫️");
    assert.equal(resolveCanonicalCategory("IA Dev"), "IA Dev");

    const tasks = [
        { name: "U1", area: "Universidad" },
        { name: "X1", area: "IA Dev" },
        { name: "Y1", area: "Yulis" },
        { name: "X2", area: "Aseo" },
        { name: "M1", area: "Matrimonio" },
        { name: "X3", area: "IA Dev" },
    ];
    assert.deepEqual(
        sortTasksByCategoryPriority(tasks).map((t) => t.name),
        ["M1", "Y1", "U1", "X1", "X2", "X3"]
    );
});

test("buildUnconfiguredReminder vacío si todo configurado; aviso con nombre si no", () => {
    const configured = [
        { name: "A", area: "Matrimonio" },
        { name: "B", area: "Trabajo" },
        { name: "C", area: "Yu" },
    ];
    assert.equal(buildUnconfiguredReminder(configured), "");
    assert.deepEqual(getUnconfiguredCategories(configured), []);

    const mixed = [
        { name: "A", area: "Personales" },
        { name: "B", area: "IA Dev" },
        { name: "C", area: "Aseo" },
        { name: "D", area: "IA Dev" },
    ];
    assert.deepEqual(getUnconfiguredCategories(mixed), ["IA Dev", "Aseo"]);
    const reminder = buildUnconfiguredReminder(mixed);
    assert.match(reminder, /Área\(s\) sin prioridad/);
    assert.match(reminder, /IA Dev/);
    assert.match(reminder, /Aseo/);
    assert.match(reminder, /categoryPriority\.js/);
    assert.doesNotMatch(reminder, /(?<!\\)_/);
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
    // Martin (2) antes que Yu→Yulis (3); Aseo/IA Dev al final, orden relativo original.
    assert.deepEqual(ordered, ["M1", "Y2", "Y1", "U1", "A1", "X1"]);
});

test("formatSummaryTasksText aplica emojis, orden y reminder de no configuradas", () => {
    const text = formatSummaryTasksText([
        { name: "Tarea U", status: "Pendiente", area: "Universidad" },
        { name: "Tarea Y", status: "Pendiente", area: "Yu" },
        { name: "Tarea X", status: "Haciendo", area: "Familia" },
        { name: "Tarea T", status: "Pendiente", area: "Tareas_u" },
    ]);
    assert.match(text, /^📋 Tus tareas:\n1\. 💕 \[Yu\] — Tarea Y \(Pendiente\)/);
    assert.match(text, /2\. 📝 \[Tareas\\_u\] — Tarea T \(Pendiente\)/);
    assert.match(text, /3\. 🎓 \[Universidad\] — Tarea U \(Pendiente\)/);
    assert.match(text, /4\. ▫️ \[Familia\] — Tarea X \(Haciendo\)/);
    assert.match(text, /Área\(s\) sin prioridad: Familia/);
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
    assert.match(page0.text, /1\. 💕 Yu - Tarea 1/);
    assert.match(page0.text, /7\. 💕 Yu - Tarea 7/);
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
    assert.match(page1.text, /8\. 💕 Yu - Tarea 8/);
    assert.match(page1.text, /13\. 💕 Yu - Tarea 13/);
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
    assert.match(lm.text, /1\. 🧸 Martin - Vencer$/);
    assert.doesNotMatch(lm.text, /📅/);

    const lv = webhook.buildListCommandMessage(tasks, 0, 7, { commandKey: "lv" });
    assert.match(lv.text, /^📄 Página 1 de 1\n\n/);
    assert.doesNotMatch(lv.text, /— /);
    assert.match(lv.text, /1\. 🧸 Martin - Vencer\n📅 \*/);
});

test("helpMessage reporta v3.1.1", () => {
    assert.match(webhook.helpMessage, /Aura AI v3\.1\.1/);
    assert.match(webhook.helpMessage, /\/gasto \[Monto\] \[Descripción\]/);
    assert.match(webhook.helpMessage, /Ej: \/gasto 18000 almuerzo/);
    assert.match(webhook.helpMessage, /Oscar\|Yulis\|Yulieth/);
    assert.match(webhook.helpMessage, /top5 tension/i);
    assert.match(webhook.helpMessage, /his tension/i);
    assert.match(webhook.helpMessage, /Organizaci[oó]n y Tipo/i);
    assert.match(webhook.helpMessage, /\/detalle/);
    assert.match(webhook.helpMessage, /DB_Workout_Tracker/);
    assert.match(webhook.helpMessage, /s1d1/);
    assert.match(webhook.helpMessage, /nuevo en v3\.1\.0/);
    assert.match(webhook.helpMessage, /\/aseo/);
    assert.match(webhook.helpMessage, /\/movilidad/);
    assert.doesNotMatch(webhook.helpMessage, /\/syncaseo/);
});
