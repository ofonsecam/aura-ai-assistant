const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const notionServicePath = path.resolve(__dirname, "../lib/notionService.js");
const driveServicePath = path.resolve(__dirname, "../lib/driveService.js");
const notionClientPath = require.resolve("@notionhq/client");
const googleapisPath = require.resolve("googleapis");

function mockModule(modulePath, exports) {
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
}

function loadNotionService(calls) {
    class FakeClient {
        constructor() {
            this.databases = {
                retrieve: async ({ database_id }) => ({ data_sources: [{ id: `ds-${database_id}` }] }),
            };
            this.dataSources = {
                query: async (args) => {
                    calls.query = args;
                    return { results: [{ id: "periodo-current" }] };
                },
            };
            this.pages = {
                create: async (args) => {
                    calls.create = args;
                    return { id: "page-1", url: "https://notion.so/page-1" };
                },
            };
        }
    }
    mockModule(notionClientPath, { Client: FakeClient });
    delete require.cache[notionServicePath];
    return require(notionServicePath);
}

test("createGastoMaestro envía el esquema exacto de DB_Gastos_Maestros", async () => {
    process.env.NOTION_TOKEN = "secret";
    process.env.NOTION_GASTOS_DB_ID = "11111111111111111111111111111111";
    process.env.NOTION_PERIODOS_DB_ID = "22222222222222222222222222222222";
    const calls = {};
    const { createGastoMaestro } = loadNotionService(calls);

    await createGastoMaestro({
        descripcion: "cena",
        monto: 75000,
        clasificacionFiscal: "Categoría 3 - Informal Mayor",
        estadoDian: "Pendiente Documento Soporte",
        nitCedula: "900123456-7",
        razonSocial: "Restaurante SAS",
        soporteDriveUrl: null,
    });

    assert.deepEqual(calls.query.filter, { property: "Select", select: { equals: "Current" } });
    assert.deepEqual(calls.create.parent, {
        database_id: process.env.NOTION_GASTOS_DB_ID,
    });
    assert.notEqual(calls.create.parent.database_id, process.env.NOTION_PERIODOS_DB_ID);
    assert.ok(calls.create.properties["Descripcion gasto"]);
    const props = calls.create.properties;
    assert.deepEqual(Object.keys(props).sort(), [
        "Clasificacion Fiscal",
        "DB_Periodos",
        "Descripcion gasto",
        "Estado DIAN",
        "Fecha de gasto",
        "Monto",
        "NIT / Cédula",
        "Razón Social",
    ]);
    assert.equal(props["Soporte Drive"], undefined);
    assert.deepEqual(props["Descripcion gasto"], { title: [{ text: { content: "cena" } }] });
    assert.deepEqual(props.DB_Periodos, { relation: [{ id: "periodo-current" }] });
    assert.deepEqual(props["Clasificacion Fiscal"], { select: { name: "Categoría 3 - Informal Mayor" } });
    assert.deepEqual(props["Estado DIAN"], { status: { name: "Pendiente Documento Soporte" } });
    assert.deepEqual(props["NIT / Cédula"], { rich_text: [{ text: { content: "900123456-7" } }] });
    assert.deepEqual(props["Razón Social"], { rich_text: [{ text: { content: "Restaurante SAS" } }] });
    assert.deepEqual(props.Monto, { number: 75000 });
    assert.match(props["Fecha de gasto"].date.start, /^\d{4}-\d{2}-\d{2}$/);
});

test("createGastoMaestro omite NIT, Razón Social y Soporte Drive si no llegan", async () => {
    process.env.NOTION_TOKEN = "secret";
    process.env.NOTION_GASTOS_DB_ID = "11111111111111111111111111111111";
    process.env.NOTION_PERIODOS_DB_ID = "22222222222222222222222222222222";
    const calls = {};
    const { createGastoMaestro } = loadNotionService(calls);
    await createGastoMaestro({
        descripcion: "tinto",
        monto: 3000,
        clasificacionFiscal: "Categoría 2 - Informal Menor",
        nitCedula: "   ",
        razonSocial: "",
        soporteDriveUrl: null,
    });
    assert.equal(calls.create.properties["NIT / Cédula"], undefined);
    assert.equal(calls.create.properties["Razón Social"], undefined);
    assert.equal(calls.create.properties["Soporte Drive"], undefined);
});

test("createGastoMaestro incluye Soporte Drive solo con URL real", async () => {
    process.env.NOTION_TOKEN = "secret";
    process.env.NOTION_GASTOS_DB_ID = "11111111111111111111111111111111";
    process.env.NOTION_PERIODOS_DB_ID = "22222222222222222222222222222222";
    const calls = {};
    const { createGastoMaestro } = loadNotionService(calls);
    await createGastoMaestro({
        descripcion: "factura",
        monto: 12000,
        clasificacionFiscal: "Categoría 1 - Deducible",
        soporteDriveUrl: "https://drive.google.com/file/d/abc/view",
    });
    assert.deepEqual(calls.create.properties["Soporte Drive"], {
        url: "https://drive.google.com/file/d/abc/view",
    });
});

function loadDriveService(captured) {
    class FakeGoogleAuth {
        constructor(opts) {
            captured.authOptions = opts;
        }
    }
    const drive = {
        files: {
            create: async () => ({ data: { id: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" } }),
            get: async () => ({ data: {} }),
        },
        permissions: {
            create: async (args) => {
                captured.permission = args;
                return { data: {} };
            },
        },
    };
    mockModule(googleapisPath, { google: { auth: { GoogleAuth: FakeGoogleAuth }, drive: () => drive } });
    delete require.cache[driveServicePath];
    return require(driveServicePath);
}

test("driveService usa GoogleAuth solo con GOOGLE_CLIENT_EMAIL y GOOGLE_PRIVATE_KEY", async () => {
    process.env.GOOGLE_CLIENT_EMAIL = "aura@proyecto.iam.gserviceaccount.com";
    process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n";
    process.env.DRIVE_FOLDER_ID = "folder-1";
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "calendar@legacy.com", private_key: "x" });
    const captured = {};
    const { uploadBufferToDrive } = loadDriveService(captured);

    const result = await uploadBufferToDrive({ buffer: Buffer.from("pdf"), fileName: "f.pdf", mimeType: "application/pdf" });

    assert.equal(result.ok, true);
    assert.equal(result.webViewLink, "https://drive.google.com/file/d/file-1/view");
    assert.deepEqual(captured.authOptions.credentials, {
        client_email: "aura@proyecto.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----",
    });
    assert.deepEqual(captured.permission.requestBody, { role: "reader", type: "anyone" });
});

test("driveService no cae en GOOGLE_SERVICE_ACCOUNT_JSON cuando faltan sus variables", () => {
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    process.env.DRIVE_FOLDER_ID = "folder-1";
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "calendar@legacy.com", private_key: "x" });
    const { getDriveConfig } = loadDriveService({});
    const config = getDriveConfig();
    assert.equal(config.ok, false);
    assert.match(config.error, /GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY/);

    const source = fs.readFileSync(driveServicePath, "utf8");
    assert.doesNotMatch(source, /process\.env\.GOOGLE_SERVICE_ACCOUNT_JSON/);
});
