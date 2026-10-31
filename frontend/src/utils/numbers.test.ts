import { describe, expect, it } from "vitest";
import { clampNumber } from "./numbers";

describe("clampNumber", () => {
  it("keeps values inside the range and clamps both boundaries", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(11, 0, 10)).toBe(10);
  });
});
