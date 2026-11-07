import { describe, expect, it } from "vitest";
import {
  clampNumber,
  clampPercentage,
  clampedPercentageOf,
  parsePositiveInteger,
  roundedClampedPercentageOf,
} from "./numbers";

describe("clampNumber", () => {
  it("keeps values inside the range and clamps both boundaries", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(11, 0, 10)).toBe(10);
  });
});

describe("parsePositiveInteger", () => {
  it("accepts positive integers and rejects missing or non-integer values", () => {
    expect(parsePositiveInteger("7")).toBe(7);
    expect(parsePositiveInteger(null)).toBeNull();
    expect(parsePositiveInteger("")).toBeNull();
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parsePositiveInteger("-1")).toBeNull();
    expect(parsePositiveInteger("1.5")).toBeNull();
    expect(parsePositiveInteger("invalid")).toBeNull();
  });
});

describe("clampPercentage", () => {
  it("clamps values to the percentage range", () => {
    expect(clampPercentage(42.5)).toBe(42.5);
    expect(clampPercentage(-1)).toBe(0);
    expect(clampPercentage(101)).toBe(100);
  });
});

describe("clampedPercentageOf", () => {
  it("returns a bounded percentage for a positive total", () => {
    expect(clampedPercentageOf(25, 200)).toBe(12.5);
    expect(clampedPercentageOf(-5, 100)).toBe(0);
    expect(clampedPercentageOf(120, 100)).toBe(100);
  });

  it("returns null when the percentage cannot be computed", () => {
    expect(clampedPercentageOf(null, 100)).toBeNull();
    expect(clampedPercentageOf(10, null)).toBeNull();
    expect(clampedPercentageOf(10, 0)).toBeNull();
    expect(clampedPercentageOf(10, -1)).toBeNull();
  });
});

describe("roundedClampedPercentageOf", () => {
  it("rounds bounded percentages and preserves unavailable ratios", () => {
    expect(roundedClampedPercentageOf(1, 3)).toBe(33);
    expect(roundedClampedPercentageOf(12, 10)).toBe(100);
    expect(roundedClampedPercentageOf(-1, 10)).toBe(0);
    expect(roundedClampedPercentageOf(1, 0)).toBeNull();
    expect(roundedClampedPercentageOf(null, 10)).toBeNull();
  });
});
