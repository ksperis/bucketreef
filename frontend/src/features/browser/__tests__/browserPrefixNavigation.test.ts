import { describe, expect, it } from "vitest";
import { buildPrefixBreadcrumbs } from "../browserUtils";

describe("buildPrefixBreadcrumbs", () => {
  it.each([
    { value: "", labels: [], prefixes: [] },
    { value: "/", labels: ["/"], prefixes: ["/"] },
    { value: "//", labels: ["/", "/"], prefixes: ["/", "//"] },
    { value: "/docs//", labels: ["/", "docs", "/"], prefixes: ["/", "/docs/", "/docs//"] },
    { value: " a // b /", labels: [" a ", "/", " b "], prefixes: [" a /", " a //", " a // b /"] },
    { value: " ", labels: [" "], prefixes: [" /"] },
    { value: "é/%2F/../.", labels: ["é", "%2F", "..", "."], prefixes: ["é/", "é/%2F/", "é/%2F/../", "é/%2F/.././"] },
  ])("keeps exact ancestor prefixes for $value", ({ value, labels, prefixes }) => {
    const entries = buildPrefixBreadcrumbs(value);
    expect(entries.map((entry) => entry.label)).toEqual(labels);
    expect(entries.map((entry) => entry.prefix)).toEqual(prefixes);
  });
});
