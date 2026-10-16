/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_CONTRACTS } from "../../navigation/workspacePages";
import { adminIntlLocale, adminText } from "./adminI18n";

const adminSourceDirectory = dirname(fileURLToPath(import.meta.url));
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
  "title",
  "warning",
]);

const TECHNICAL_IDENTICAL_KEYS = new Set([
  "=write",
  "Admin",
  "Browser",
  "Ceph",
  "Ceph Admin",
  "CORS",
  "ETag",
  "IAM",
  "JSON",
  "LDAP",
  "Manager",
  "MiB",
  "GiB",
  "TiB",
  "UID",
  "OIDC",
  "Portal",
  "RGW",
  "S3",
  "SMTP STARTTLS",
  "Storage Ops",
  "URL",
  "WebAuthn",
]);

const RAW_TECHNICAL_COPY = new Set([
  "alice",
  "ansible-production",
  "contact@example.com",
  "customer01",
  "https://hooks.example.net/bucketreef",
  "https://rgw-admin.example.com",
  "https://s3.example.com",
  "RGW00000000000000000",
  "RGW00000000000000001",
  "us-east-1",
  "user-123",
  "user-alpha",
]);

const IDENTICAL_KEYS_BY_LOCALE: Record<string, Set<string>> = {
  fr: new Set([
    "Action",
    "Actions",
    "Administration",
    "Admin UI",
    "Associations",
    "Bucket \"{id}\" {action}",
    "Endpoint",
    "ENDPOINT",
    "Endpoint {id} {action}",
    "Endpoints",
    "{count} incident",
    "{count} incidents",
    "{count} endpoint",
    "{count} endpoints",
    "{minutes} min",
    "Configuration",
    "Connections",
    "Description",
    "Documentation",
    "Email",
    "h",
    "Impact",
    "Incidents",
    "Jane Doe",
    "jane.doe@example.com",
    "Manager",
    "Manager UI",
    "Message",
    "Messages",
    "Min {latency}",
    "min",
    "Mode",
    "Mode {mode}",
    "Portal",
    "Portal UI",
    "Quotas",
    "Session",
    "Source",
    "Sources",
    "Status",
    "Superadmin",
    "Tags",
    "Total",
    "Type",
    "Webhooks",
    "Workspace",
  ]),
  de: new Set([
    "Admin",
    "Administration",
    "Browser",
    "Buckets",
    "Detail",
    "Details",
    "Jane Doe",
    "jane.doe@example.com",
    "Manager",
    "Name",
    "Portal",
    "Prompt",
    "Snapshots",
    "Start",
    "Start:",
    "Status",
    "Status:",
    "Tags",
    "Team",
    "Test",
    "Token",
    "Type",
    "UI: {ui} · S3: {s3}",
    "UID (optional)",
    "Webhooks",
  ]),
  zh: new Set(["jane.doe@example.com"]),
};

function adminSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return adminSourceFiles(path);
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

function collectAdminTranslationKeys(): string[] {
  const keys = new Set<string>();
  adminSourceFiles(adminSourceDirectory).forEach((path) => {
    if (path.endsWith("storageEndpointMessages.ts")) return;
    const contents = readFileSync(path, "utf8");
    const usesMessageHelper = /(?:Message|Messages)\.ts$/.test(path);
    const source = ts.createSourceFile(
      path,
      contents,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const adminTextBindings = new Set<string>();
    const collectBindings = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === "useAdminI18n"
      ) {
        for (const element of node.name.elements) {
          const property = element.propertyName;
          const propertyName = property && ts.isIdentifier(property) ? property.text : element.name.getText(source);
          if (propertyName === "text" && ts.isIdentifier(element.name)) adminTextBindings.add(element.name.text);
        }
      }
      ts.forEachChild(node, collectBindings);
    };
    collectBindings(source);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (adminTextBindings.has(node.expression.text) ||
          (usesMessageHelper && node.expression.text === "m") ||
          node.expression.text === "adminMessage")
      ) {
        collectLiteral(node.arguments[0], keys);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  });
  for (const contract of Object.values(ADMIN_PAGE_CONTRACTS)) keys.add(contract.label);
  return [...keys].sort((left, right) => left.localeCompare(right));
}

function collectRawAdminCopy(): string[] {
  const raw = new Set<string>();
  adminSourceFiles(adminSourceDirectory).forEach((path) => {
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

const requiredAdminKeys = collectAdminTranslationKeys();

describe("Admin i18n", () => {
  it("translates representative Admin copy in all supported languages", () => {
    expect(adminText("Authentication settings", "fr")).not.toBe("Authentication settings");
    expect(adminText("Authentication settings", "de")).not.toBe("Authentication settings");
    expect(adminText("Authentication settings", "zh")).not.toBe("Authentication settings");
  });

  it("covers every Admin translation key in every locale", () => {
    for (const locale of ["fr", "de", "zh"] as const) {
      const untranslated = requiredAdminKeys.filter((key) => {
        const translated = adminText(key, locale);
        return translated === key && /[A-Za-z]/.test(key.replace(/\{\w+\}/g, "")) &&
          !TECHNICAL_IDENTICAL_KEYS.has(key) && !IDENTICAL_KEYS_BY_LOCALE[locale].has(key);
      });
      expect(untranslated, `${locale} contains untranslated Admin copy`).toEqual([]);
    }
  });

  it("preserves interpolation placeholders in every locale", () => {
    for (const locale of ["fr", "de", "zh"] as const) {
      const mismatches = requiredAdminKeys.filter(
        (key) => JSON.stringify(placeholders(adminText(key, locale))) !== JSON.stringify(placeholders(key)),
      );
      expect(mismatches, `${locale} changes Admin placeholders`).toEqual([]);
    }
  });

  it("keeps French technical vocabulary and compact labels UX-safe", () => {
    const expected = new Map<string, string>([
      ["Admin", "Admin"],
      ["Admin UI", "Admin UI"],
      ["Browser settings", "Paramètres Browser"],
      ["Endpoint", "Endpoint"],
      ["Endpoints", "Endpoints"],
      ["Manager UI", "Manager UI"],
      ["Portal UI", "Portal UI"],
      ["Superadmin", "Superadmin"],
      ["Visible buckets", "Buckets visibles"],
      ["Workspace", "Workspace"],
    ]);
    for (const [key, value] of expected) expect(adminText(key, "fr")).toBe(value);

    const compactKeys = [
      "Admin UI",
      "Browser settings",
      "Endpoint",
      "Endpoints",
      "Manager UI",
      "Portal UI",
      "Reset MFA",
      "Superadmin",
      "Visible buckets",
      "Workspace",
    ];
    for (const key of compactKeys) {
      expect(adminText(key, "fr").length, `${key} is too long for compact UI copy`).toBeLessThanOrEqual(24);
    }
  });

  it("does not leave visible Admin copy as raw English JSX", () => {
    expect(collectRawAdminCopy()).toEqual([]);
  });

  it("maps Admin formatting to the selected locale", () => {
    expect(adminIntlLocale("en")).toBe("en-US");
    expect(adminIntlLocale("fr")).toBe("fr-FR");
    expect(adminIntlLocale("de")).toBe("de-DE");
    expect(adminIntlLocale("zh")).toBe("zh-CN");
  });
});

