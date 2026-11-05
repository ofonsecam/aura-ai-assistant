const test = require("node:test");
const assert = require("node:assert/strict");
const {
    filterCleaningCheckboxNamesForDay,
    cleaningDisplayName,
    sortCleaningCheckboxPropertyNames,
} = require("../src/modules/cleaning/cleaningNotion");
const {
    encodeCleaningIndexCallback,
    decodeCleaningIndexCallback,
    buildCleaningPendingKeyboard,
    CLEANING_CALLBACK_PREFIX,
} = require("../src/modules/cleaning/cleaningTelegramMenu");

test("filterCleaningCheckboxNamesForDay incluye [DIARIO] y el día actual", () => {
    const names = [
        "[VIE] Baños",
        "[DIARIO] Camas",
        "[LUN] Cocina",
        "[MAR] Polvo",
        "SinPrefijo",
    ];
    const filtered = filterCleaningCheckboxNamesForDay(names, "[LUN]");
    assert.deepEqual(filtered, ["[DIARIO] Camas", "[LUN] Cocina"]);
});

test("cleaningDisplayName quita el prefijo de día", () => {
    assert.equal(cleaningDisplayName("[LUN] Cocina profunda"), "Cocina profunda");
    assert.equal(cleaningDisplayName("[DIARIO] Camas"), "Camas");
});

test("callback_data de aseo usa índice filtrado ordenado y prefijo cl:", () => {
    const sortedFilteredNames = sortCleaningCheckboxPropertyNames([
        "[LUN] Cocina",
        "[DIARIO] Camas",
    ]);
    const pending = [{ propertyKey: "[LUN] Cocina", name: "Cocina" }];
    const keyboard = buildCleaningPendingKeyboard(pending, sortedFilteredNames);
    const expectedIndex = sortedFilteredNames.indexOf("[LUN] Cocina");
    const callback = keyboard.inline_keyboard[0][0].callback_data;
    assert.equal(callback, `${CLEANING_CALLBACK_PREFIX}${expectedIndex}`);
    assert.equal(callback, encodeCleaningIndexCallback(expectedIndex));
    assert.equal(decodeCleaningIndexCallback(callback), expectedIndex);
    assert.ok(callback.length <= 64);
});
