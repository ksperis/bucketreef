import { describe, expect, it } from "vitest";
import { parentS3Prefix, recursiveS3PrefixesForKey } from "./s3Prefix";

describe("S3 prefix identity", () => {
  it.each([
    ["archive/", ""],
    ["archive/2026/", "archive/"],
    ["archive//", "archive/"],
    ["archive///", "archive//"],
    ["//", "/"],
    ["/archive//", "/archive/"],
  ])("preserves literal separators when resolving the parent of %s", (prefix, parent) => {
    expect(parentS3Prefix(prefix)).toBe(parent);
  });

  it("derives every literal recursive prefix without collapsing empty segments", () => {
    expect(recursiveS3PrefixesForKey("logs//2026/deleted.txt", "", false)).toEqual([
      "logs/",
      "logs//",
      "logs//2026/",
    ]);
    expect(recursiveS3PrefixesForKey("root//logs///", "root//", true)).toEqual([
      "root//logs/",
      "root//logs//",
      "root//logs///",
    ]);
  });
});
