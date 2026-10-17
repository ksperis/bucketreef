import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const VIRTUAL_PREFIX = "bucketreef-i18n/";
const RESOLVED_PREFIX = `\0${VIRTUAL_PREFIX}`;
const LOCALES = ["fr", "de", "zh"] as const;
const SURFACES = new Set(["admin", "browser", "cephAdmin", "manager", "shared"]);

type Catalog = Record<string, string>;

function compactCatalogModule(root: string, surface: string): { code: string; files: string[] } {
  const files = LOCALES.map((locale) =>
    resolve(root, "src", "features", surface, `${surface}.${locale}.json`),
  );
  const catalogs = Object.fromEntries(
    LOCALES.map((locale, index) => [locale, JSON.parse(readFileSync(files[index], "utf8")) as Catalog]),
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
