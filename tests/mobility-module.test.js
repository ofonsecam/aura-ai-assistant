const test = require("node:test");
const assert = require("node:assert/strict");
const {
    formatMobilityRoutineMessage,
    getActiveMobilityRoutine,
    __resetMobilityCacheForTests,
} = require("../src/modules/mobility/mobilityNotion");

test("formatMobilityRoutineMessage lista rutina, ejercicios y nota Bend", () => {
    const text = formatMobilityRoutineMessage({
        name: "Movilidad Matutina Completa",
        tiempoEstimado: "10-12 min",
        exercises: [
            {
                name: "Gato-vaca",
                dosis: "8 reps lentas",
                instruccion: "Coordina respiración con el movimiento",
                enlace: "https://example.com/gif",
            },
        ],
    });
    assert.match(text, /Rutina Activa/);
    assert.match(text, /Movilidad Matutina Completa/);
    assert.match(text, /10-12 min/);
    assert.match(text, /Gato-vaca/);
    assert.match(text, /8 reps lentas/);
    assert.match(text, /Coordina respiración/);
    assert.match(text, /\[Ver ejemplo\]\(https:\/\/example\.com\/gif\)/);
    assert.match(text, /Bend/);
});

test("getActiveMobilityRoutine usa caché en memoria tras la primera consulta", async () => {
    __resetMobilityCacheForTests();
    process.env.NOTION_ROUTINES_ID = "11111111-1111-1111-1111-111111111111";
    process.env.NOTION_EXERCISES_ID = "22222222-2222-2222-2222-222222222222";
    process.env.NOTION_TOKEN = "test-token";

    let fetchCount = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        fetchCount += 1;
        const u = String(url);
        if (u.includes("/databases/") && u.includes("/query")) {
            return {
                ok: true,
                json: async () => ({
                    results: [
                        {
                            id: "routine-1",
                            properties: {
                                Name: { type: "title", title: [{ plain_text: "Rutina Test" }] },
                                Activa: { type: "checkbox", checkbox: true },
                                "Tiempo Estimado": {
                                    type: "rich_text",
                                    rich_text: [{ plain_text: "5 min" }],
                                },
                                Ejercicios: {
                                    type: "relation",
                                    relation: [{ id: "ex-1" }],
                                },
                            },
                        },
                    ],
                }),
            };
        }
        if (u.includes("/pages/ex-1")) {
            return {
                ok: true,
                json: async () => ({
                    id: "ex-1",
                    properties: {
                        Ejercicio: { type: "title", title: [{ plain_text: "Puente" }] },
                        "Dosis Recomendada": {
                            type: "rich_text",
                            rich_text: [{ plain_text: "10 reps" }],
                        },
                        "Instruccion Clave": {
                            type: "rich_text",
                            rich_text: [{ plain_text: "Empuja talones" }],
                        },
                        "Enlace/GIF": { type: "url", url: "https://example.com/puente" },
                    },
                }),
            };
        }
        return { ok: false, json: async () => ({ message: "unexpected" }) };
    };

    try {
        const first = await getActiveMobilityRoutine();
        assert.equal(first.ok, true);
        assert.equal(first.fromCache, false);
        assert.equal(first.routine.name, "Rutina Test");
        assert.equal(first.routine.exercises[0].name, "Puente");
        const callsAfterFirst = fetchCount;

        const second = await getActiveMobilityRoutine();
        assert.equal(second.ok, true);
        assert.equal(second.fromCache, true);
        assert.equal(fetchCount, callsAfterFirst);
    } finally {
        global.fetch = originalFetch;
        __resetMobilityCacheForTests();
    }
});
