import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve("src/features/admin");
const admin = {
  fr: JSON.parse(fs.readFileSync(path.join(root, "admin.fr.json"), "utf8")),
  de: JSON.parse(fs.readFileSync(path.join(root, "admin.de.json"), "utf8")),
  zh: JSON.parse(fs.readFileSync(path.join(root, "admin.zh.json"), "utf8")),
};
const shared = {
  fr: [JSON.parse(fs.readFileSync("src/features/manager/manager.fr.json", "utf8")), JSON.parse(fs.readFileSync("src/features/browser/browser.fr.json", "utf8"))],
  de: [JSON.parse(fs.readFileSync("src/features/manager/manager.de.json", "utf8")), JSON.parse(fs.readFileSync("src/features/browser/browser.de.json", "utf8"))],
  zh: [JSON.parse(fs.readFileSync("src/features/manager/manager.zh.json", "utf8")), JSON.parse(fs.readFileSync("src/features/browser/browser.zh.json", "utf8"))],
};

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [filePath];
  });
}

function literal(expression) {
  return expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) ? expression.text : null;
}

const legacy = new Set();
const central = new Set();
for (const filePath of sourceFiles(root)) {
  if (filePath.endsWith("adminI18n.ts")) continue;
  const contents = fs.readFileSync(filePath, "utf8");
  const usesAdminI18n = contents.includes("useAdminI18n");
  const messageFile = /(?:Message|Messages)\.ts$/.test(filePath) && !filePath.endsWith("storageEndpointMessages.ts");
  const source = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true, filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const value = literal(node.arguments[0]);
      if (value && messageFile && node.expression.text === "m") legacy.add(value);
      if (value && usesAdminI18n && ["text", "adminText"].includes(node.expression.text)) central.add(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const technical = new Set(["Admin", "Browser", "Ceph", "Ceph Admin", "CORS", "ETag", "IAM", "JSON", "Manager", "MiB", "GiB", "TiB", "OIDC", "Portal", "RGW", "S3", "SMTP STARTTLS", "Storage Ops", "URL", "WebAuthn"]);
const has = (locale, key) => Object.hasOwn(admin[locale], key) || shared[locale].some((catalog) => Object.hasOwn(catalog, key)) || technical.has(key);

for (const locale of ["fr", "de", "zh"]) {
  const required = new Set([...legacy, ...central]);
  const missing = [...required].filter((key) => /[A-Za-z]/.test(key) && !has(locale, key)).sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(`/private/tmp/admin-i18n-missing-${locale}.txt`, `${missing.join("\n")}\n`);
  console.log(`${locale}: ${missing.length} missing`);
}
console.log(`legacy keys: ${legacy.size}; central keys: ${central.size}`);
