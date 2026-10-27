/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { cephAdminText } from "./cephAdminI18n";

const cephAdminSourceDirectory = dirname(fileURLToPath(import.meta.url));

const translatedAttributeNames = new Set([
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

const TECHNICAL_IDENTICAL_KEYS = new Set([
  "Admin",
  "Browser",
  "CEPH S3",
  "Ceph",
  "Ceph Admin",
  "CORS",
  "ETag",
  "IAM",
  "JSON",
  "MiB",
  "Multisite",
  "GiB",
  "TiB",
  "RGW",
  "RGW HTTP",
  "S3",
  "UID",
  "URL",
]);

const RAW_TECHNICAL_COPY = new Set([
  "Browser",
  "CEPH S3",
  "Ceph Admin",
  "RGW HTTP",
  "ops@example.com",
]);

const IDENTICAL_KEYS_BY_LOCALE: Record<string, Set<string>> = {
  fr: new Set([
    "· RGW Admin Ops",
    "account-a, account-b",
    "Account ID",
    "Actions",
    "Act.",
    "Bucket",
    "Buckets",
    "buckets",
    "Buckets (volume)",
    "Caps",
    "Configuration",
    "Email",
    "Endpoint",
    "Endpoints",
    "Flags",
    "Impact",
    "Op mask",
    "Quota",
    "read,write,delete",
    "Source",
    "Tenant",
    "Type",
  ]),
  de: new Set([
    "· RGW Admin Ops",
    "account-a, account-b",
    "Account ID",
    "Bucket",
    "Buckets",
    "Caps",
    "Email",
    "Endpoint",
    "Endpoints",
    "Flags",
    "Generation",
    "Limits",
    "Name",
    "Op mask",
    "Quota",
    "read,write,delete",
    "Status",
    "Tenant",
    "UID(s)",
  ]),
  zh: new Set([
    "· RGW Admin Ops",
    "account-a, account-b",
    "Caps",
    "Flags",
    "Op mask",
    "read,write,delete",
    "Tenant",
  ]),
};

function cephAdminSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cephAdminSourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function collectLiteral(expression: ts.Expression | undefined, values: Set<string>) {
  if (!expression) return;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    if (expression.text) values.add(expression.text);
    return;
  }
  if (ts.isParenthesizedExpression(expression)) collectLiteral(expression.expression, values);
  if (ts.isConditionalExpression(expression)) {
    collectLiteral(expression.whenTrue, values);
    collectLiteral(expression.whenFalse, values);
  }
}

function collectCephAdminTranslationKeys(): string[] {
  const keys = new Set<string>();
  cephAdminSourceFiles(cephAdminSourceDirectory).forEach((path) => {
    const isMultisiteSource = path.includes(`${sep}multisite${sep}`);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "surfaceText" ||
          (isMultisiteSource && node.expression.text === "text"))
      ) {
        collectLiteral(node.arguments[0], keys);
      }
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source) === "label" &&
        (path.endsWith("CephAdminAccountsPage.tsx") ||
          path.endsWith("CephAdminUsersPage.tsx") ||
          path.endsWith("CephAdminLayout.tsx") ||
          path.endsWith("CephAdminUserEditModal.tsx") ||
          path.endsWith("CephAdminAdminOpsModal.tsx"))
      ) {
        collectLiteral(node.initializer, keys);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  });
  return [...keys].sort((left, right) => left.localeCompare(right));
}

function collectRawCephAdminCopy(): string[] {
  const raw = new Set<string>();
  cephAdminSourceFiles(cephAdminSourceDirectory).forEach((path) => {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const value = node.text.replace(/\s+/g, " ").trim();
        if (/[A-Za-z]/.test(value)) raw.add(value);
      }
      if (
        ts.isJsxAttribute(node) &&
        translatedAttributeNames.has(node.name.text) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /[A-Za-z]/.test(node.initializer.text)
      ) {
        raw.add(node.initializer.text);
      }
      if (
        ts.isJsxExpression(node) &&
        node.expression &&
        (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression)) &&
        /[A-Za-z]/.test(node.expression.text)
      ) {
        raw.add(node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  });
  return [...raw]
    .filter((value) => !TECHNICAL_IDENTICAL_KEYS.has(value) && !RAW_TECHNICAL_COPY.has(value))
    .sort((left, right) => left.localeCompare(right));
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort((left, right) => left.localeCompare(right));
}

const requiredCephAdminKeys = collectCephAdminTranslationKeys();

describe("Ceph Admin i18n", () => {
  it("translates representative Ceph Admin copy in all supported languages", () => {
    expect(cephAdminText("Account quota", "fr")).toBe("Quota du compte");
    expect(cephAdminText("Account quota", "de")).toBe("Kontingent des Kontos");
    expect(cephAdminText("Account quota", "zh")).toBe("账户配额");
  });

  it("interpolates Ceph Admin values", () => {
    expect(cephAdminText("{count} users", "fr", { count: 3 })).toContain("3");
    expect(cephAdminText("{count} users", "de", { count: 3 })).toContain("3");
    expect(cephAdminText("{count} users", "zh", { count: 3 })).toContain("3");
  });

  it("covers every Ceph Admin translation key in every locale", () => {
    for (const locale of ["fr", "de", "zh"] as const) {
      const untranslated = requiredCephAdminKeys.filter((key) => {
        const translated = cephAdminText(key, locale);
        return translated === key &&
          /[A-Za-z]/.test(key.replace(/\{\w+\}/g, "")) &&
          !TECHNICAL_IDENTICAL_KEYS.has(key) &&
          !IDENTICAL_KEYS_BY_LOCALE[locale].has(key);
      });
      expect(untranslated, `${locale} contains untranslated Ceph Admin copy`).toEqual([]);
    }
  });

  it("preserves interpolation placeholders in every locale", () => {
    for (const locale of ["fr", "de", "zh"] as const) {
      const mismatches = requiredCephAdminKeys.filter(
        (key) => JSON.stringify(placeholders(cephAdminText(key, locale))) !== JSON.stringify(placeholders(key)),
      );
      expect(mismatches, `${locale} changes Ceph Admin placeholders`).toEqual([]);
    }
  });

  it("keeps French S3 vocabulary and compact labels UX-safe", () => {
    const expected = new Map<string, string>([
      ["Bucket", "Bucket"],
      ["Buckets", "Buckets"],
      ["Endpoint", "Endpoint"],
      ["Endpoints", "Endpoints"],
      ["Save configuration", "Enregistrer"],
    ]);
    for (const [key, value] of expected) expect(cephAdminText(key, "fr")).toBe(value);

    const compactKeys = ["Account quota", "Bucket quota", "Save configuration", "Max buckets", "Max users"];
    for (const key of compactKeys) {
      expect(cephAdminText(key, "fr").length, `${key} is too long for compact UI copy`).toBeLessThanOrEqual(24);
    }
  });

  it("does not leave visible Ceph Admin copy as raw English JSX", () => {
    expect(collectRawCephAdminCopy()).toEqual([]);
  });
});
