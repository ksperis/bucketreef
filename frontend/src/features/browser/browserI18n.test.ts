/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { browserIntlLocale, browserText } from "./browserI18n";
import browserDe from "./browser.de.json";
import browserFr from "./browser.fr.json";
import browserZh from "./browser.zh.json";

const browserSourceDirectory = dirname(fileURLToPath(import.meta.url));

const DYNAMIC_BROWSER_KEYS = [
  "Access & Protection",
  "Advanced",
  "Archive",
  "Bucket",
  "Bucket details",
  "Bucket settings",
  "Buckets",
  "Cache-Control",
  "Cancelled",
  "Checking",
  "Clean old versions",
  "Clipboard is empty or unavailable in this context.",
  "Completed",
  "Content type",
  "Content disposition",
  "Content encoding",
  "Content language",
  "Content-Type",
  "Copy",
  "Copy path",
  "Copy URL",
  "Copying",
  "Create public link",
  "Cut",
  "Delete",
  "Deleting",
  "Details",
  "Download",
  "Download as ZIP",
  "Download folder",
  "Downloading",
  "ETag",
  "Expires",
  "Failed",
  "Hide deleted files",
  "Hide folders",
  "Idle",
  "In progress",
  "Listing is not available for this bucket.",
  "Listing not allowed with current credentials.",
  "Metadata",
  "Multipart uploads",
  "New folder",
  "No files found.",
  "No items copied.",
  "No items to delete.",
  "No list access",
  "Object Lock is not enabled on this bucket. Legal hold and retention settings are unavailable.",
  "Objects are already loading.",
  "Open",
  "Open full details",
  "Paste",
  "Paste (Move)",
  "Path details",
  "Preparing copy list...",
  "Preparing delete list...",
  "Preparing download list...",
  "Preview",
  "Properties",
  "Queued",
  "Ready",
  "Refresh",
  "Restore",
  "Restore deleted files in this folder",
  "Restore status",
  "Restore to date",
  "Retry in a moment.",
  "Select a bucket to configure it.",
  "Select a bucket to inspect multipart uploads.",
  "Select current files or folders to archive.",
  "Show deleted files",
  "Show folders",
  "Storage Space",
  "Storage Spaces",
  "Stop",
  "Stop all",
  "Tags",
  "The current account is not allowed to list buckets. You can still open a bucket you have access to directly, or ask an administrator to update your permissions.",
  "The current account is not allowed to list Storage Spaces. Ask an administrator to update your access.",
  "The current credentials cannot list objects or folders in this bucket.",
  "This object is deleted. Open versions to inspect or restore it.",
  "Unable to list buckets for this account.",
  "Unable to load objects for this bucket.",
  "Upload files",
  "Upload folder",
  "Versions",
  "Wait for the current operation to finish.",
  "bucket",
  "file",
  "files",
  "object",
  "objects",
  "storage space",
  "buckets",
  "storage spaces",
  "Size",
  "Modified",
  "Last modified",
  "Owner",
  "Storage class",
  "Version ID",
  "Cache control",
  "Direct download/upload is not allowed on this bucket.",
  "Unsafe or ambiguous archive path",
  "Archive path collision",
  "This action is not available in the current Browser profile.",
  "This action is temporarily unavailable.",
  "This action is not supported from this surface.",
  "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.",
  "Versioning",
  "Object Lock",
  "Block public access",
  "Lifecycle rules",
  "Bucket policy",
  "Access logging",
  "Static website",
  "Quota",
  "Enabled",
  "Disabled",
  "Suspended",
  "Partial",
  "Configured",
  "Not set",
  "Image",
  "Video",
  "Audio",
  "Text",
  "STS is not available for S3 connections. Presigned URLs are used instead.",
  "STS is not available for S3 users. Presigned URLs are used instead.",
] as const;

const TECHNICAL_IDENTICAL_KEYS = new Set([
  "ACL",
  "Browser",
  "CORS",
  "ETag",
  "S3",
  "SSE-C",
  "STS",
  "Object Lock",
  "URL",
  "Cache-Control",
  "Content-Type",
  "SSE-C",
  "STS",
]);

// These are also valid words in the target language, or established S3 vocabulary.
const IDENTICAL_KEYS_BY_LOCALE: Record<string, Set<string>> = {
  fr: new Set(["+ Bucket", "Actions", "Archive", "Audio", "Image", "Proxy", "Quota", "Bucket", "Buckets", "buckets", "bucket", "Compact", "Mode", "Standard", "Tags", "Type", "version", "Version", "Versions", "Visible", "Volume"]),
  de: new Set(["+ Bucket", "Audio", "Video", "Text", "Bucket", "Buckets", "buckets", "bucket", "Details", "Name", "Proxy", "Standard", "Status", "Tags", "Version"]),
  zh: new Set(),
};

