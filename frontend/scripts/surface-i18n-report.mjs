import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const configs = {
  shared: {
    root: "src/features/shared",
    own: "shared",
    fallback: [
      "src/features/manager/manager",
      "src/features/browser/browser",
      "src/features/cephAdmin/cephAdmin",
      "src/features/admin/admin",
    ],
    labelFiles: new Set([
      "bucketActionCatalog.ts",
      "bucketCompareShared.tsx",
      "bucketOpsListState.ts",
      "bucketOpsTableColumns.tsx",
      "BucketOpsFeatureDetailFilterFields.tsx",
      "BucketOpsMetricFilterFields.tsx",
      "S3ConnectionEndpointFields.tsx",
    ]),
    textCallFiles: new Set([
      "advancedFilterShared.tsx",
      "bucketOpsAdvancedFilterUiProjection.ts",
    ]),
    extraKeys: [
      "Open",
      "Selection",
      "S3 API",
      "RGW Admin Ops",
      "Destructive S3 operations",
      "Destructive RGW Admin Ops",
      "Account",
      "Connection",
      "S3 user",
      "Configured",
      "Not set",
      "Quota: {state}",
      "Versioning",
      "Object Lock",
      "Block public access",
      "Lifecycle rules",
      "Static website",
      "Bucket policy",
      "CORS",
      "Access logging",
      "Notifications",
      "Server-side encryption",
      "days",
      "years",
      "count",
    ],
  },
  cephAdmin: {
    root: "src/features/cephAdmin",
    own: "cephAdmin",
    fallback: [
      "src/features/shared/shared",
      "src/features/admin/admin",
      "src/features/manager/manager",
      "src/features/browser/browser",
    ],
  },
};

const surface = process.argv[2];
const config = configs[surface];
if (!config) {
  console.error(`Usage: node scripts/surface-i18n-report.mjs <${Object.keys(configs).join("|")}>`);
  process.exit(2);
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [filePath];
  });
}

function readCatalog(base, locale) {
  const file = `${base}.${locale}.json`;
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

function literal(expression) {
  return expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text
    : null;
}

function addLiteralStrings(expression, target) {
  const value = literal(expression);
  if (value !== null) {
    target.add(value);
    return;
  }
  if (!expression) return;
  if (ts.isParenthesizedExpression(expression)) {
    addLiteralStrings(expression.expression, target);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    addLiteralStrings(expression.whenTrue, target);
    addLiteralStrings(expression.whenFalse, target);
  }
}

const required = new Set();
for (const key of config.extraKeys ?? []) required.add(key);
for (const filePath of sourceFiles(config.root)) {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const basename = path.basename(filePath);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (
        node.expression.text === "surfaceText" ||
        (node.expression.text === "text" && config.textCallFiles?.has(basename))
      )
    ) {
      addLiteralStrings(node.arguments[0], required);
    }
    if (
      config.labelFiles?.has(basename) &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "label"
    ) {
      const value = literal(node.initializer);
      if (value) required.add(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const technical = new Set([
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

for (const locale of ["fr", "de", "zh"]) {
  const ownBase = path.join(config.root, config.own);
  const catalogs = [readCatalog(ownBase, locale), ...config.fallback.map((base) => readCatalog(base, locale))];
  const missing = [...required]
    .filter((key) => /[A-Za-z]/.test(key))
    .filter((key) => !technical.has(key))
    .filter((key) => !catalogs.some((catalog) => Object.hasOwn(catalog, key)))
    .sort((left, right) => left.localeCompare(right));
  fs.writeFileSync(`/private/tmp/${surface}-i18n-missing-${locale}.txt`, `${missing.join("\n")}\n`);
  console.log(`${locale}: ${missing.length} missing`);
}
console.log(`required keys: ${required.size}`);
