/* Keep listing geometry in the shared stylesheet, not in page renderers. */
import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../src");
const violations = [];
let tables = 0;
let actions = 0;
const geometry = /(?:^|\s)(?:\S+:)?!?(?:rounded(?:-\S+)?|font-(?:normal|medium|semibold|bold)|text-(?:xs|sm|base|\[\d[^\]]*\])|(?:min-)?h-\S+|px-\S+|py-\S+)(?=\s|$)/;

function inspect(file) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const relative = path.relative(root, file);
  const report = (node, message) => violations.push(`${relative}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${message}`);
  if (/\b(?:manager-table|compact-table)\b/.test(source)) report(ast, "Use the shared ui-data-table foundation.");
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      let inRow = false;
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(ast) === "td") inRow = true;
        if (ts.isPropertyAssignment(parent) && parent.name.getText(ast) === "render") inRow = true;
      }
      if (inRow && ["button", "Link"].includes(tag)) {
        const cls = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "className")?.getText(ast) ?? "";
        if (/rounded|uiButtonBaseClass|formInlineActionClasses/.test(cls)) report(node, "Use ListActionButton/Link for row actions; retain native controls only for identity, selection or specialized menus.");
      }
      if (["ListToolbar", "ListPageSection"].includes(tag)) {
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
        if (attributes.some(prop => ["showHeading", "stackControlsOnMobile"].includes(prop.name.getText(ast)))) {
          report(node, "Use the explicit page/section variant and shared responsive layout.");
        }
        if (!attributes.some(prop => prop.name.getText(ast) === "variant") && !node.attributes.properties.some(ts.isJsxSpreadAttribute)) {
          report(node, "Choose a page or section list header variant explicitly.");
        }
      }
      if (tag === "table" || tag === "DataTableShell") tables += 1;
      if (["ListActionButton", "ListActionLink", "ListBadge"].includes(tag)) {
        actions += 1;
        const className = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "className");
        const checkLiterals = (value) => {
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) || ts.isTemplateHead(value) || ts.isTemplateMiddle(value) || ts.isTemplateTail(value)) {
            if (geometry.test(value.text)) report(value, `${tag} geometry belongs in listPresentation.css; keep only layout or business state classes here.`);
          }
          ts.forEachChild(value, checkLiterals);
        };
        if (className?.initializer) checkLiterals(className.initializer);
      }
      if (tag === "table") {
        const cls = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "className")?.getText(ast) ?? "";
        if (!/ui-data-table|uiDataTableClass/.test(cls)) report(node, "Raw tables must explicitly consume ui-data-table.");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(file)) inspect(file);
  }
}
walk(root);
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else console.log(`Listing presentation: ${tables} table sites and ${actions} shared action/badge sites checked.`);