function collectTranslationLiteral(expression: ts.Expression, keys: Set<string>) {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    if (expression.text) keys.add(expression.text);
    return;
  }
  if (ts.isParenthesizedExpression(expression)) {
    collectTranslationLiteral(expression.expression, keys);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    collectTranslationLiteral(expression.whenTrue, keys);
    collectTranslationLiteral(expression.whenFalse, keys);
  }
}

function browserSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : browserSourceFiles(path);
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function collectBrowserTranslationKeys(): string[] {
  const keys = new Set<string>(DYNAMIC_BROWSER_KEYS);
  browserSourceFiles(browserSourceDirectory).forEach((path) => {
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
        (node.expression.text === "text" || node.expression.text === "tr") &&
        node.arguments[0]
      ) {
        collectTranslationLiteral(node.arguments[0], keys);
      }
      // These models intentionally retain canonical English labels. The view
      // translates them, so include their labels and reasons in catalog coverage.
      if (
        /(?:browserActions|browserObjectTableModel|browserObjectDetailsModel|browserBucketModel|BrowserObjectPropertiesTab|BrowserOperationCards)\.tsx?$/.test(path) &&
        ts.isPropertyAssignment(node) &&
        ["label", "disabledReason", "title", "description", "activeLabel", "emptyCompletedLabel", "emptyPendingLabel", "stopLabel"].includes(node.name.getText(source))
      ) {
        collectTranslationLiteral(node.initializer, keys);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          ["extractApiError", "messageFrom"].includes(node.expression.text) && node.arguments[1]) {
        collectTranslationLiteral(node.arguments[1], keys);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  });
  return [...keys].sort((left, right) => left.localeCompare(right));
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort((left, right) => left.localeCompare(right));
}

const requiredBrowserKeys = collectBrowserTranslationKeys();
const catalogs = { fr: browserFr, de: browserDe, zh: browserZh } as const;

describe("Browser i18n", () => {
  it("translates Browser copy in all supported languages", () => {
    expect(browserText("Favorites", "fr")).toBe("Favoris");
    expect(browserText("Favorites", "de")).toBe("Favoriten");
    expect(browserText("Favorites", "zh")).toBe("收藏");
  });

  it("interpolates Browser values", () => {
    expect(browserText("{count} results", "fr", { count: 3 })).toBe("3 résultats");
    expect(browserText("{count} results", "de", { count: 3 })).toBe("3 Ergebnisse");
    expect(browserText("{count} results", "zh", { count: 3 })).toBe("3 个结果");
  });

  it("covers every Browser translation key in every locale", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      const missing = requiredBrowserKeys.filter((key) => !(key in catalog));
      expect(missing, `${locale} is missing Browser copy`).toEqual([]);
    }
  });

  it("preserves interpolation placeholders in every locale", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      const mismatches = requiredBrowserKeys.flatMap((key) => {
        const translated = catalog[key as keyof typeof catalog];
        if (translated === undefined) return [];
        return JSON.stringify(placeholders(translated)) === JSON.stringify(placeholders(key))
          ? []
          : [`${locale}: ${key}`];
      });
      expect(mismatches).toEqual([]);
    }
  });

  it("does not silently leave ordinary Browser copy in English", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      const untranslated = requiredBrowserKeys.filter(
        (key) => catalog[key as keyof typeof catalog] === key &&
          /[A-Za-z]/.test(key.replace(/\{\w+\}/g, "")) &&
          !TECHNICAL_IDENTICAL_KEYS.has(key) && !IDENTICAL_KEYS_BY_LOCALE[locale]?.has(key),
      );
      expect(untranslated, `${locale} contains untranslated Browser copy`).toEqual([]);
    }
  });

  it("falls back to English for missing Browser copy", () => {
    expect(browserText("Unknown Browser copy", "fr")).toBe("Unknown Browser copy");
    expect(browserText("Unknown Browser copy", "de")).toBe("Unknown Browser copy");
    expect(browserText("Unknown Browser copy", "zh")).toBe("Unknown Browser copy");
  });

  it("maps Browser formatting to the selected locale", () => {
    expect(browserIntlLocale("en")).toBe("en-US");
    expect(browserIntlLocale("fr")).toBe("fr-FR");
    expect(browserIntlLocale("de")).toBe("de-DE");
    expect(browserIntlLocale("zh")).toBe("zh-CN");
  });
});
