const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "notionTaskPage.js");
const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);

for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/NOTION_MINUTAS_ID en el entorno/.test(L) && !/return/.test(L)) {
        lines[i] =
            "        return '\u274c Falta NOTION_MINUTAS_ID en el entorno (Vercel \u2192 Variables).';";
    }
    if (L.includes("NOTION_MINUTAS_ID no es un UUID") && L.includes("\uFFFD")) {
        lines[i] =
            "        return '\u274c NOTION_MINUTAS_ID no es un UUID válido (sin comillas ni espacios extra). Revisa Vercel.';";
    }
    if (L.includes("Falta NOTION_TOKEN") && L.includes("createNotionMinutePage") === false && i > 350 && i < 365) {
        if (L.includes("\uFFFD")) {
            lines[i] = "        return '\u274c Falta NOTION_TOKEN en el entorno.';";
        }
    }
    if (L.includes("Error Notion (${detail})") && L.includes("\uFFFD")) {
        lines[i] = "    return `\u274c Error Notion (${detail}).${hint404}`;";
    }
    if (L.includes("NOTION_ACTIVIDADES_PROYECTOS_ID no es un UUID") && L.includes("\uFFFD")) {
        lines[i] =
            "        return '\u274c NOTION_ACTIVIDADES_PROYECTOS_ID no es un UUID válido (sin comillas ni espacios extra). Revisa Vercel.';";
    }
    if (L.includes("Falta NOTION_ACTIVIDADES_PROYECTOS_ID") && L.includes("\uFFFD")) {
        lines[i] =
            "        return '\u274c Falta NOTION_ACTIVIDADES_PROYECTOS_ID en el entorno (Vercel \u2192 Variables).';";
    }
    if (/^\uFFFD\s*: '';$/.test(L)) {
        lines[i] = "";
    }
}

const out = lines.filter((L) => L !== "").join("\r\n");
fs.writeFileSync(p, out + "\r\n", "utf8");
console.log("ok");
