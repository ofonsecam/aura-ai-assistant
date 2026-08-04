const test = require("node:test");
const assert = require("node:assert/strict");
const {
    encodeHabitIndexCallback,
    decodeHabitIndexCallback,
    buildHabitsPendingKeyboard,
    sortHabitCheckboxPropertyNames,
    resolveHabitPropertyKeyBySortedIndex,
} = require("../api/habitTelegramMenu");

test("callback_data de hábitos usa índice del esquema ordenado alfabéticamente", () => {
    const sortedCheckboxNames = ["Ejercicio", "Oración matutina profunda", "Lectura"];
    const pending = [{ propertyKey: "Oración matutina profunda", name: "Oración" }];
    const sorted = sortHabitCheckboxPropertyNames(sortedCheckboxNames);
    const expectedIndex = sorted.indexOf("Oración matutina profunda");
    const keyboard = buildHabitsPendingKeyboard(pending, sortedCheckboxNames);
    assert.equal(keyboard.inline_keyboard.length, 1);
    const callback = keyboard.inline_keyboard[0][0].callback_data;
    assert.equal(callback, `hm:${expectedIndex}`);
    assert.ok(callback.length <= 64);
    assert.equal(decodeHabitIndexCallback(callback), expectedIndex);
});

test("resolveHabitPropertyKeyBySortedIndex es determinista sin estado en memoria", () => {
    const sorted = sortHabitCheckboxPropertyNames(["Zumba", "Oración", "Ejercicio"]);
    assert.deepEqual(sorted, ["Ejercicio", "Oración", "Zumba"]);
    assert.equal(resolveHabitPropertyKeyBySortedIndex(sorted, 1), "Oración");
    assert.equal(resolveHabitPropertyKeyBySortedIndex(sorted, 99), null);
});
