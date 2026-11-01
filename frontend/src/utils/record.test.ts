import { describe, expect, it } from "vitest";
import { asRecord, hasOnlyKeys, isRecord, isStringArray } from "./record";

describe("record helpers", () => {
  it("accepts non-array objects", () => {
    const value = { key: "value" };

    expect(isRecord(value)).toBe(true);
    expect(asRecord(value)).toBe(value);
  });

  it.each([null, undefined, [], "value", 1, true])(
    "rejects non-record value %s",
    (value) => {
      expect(isRecord(value)).toBe(false);
      expect(asRecord(value)).toBeNull();
    },
  );

  it("checks record keys against any iterable allow-list", () => {
    const value = { alpha: 1, beta: 2 };

    expect(hasOnlyKeys(value, ["alpha", "beta"])).toBe(true);
    expect(hasOnlyKeys(value, new Set(["alpha", "beta", "gamma"]))).toBe(true);
    expect(hasOnlyKeys(value, ["alpha"])).toBe(false);
  });

  it("recognizes arrays containing only strings", () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(["alpha", "beta"])).toBe(true);
    expect(isStringArray(["alpha", 2])).toBe(false);
    expect(isStringArray("alpha")).toBe(false);
  });
});
