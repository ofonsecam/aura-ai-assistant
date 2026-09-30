const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const expenseFilterPath = path.resolve(__dirname, "../lib/expenseFilter.js");
const drivePath = path.resolve(__dirname, "../lib/driveService.js");
const notionServicePath = path.resolve(__dirname, "../lib/notionService.js");

function loadExpenseFilter({ drive = {}, notion = {} } = {}) {
    delete require.cache[expenseFilterPath];
    require.cache[drivePath] = {
        id: drivePath,
        filename: drivePath,
        loaded: true,
        exports: {
            getDriveConfig: () => ({ ok: true }),
            uploadBufferToDrive: async () => ({ ok: true, fileId: "f1", webViewLink: "https://drive.google.com/file/d/f1/view" }),
            ...drive,
        },
    };
    require.cache[notionServicePath] = {
        id: notionServicePath,
        filename: notionServicePath,
        loaded: true,
        exports: {
            normalizeNotionId: (v) => v,
            getCurrentPeriodoPageId: async () => "periodo-1",
            createGastoMaestro: async () => ({ id: "p1", url: "https://notion.so/p1", periodoPageId: "periodo-1", fechaYmd: "2026-09-29" }),
            ...notion,
        },
    };
    return require(expenseFilterPath);
}

test("parseGastoCommand extrae monto y descripción", () => {
    const { parseGastoCommand } = loadExpenseFilter();
    assert.deepEqual(parseGastoCommand("/gasto 18000 almuerzo corrientazo"), {
        ok: true,
        monto: 18000,
        descripcion: "almuerzo corrientazo",
    });
    assert.deepEqual(parseGastoCommand("/gasto@AuraBot 120.000 mercado D1"), {
        ok: true,
        monto: 120000,
        descripcion: "mercado D1",
    });
    assert.equal(parseGastoCommand("/Gasto 15000").monto, 15000);
    assert.equal(parseGastoCommand("/GASTO 15000 taxi").descripcion, "taxi");
    assert.equal(parseGastoCommand("/gasto 5000").descripcion, "Gasto");
    assert.equal(parseGastoCommand("/gasto almuerzo").ok, false);
    assert.equal(parseGastoCommand("/gasto").ok, false);
    assert.equal(parseGastoCommand("/gastos 1000 x"), null);
    assert.equal(parseGastoCommand("$ 1000 x"), null);
});

test("classifyExpense aplica el Filtro de Viabilidad", () => {
    const { classifyExpense } = loadExpenseFilter();
    assert.deepEqual(classifyExpense({ monto: 49999, hasAttachment: false }), {
        tipo: "microgasto",
        clasificacionFiscal: "Categoría 2 - Informal Menor",
        estadoDian: "Gasto Personal",
    });
    assert.deepEqual(classifyExpense({ monto: 50000, hasAttachment: false }), {
        tipo: "critico",
        clasificacionFiscal: "Categoría 3 - Informal Mayor",
        estadoDian: "Pendiente Documento Soporte",
    });
    assert.equal(classifyExpense({ monto: 10, hasAttachment: true }).tipo, "formal");
});

test("gasto de texto crea página sin soporte Drive", async () => {
    let created = null;
    let uploads = 0;
    const { tryHandleGastoMessage } = loadExpenseFilter({
        drive: { uploadBufferToDrive: async () => { uploads += 1; return { ok: true }; } },
        notion: { createGastoMaestro: async (g) => { created = g; return { id: "p1", url: "" }; } },
    });
    const sent = [];
    const handled = await tryHandleGastoMessage("t", 1, { text: "/gasto 75000 cena" }, async (_t, _c, text) => sent.push(text));
    assert.equal(handled, true);
    assert.equal(uploads, 0);
    assert.deepEqual(created, {
        descripcion: "cena",
        monto: 75000,
        clasificacionFiscal: "Categoría 3 - Informal Mayor",
        estadoDian: "Pendiente Documento Soporte",
        soporteDriveUrl: null,
    });
    assert.match(sent[0], /Gasto registrado/);
});

test("gasto con foto descarga de Telegram, sube a Drive y guarda el link", async () => {
    const axios = require("axios");
    const originalGet = axios.get;
    axios.get = async (url) => {
        if (String(url).includes("/getFile")) return { data: { result: { file_path: "photos/x.jpg" } } };
        return { data: Buffer.from("img") };
    };
    let created = null;
    let uploaded = null;
    const { tryHandleGastoMessage } = loadExpenseFilter({
        drive: {
            uploadBufferToDrive: async (f) => {
                uploaded = f;
                return { ok: true, fileId: "f1", webViewLink: "https://drive.google.com/file/d/f1/view" };
            },
        },
        notion: { createGastoMaestro: async (g) => { created = g; return { id: "p1", url: "" }; } },
    });
    try {
        const message = {
            message_id: 9,
            caption: "/gasto 250000 llantas carro",
            photo: [{ file_id: "small" }, { file_id: "big" }],
        };
        const handled = await tryHandleGastoMessage("t", 1, message, async () => {});
        assert.equal(handled, true);
        assert.equal(uploaded.mimeType, "image/jpeg");
        assert.equal(uploaded.buffer.toString(), "img");
        assert.equal(created.clasificacionFiscal, "Categoría 1 - Formal");
        assert.equal(created.soporteDriveUrl, "https://drive.google.com/file/d/f1/view");
    } finally {
        axios.get = originalGet;
    }
});

test("mensajes que no son gasto pasan de largo", async () => {
    const { tryHandleGastoMessage } = loadExpenseFilter();
    const handled = await tryHandleGastoMessage("t", 1, { text: "/ld" }, async () => {});
    assert.equal(handled, false);
});
