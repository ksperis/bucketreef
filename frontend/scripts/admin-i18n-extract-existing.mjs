import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve("src/features/admin");
const outputPaths = {
  fr: path.join(root, "admin.fr.json"),
  de: path.join(root, "admin.de.json"),
  zh: path.join(root, "admin.zh.json"),
};

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) return [];
    return [filePath];
  });
}

const additions = { fr: {}, de: {}, zh: {} };

for (const filePath of sourceFiles(root)) {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "m" &&
      node.arguments.length >= 2 &&
      node.arguments.every((argument) => ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    ) {
      const values = node.arguments.map((argument) => argument.text);
      const en = values[0];
      if (values.length === 2) additions.zh[en] ??= values[1];
      if (values.length >= 4) {
        additions.fr[en] ??= values[1];
        additions.de[en] ??= values[2];
        additions.zh[en] ??= values[3];
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const locale of ["fr", "de", "zh"]) {
  const current = JSON.parse(fs.readFileSync(outputPaths[locale], "utf8"));
  const merged = { ...additions[locale], ...current };
  const sorted = Object.fromEntries(Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)));
  fs.writeFileSync(outputPaths[locale], `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`${locale}: ${Object.keys(sorted).length} entries`);
}
