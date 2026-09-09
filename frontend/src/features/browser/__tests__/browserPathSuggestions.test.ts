import { beforeEach, describe, expect, it } from "vitest";
import { CLIENT_STORAGE_KEYS, writeClientJson } from "../../../utils/clientStorage";

import {
  buildPathSuggestionEntries,
  mergePathSuggestions,
  pushBucketPathHistory,
  readBucketPathHistory,
  resolvePathDraftContext,
} from "../browserPathSuggestions";

describe("browserPathSuggestions", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("preserves literal drafts while resolving parent context", () => {
    expect(resolvePathDraftContext("///logs/2026")).toEqual({
      parentPrefix: "///logs/", fragment: "2026",
    });
    expect(resolvePathDraftContext("logs/2026/ju")).toEqual({
      parentPrefix: "logs/2026/",
      fragment: "ju",
    });
  });

  it("builds deduplicated scoped suggestions", () => {
    expect(
      buildPathSuggestionEntries(["logs/2026/june/", "logs/2026/july/", "/logs/2026/other/", "tmp/"], "logs/2026/", "ju", "local")
    ).toEqual([
      { value: "logs/2026/june/", label: "june", source: "local" },
      { value: "logs/2026/july/", label: "july", source: "local" },
    ]);
  });

  it.each([
    ["", "", ""],
    ["/", "/", ""],
    ["//", "//", ""],
    [" a // b ", " a //", " b "],
    [" ", "", " "],
  ])("resolves exact parent and fragment for %j", (draft, parentPrefix, fragment) => {
    expect(resolvePathDraftContext(draft)).toEqual({ parentPrefix, fragment });
  });

  it("keeps empty segments and spaces distinct in suggestions", () => {
    expect(buildPathSuggestionEntries(["/docs/", "/docs//", "/docs/ /", "docs//"], "/docs/", "", "local")).toEqual([
      { value: "/docs//", label: "/", source: "local" },
      { value: "/docs/ /", label: " ", source: "local" },
    ]);
    expect(buildPathSuggestionEntries([" a/", "a/", " a/"], "", " a", "remote")).toEqual([
      { value: " a/", label: " a", source: "remote" },
    ]);
  });

  it("validates stored entries without merging distinct prefixes", () => {
    writeClientJson(CLIENT_STORAGE_KEYS.browserPathHistory, {
      docs: [null, 123, {}, [], "", "/", "//", " a ", " a /", "a", "a/"],
      invalid: "not-an-array",
    });
    expect(readBucketPathHistory("docs")).toEqual(["/", "//", " a /", "a/"]);
    expect(readBucketPathHistory("invalid")).toEqual([]);
    expect(pushBucketPathHistory("docs", "//")).toEqual(["//", "/", " a /", "a/"]);
    expect(pushBucketPathHistory("docs", "")).toEqual(["//", "/", " a /", "a/"]);
  });

  it("caps history at twenty entries without changing other buckets", () => {
    pushBucketPathHistory("other", "/kept//");
    for (let index = 0; index < 25; index += 1) {
      pushBucketPathHistory("docs", ` /${index}//`);
    }
    expect(readBucketPathHistory("docs")).toEqual(
      Array.from({ length: 20 }, (_, index) => ` /${24 - index}//`),
    );
    expect(readBucketPathHistory("other")).toEqual(["/kept//"]);
  });

  it("prefers history over duplicate local and remote suggestions", () => {
    const result = mergePathSuggestions(
      "ju",
      [{ value: "logs/2026/july/", label: "july", source: "remote" }],
      [{ value: "logs/2026/july/", label: "july", source: "history" }]
    );

    expect(result).toEqual([{ value: "logs/2026/july/", label: "july", source: "history" }]);
  });

  it("stores bounded exact path history per bucket", () => {
    expect(pushBucketPathHistory("docs", "/reports/2026")).toEqual(["/reports/2026/"]);
    expect(pushBucketPathHistory("docs", "reports/2025")).toEqual(["reports/2025/", "/reports/2026/"]);

    expect(readBucketPathHistory("docs")).toEqual(["reports/2025/", "/reports/2026/"]);
  });
});
