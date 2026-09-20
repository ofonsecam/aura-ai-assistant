const test = require("node:test");
const assert = require("node:assert/strict");

const {
    inferChurchTaskFields,
    createNotionTaskPage,
    CHURCH_ORGANIZACIONES,
    CHURCH_TIPOS,
    PROP_TASK_ORGANIZACION,
    PROP_TASK_TIPO_IGLESIA,
} = require("../lib/notionTaskPage");

async function captureCreate(taskData) {
    let body = null;
    const originalFetch = global.fetch;
    global.fetch = async (_url, options = {}) => {
        body = JSON.parse(options.body || "{}");
        return { ok: true, json: async () => ({ id: "page-1", url: "https://notion.so/page-1" }) };
    };
    try {
        const result = await createNotionTaskPage(taskData);
        return { result, properties: body?.properties || {} };
    } finally {
        global.fetch = originalFetch;
    }
}

test("listas blancas de Iglesia quedan congeladas", () => {
    assert.equal(Object.isFrozen(CHURCH_ORGANIZACIONES), true);
    assert.equal(Object.isFrozen(CHURCH_TIPOS), true);
    assert.deepEqual([...CHURCH_ORGANIZACIONES], [
        "Obispado",
        "RP",
        "Seminarios",
        "Templo e Historia Familiar",
        "As",
        "Primaria",
    ]);
    assert.deepEqual([...CHURCH_TIPOS], [
        "Reuniones",
        "Llamamientos",
        "Seguimientos",
        "Entrevistas",
        "Actividades",
    ]);
});

test("inferChurchTaskFields detecta tipo y organización por palabras clave", () => {
    assert.deepEqual(inferChurchTaskFields("entrevistar al hermano"), {
        detected: true,
        organizacion: "",
        tipoIglesia: "Entrevistas",
    });
    assert.equal(inferChurchTaskFields("Reunión de consejo").tipoIglesia, "Reuniones");
    assert.equal(inferChurchTaskFields("actividad social el sábado").tipoIglesia, "Actividades");
    assert.equal(inferChurchTaskFields("preparar lección de primaria").organizacion, "Primaria");
    assert.equal(inferChurchTaskFields("visitar seminarios").organizacion, "Seminarios");
    assert.equal(inferChurchTaskFields("indexar en familysearch").organizacion, "Templo e Historia Familiar");
    assert.equal(inferChurchTaskFields("clase de escuela dominical").organizacion, "As");
    assert.equal(inferChurchTaskFields("AS mañana").organizacion, "As");
    assert.equal(inferChurchTaskFields("Comprar pan").detected, false);
});

test("Iglesia sin subcampos no envía Organización ni Tipo Iglesia", async () => {
    const { result, properties } = await captureCreate({
        Name: "Leer escrituras",
        Area: "Iglesia",
    });
    assert.equal(result.ok, true);
    assert.equal(properties.Area.select.name, "Iglesia");
    assert.equal(properties[PROP_TASK_ORGANIZACION], undefined);
    assert.equal(properties[PROP_TASK_TIPO_IGLESIA], undefined);
});

test("Iglesia escribe Organización y Tipo Iglesia solo si son válidos", async () => {
    const { properties } = await captureCreate({
        Name: "Visitar familias",
        Area: "Iglesia",
        organizacion: "Primaria",
        tipoIglesia: "Seguimientos",
    });
    assert.equal(properties[PROP_TASK_ORGANIZACION].select.name, "Primaria");
    assert.equal(properties[PROP_TASK_TIPO_IGLESIA].select.name, "Seguimientos");

    const invalid = await captureCreate({
        Name: "Visitar familias",
        Area: "Iglesia",
        organizacion: "No existe",
        tipoIglesia: "Inventado",
    });
    assert.equal(invalid.properties[PROP_TASK_ORGANIZACION], undefined);
    assert.equal(invalid.properties[PROP_TASK_TIPO_IGLESIA], undefined);
});

test("palabras de iglesia infieren Area Iglesia y selects", async () => {
    const { result, properties } = await captureCreate({
        Name: "Entrevista de primaria mañana",
        Area: "Personales",
    });
    assert.equal(result.ok, true);
    assert.equal(result.area, "Iglesia");
    assert.equal(properties.Area.select.name, "Iglesia");
    assert.equal(properties[PROP_TASK_ORGANIZACION].select.name, "Primaria");
    assert.equal(properties[PROP_TASK_TIPO_IGLESIA].select.name, "Entrevistas");
});

test("un área explícita distinta no se sobrescribe por palabras de iglesia", async () => {
    const { result, properties } = await captureCreate({
        Name: "Trabajo Traffix/ entrevista con cliente",
        Area: "Personales",
    });
    assert.equal(result.area, "Trabajo Traffix");
    assert.equal(properties.Area.select.name, "Trabajo Traffix");
    assert.equal(properties[PROP_TASK_ORGANIZACION], undefined);
    assert.equal(properties[PROP_TASK_TIPO_IGLESIA], undefined);
});
