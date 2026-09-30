const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const geminiServicePath = path.resolve(__dirname, "../lib/geminiService.js");
const sdkPath = require.resolve("@google/generative-ai");

function loadGeminiService(generateContent) {
    const seen = { apiKey: null, modelParams: null, requestOptions: null, parts: null };
    delete require.cache[geminiServicePath];
    require.cache[sdkPath] = {
        id: sdkPath,
        filename: sdkPath,
        loaded: true,
        exports: {
            GoogleGenerativeAI: class {
                constructor(apiKey) {
                    seen.apiKey = apiKey;
                }
                getGenerativeModel(modelParams, requestOptions) {
                    seen.modelParams = modelParams;
                    seen.requestOptions = requestOptions;
                    return { generateContent };
                }
            },
        },
    };
    return { seen, ...require(geminiServicePath) };
}

test("extractInvoiceData envía la factura en base64 y parsea el JSON", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    const buffer = Buffer.from("factura-bytes");
    const { seen, extractInvoiceData, INVOICE_MODEL } = loadGeminiService(async (parts) => {
        seen.parts = parts;
        return {
            response: {
                text: () => '{"nit":"900123456","razonSocial":"Ferretería El Roble"}',
            },
        };
    });

    try {
        const result = await extractInvoiceData(buffer, "image/jpeg");
        assert.deepEqual(result, { nit: "900123456", razonSocial: "Ferretería El Roble" });
        assert.equal(seen.apiKey, "test-key");
        assert.equal(seen.modelParams.model, INVOICE_MODEL);
        assert.equal(INVOICE_MODEL, "gemini-2.5-flash");
        assert.equal(seen.modelParams.systemInstruction, undefined);
        assert.match(seen.parts[0], /auditor fiscal/);
        assert.equal(seen.modelParams.generationConfig.responseMimeType, undefined);
        assert.equal(seen.modelParams.generationConfig.responseSchema, undefined);
        assert.equal(seen.requestOptions.apiVersion, "v1");
        assert.equal(seen.requestOptions.timeout, 50000);
        assert.equal(seen.parts[1].inlineData.mimeType, "image/jpeg");
        assert.equal(seen.parts[1].inlineData.data, buffer.toString("base64"));
    } finally {
        if (previousKey == null) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
    }
});

test("extractInvoiceData acepta JSON envuelto en markdown y nulls", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { extractInvoiceData } = loadGeminiService(async () => ({
        response: { text: () => "```json\n{\"nit\": null, \"razonSocial\": \"  D1  \"}\n```" },
    }));
    const result = await extractInvoiceData(Buffer.from("pdf"), "application/pdf");
    assert.deepEqual(result, { nit: null, razonSocial: "D1" });
});

test("extractInvoiceData limpia markdown residual y texto alrededor del JSON", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { extractInvoiceData } = loadGeminiService(async () => ({
        response: {
            text: () => "Resultado:\n```JSON\n{\"NIT\": \"900.111.222-3\", \"Razón Social\": \"Éxito\"}\n```\nListo.",
        },
    }));
    const result = await extractInvoiceData(Buffer.from("img"), "image/jpeg");
    assert.deepEqual(result, { nit: "900.111.222-3", razonSocial: "Éxito" });
});

test("extractInvoiceData lanza si el JSON es inválido", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { extractInvoiceData } = loadGeminiService(async () => ({
        response: { text: () => "no es json" },
    }));
    await assert.rejects(
        () => extractInvoiceData(Buffer.from("img"), "image/jpeg"),
        /JSON inválido/
    );
});

test("extractInvoiceData exige API key y un buffer", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { extractInvoiceData } = loadGeminiService(async () => {
        throw new Error("no debería llamarse");
    });
    try {
        await assert.rejects(() => extractInvoiceData(Buffer.from("img"), "image/jpeg"), /GEMINI_API_KEY/);
        process.env.GEMINI_API_KEY = "test-key";
        await assert.rejects(() => extractInvoiceData(Buffer.alloc(0), "image/jpeg"), /vacío/);
    } finally {
        if (previousKey == null) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
    }
});
