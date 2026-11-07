import { currentUtcMonthInputValue, utcDateInputValue } from "./dateInputValues";

describe("currentUtcMonthInputValue", () => {
  it("formats the UTC year and a zero-padded month for month inputs", () => {
    expect(currentUtcMonthInputValue(new Date("2026-01-31T23:30:00-02:00"))).toBe("2026-02");
    expect(currentUtcMonthInputValue(new Date("2026-11-15T12:00:00Z"))).toBe("2026-11");
  });
});

describe("utcDateInputValue", () => {
  it("uses the UTC calendar day and supports prior-day offsets", () => {
    const now = new Date("2026-01-01T00:30:00+02:00");

    expect(utcDateInputValue(0, now)).toBe("2025-12-31");
    expect(utcDateInputValue(1, now)).toBe("2025-12-30");
    expect(utcDateInputValue(14, now)).toBe("2025-12-17");
  });
});
