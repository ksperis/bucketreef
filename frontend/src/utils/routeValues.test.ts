import { describe, expect, it } from "vitest";
import { decodeRouteValue } from "./routeValues";

describe("decodeRouteValue", () => {
  it("decodes route values and preserves malformed input", () => {
    expect(decodeRouteValue("Research%20Data")).toBe("Research Data");
    expect(decodeRouteValue("invalid%2")).toBe("invalid%2");
    expect(decodeRouteValue()).toBe("");
  });
});
