import { describe, expect, it } from "vitest";
import { canonicalizeStableValue, stableSignature } from "./stableSignature";

describe("stableSignature", () => {
  it("ignores object key order and tag ordering", () => {
    const left = stableSignature({
      form: { name: "demo", tags: [{ key: "env", value: "prod" }, { key: "team", value: "ops" }] },
      selectedIds: [3, 1, 2],
    });
    const right = stableSignature({
      selectedIds: [2, 3, 1],
      form: { tags: [{ key: "team", value: "ops" }, { key: "env", value: "prod" }], name: "demo" },
    });

    expect(left).toBe(right);
  });

  it("exposes the same canonical structure for structured baselines", () => {
    expect(canonicalizeStableValue({ ids: [3, 1, 2], nested: { z: true, a: false } })).toEqual({
      ids: [1, 2, 3],
      nested: { a: false, z: true },
    });
  });
});
