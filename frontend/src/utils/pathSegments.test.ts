import { describe, expect, it } from "vitest";
import { lastNonEmptyPathSegment } from "./pathSegments";

describe("lastNonEmptyPathSegment", () => {
  it("returns the last non-empty segment", () => {
    expect(lastNonEmptyPathSegment("raw-data/report.csv", "download")).toBe("report.csv");
    expect(lastNonEmptyPathSegment("/nested/folder/", "download")).toBe("folder");
  });

  it("preserves the caller fallback when no segment exists", () => {
    expect(lastNonEmptyPathSegment("///", "download")).toBe("download");
    expect(lastNonEmptyPathSegment("", "object")).toBe("object");
    expect(lastNonEmptyPathSegment(undefined, "file")).toBe("file");
  });
});
