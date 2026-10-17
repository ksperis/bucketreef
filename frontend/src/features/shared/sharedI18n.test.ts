/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sharedSourceDirectory = dirname(fileURLToPath(import.meta.url));

const labelFiles = new Set([
  "bucketActionCatalog.ts",
  "bucketCompareShared.tsx",
  "bucketOpsListState.ts",
  "bucketOpsTableColumns.tsx",
  "BucketOpsFeatureDetailFilterFields.tsx",
  "BucketOpsMetricFilterFields.tsx",
  "S3ConnectionEndpointFields.tsx",
]);

const textCallFiles = new Set([
  "advancedFilterShared.tsx",
  "bucketOpsAdvancedFilterUiProjection.ts",
]);

const extraKeys = [
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
];

const technicalIdenticalKeys = new Set([
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

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [path];
  });
}

function literal(expression: ts.Expression | undefined): string | null {
  return expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text
    : null;
}

function addLiteralStrings(expression: ts.Expression | undefined, target: Set<string>) {
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

function requiredSharedKeys(): string[] {
  const required = new Set(extraKeys);
  for (const filePath of sourceFiles(sharedSourceDirectory)) {
    const source = ts.createSourceFile(
      filePath,
      readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const fileName = basename(filePath);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "surfaceText" ||
          (node.expression.text === "text" && textCallFiles.has(fileName)))
      ) {
        addLiteralStrings(node.arguments[0], required);
      }
      if (
        labelFiles.has(fileName) &&
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
  return [...required].sort((left, right) => left.localeCompare(right));
}

function readCatalog(base: string, locale: "fr" | "de" | "zh"): Record<string, string> {
  return JSON.parse(readFileSync(`${base}.${locale}.json`, "utf8")) as Record<string, string>;
}

const requiredKeys = requiredSharedKeys();

describe("Shared i18n", () => {
  it("covers every shared translation key in every locale", () => {
    for (const locale of ["fr", "de", "zh"] as const) {
      const catalog = readCatalog(join(sharedSourceDirectory, "shared"), locale);
      const missing = requiredKeys
        .filter((key) => /[A-Za-z]/.test(key))
        .filter((key) => !technicalIdenticalKeys.has(key))
        .filter((key) => !Object.hasOwn(catalog, key));

      expect(missing, `${locale} contains untranslated shared copy`).toEqual([]);
    }
  });
});
