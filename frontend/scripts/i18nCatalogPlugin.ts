import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { Plugin } from "vite";

const VIRTUAL_PREFIX = "bucketreef-i18n/";
const RESOLVED_PREFIX = `\0${VIRTUAL_PREFIX}`;
const LOCALES = ["fr", "de", "zh"] as const;
const SURFACES = new Set(["admin", "browser", "cephAdmin", "manager", "shared"]);

type Catalog = Record<string, string>;

export function parseI18nCatalog(source: string, filePath: string): Catalog {
  const parsed: unknown = JSON.parse(source);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`BucketReef i18n catalog must be a JSON object: ${filePath}`);
  }

  const sourceFile = ts.parseJsonText(filePath, source);
  const expression = sourceFile.statements[0]?.expression;
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    throw new Error(`BucketReef i18n catalog must be a JSON object: ${filePath}`);
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.name)) continue;
    const key = property.name.text;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  if (duplicates.size > 0) {
    throw new Error(
      `Duplicate BucketReef i18n catalog keys in ${filePath}: ${[...duplicates]
        .map((key) => JSON.stringify(key))
        .join(", ")}`,
    );
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`BucketReef i18n catalog value must be a string in ${filePath}: ${JSON.stringify(key)}`);
    }
  }
  return parsed as Catalog;
}

function compactCatalogModule(root: string, surface: string): { code: string; files: string[] } {
  const files = LOCALES.map((locale) =>
    resolve(root, "src", "features", surface, `${surface}.${locale}.json`),
  );
  const catalogs = Object.fromEntries(
    LOCALES.map((locale, index) => {
      const filePath = files[index];
      return [locale, parseI18nCatalog(readFileSync(filePath, "utf8"), filePath)];
    }),
  ) as Record<(typeof LOCALES)[number], Catalog>;
  const keys = [...new Set(LOCALES.flatMap((locale) => Object.keys(catalogs[locale])))].sort();
  const rows = keys.map((key) => [
    key,
    ...LOCALES.map((locale) => catalogs[locale][key] ?? null),
  ]);

  const code = `
const rows = ${JSON.stringify(rows)};
const fr = Object.create(null);
const de = Object.create(null);
const zh = Object.create(null);
for (const [key, frValue, deValue, zhValue] of rows) {
  if (frValue !== null) fr[key] = frValue;
  if (deValue !== null) de[key] = deValue;
  if (zhValue !== null) zh[key] = zhValue;
}
export default { fr, de, zh };
`;

  return { code, files };
}

export function bucketReefI18nCatalogPlugin(): Plugin {
  let root = process.cwd();

  return {
    name: "bucketreef-i18n-catalogs",
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;
      const surface = id.slice(VIRTUAL_PREFIX.length);
      if (!SURFACES.has(surface)) {
        throw new Error(`Unknown BucketReef i18n surface: ${surface}`);
      }
      return `${RESOLVED_PREFIX}${surface}`;
    },
    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return null;
      const surface = id.slice(RESOLVED_PREFIX.length);
      const { code, files } = compactCatalogModule(root, surface);
      files.forEach((filePath) => this.addWatchFile(filePath));
      return code;
    },
  };
}
