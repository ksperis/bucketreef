import { describe, expect, it } from "vitest";
import { asRecord, isRecord } from "./record";

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
});
