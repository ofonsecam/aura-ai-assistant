const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyCronAuthorization } = require("../lib/cronAuth");

test("verifyCronAuthorization exige CRON_SECRET configurado", () => {
    const previous = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
        const result = verifyCronAuthorization({ headers: { authorization: "Bearer x" } });
        assert.equal(result.ok, false);
        assert.equal(result.status, 500);
        assert.match(result.error, /CRON_SECRET/);
    } finally {
        if (previous == null) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previous;
    }
});

test("verifyCronAuthorization rechaza Bearer incorrecto con 401", () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "secreto";
    try {
        const missing = verifyCronAuthorization({ headers: {} });
        assert.equal(missing.ok, false);
        assert.equal(missing.status, 401);
        assert.equal(missing.error, "Unauthorized");

        const wrong = verifyCronAuthorization({ headers: { authorization: "Bearer otro" } });
        assert.equal(wrong.ok, false);
        assert.equal(wrong.status, 401);
    } finally {
        if (previous == null) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previous;
    }
});

test("verifyCronAuthorization acepta Authorization Bearer correcto", () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "secreto";
    try {
        const result = verifyCronAuthorization({ headers: { authorization: "Bearer secreto" } });
        assert.deepEqual(result, { ok: true });
    } finally {
        if (previous == null) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previous;
    }
});
