import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const configs = {
  cephAdmin: {
    root: "src/features/cephAdmin",
    hook: "useCephAdminI18n",
    module: "cephAdminI18n",
  },
  shared: {
    root: "src/features/shared",
    hook: "useSharedI18n",
    module: "sharedI18n",
  },
};

const surface = process.argv[2];
const config = configs[surface];
const dryRun = process.argv.includes("--dry-run");
if (!config) {
  console.error(`Usage: node scripts/surface-i18n-codemod.mjs <${Object.keys(configs).join("|")}>`);
  process.exit(2);
}

const root = path.resolve(config.root);
const translatedAttributes = new Set([
  "aria-label",
  "ariaLabel",
  "confirmLabel",
  "description",
  "emptyLabel",
  "heading",
  "hint",
  "label",
  "placeholder",
  "resetTitle",
  "subtitle",
  "title",
  "warning",
]);
const exactSkip = new Set([
  "Admin",
  "Browser",
  "Ceph",
  "Ceph Admin",
  "CORS",
  "ETag",
  "IAM",
  "JSON",
  "Manager",
  "MiB",
  "GiB",
  "TiB",
  "OIDC",
  "Portal",
  "RGW",
  "S3",
  "SMTP STARTTLS",
  "Storage Ops",
  "URL",
  "WebAuthn",
]);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) return [];
    return [filePath];
  });
}

function shouldTranslate(value) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]/.test(text) || exactSkip.has(text)) return false;
  if (/^https?:\/\//.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return false;
  if (/^(?:RGW\d+|us-[a-z]+-\d+|user-[\w-]+|customer\d+|alice|ansible-production)$/.test(text)) return false;
  if (/^[a-z][\w.-]*\/[\w./-]+$/.test(text)) return false;
  return true;
}

function componentName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  return null;
}

function enclosingComponent(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) && current.body && ts.isBlock(current.body)) {
      const name = componentName(current);
      if (name && /^[A-Z]/.test(name)) return current;
    }
  }
  return null;
}

function quote(value) {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

for (const filePath of sourceFiles(root)) {
  let sourceText = fs.readFileSync(filePath, "utf8");
  if (sourceText.includes(config.hook)) continue;
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const replacements = [];
  const components = new Map();

  function addReplacement(node, start, end, replacement) {
    const component = enclosingComponent(node);
    if (!component) return;
    replacements.push({ start, end, replacement });
    components.set(component.pos, component);
  }

  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      translatedAttributes.has(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      shouldTranslate(node.initializer.text)
    ) {
      addReplacement(node, node.initializer.getStart(source), node.initializer.end, `{surfaceText(${quote(node.initializer.text)})}`);
    } else if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, " ").trim();
      if (shouldTranslate(value)) {
        addReplacement(node, node.getStart(source), node.end, `{surfaceText(${quote(value)})}`);
      }
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression)) &&
      shouldTranslate(node.expression.text)
    ) {
      addReplacement(node, node.expression.getStart(source), node.expression.end, `surfaceText(${quote(node.expression.text)})`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (replacements.length === 0) continue;

  for (const component of components.values()) {
    const body = component.body;
    replacements.push({
      start: body.getStart(source) + 1,
      end: body.getStart(source) + 1,
      replacement: `\n  const { text: surfaceText } = ${config.hook}();`,
    });
  }

  const relativeImport = path
    .relative(path.dirname(filePath), path.join(root, config.module))
    .replaceAll(path.sep, "/");
  const importPath = relativeImport.startsWith(".") ? relativeImport : `./${relativeImport}`;
  const imports = source.statements.filter(ts.isImportDeclaration);
  const importPosition = imports.length > 0 ? imports.at(-1).end : 0;
  replacements.push({
    start: importPosition,
    end: importPosition,
    replacement: `\nimport { ${config.hook} } from ${JSON.stringify(importPath)};`,
  });

  replacements.sort((a, b) => b.start - a.start || b.end - a.end);
  for (const edit of replacements) {
    sourceText = sourceText.slice(0, edit.start) + edit.replacement + sourceText.slice(edit.end);
  }
  const translatedCount = replacements.length - components.size - 1;
  if (!dryRun) fs.writeFileSync(filePath, sourceText);
  console.log(`${path.relative(process.cwd(), filePath)}: ${translatedCount} strings`);
}
