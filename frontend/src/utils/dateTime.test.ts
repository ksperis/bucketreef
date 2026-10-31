import { formatLocalDateTime, getBackendElapsedTime, parseBackendDateTime } from "./dateTime";

describe("formatLocalDateTime", () => {
  it("uses the shared placeholder for missing or invalid Date values", () => {
    expect(formatLocalDateTime()).toBe("-");
    expect(formatLocalDateTime(null)).toBe("-");
    expect(formatLocalDateTime(new Date(Number.NaN))).toBe("-");
  });

  it("preserves invalid source strings and formats valid values locally", () => {
    const value = new Date("2026-09-03T08:30:00Z");
    expect(formatLocalDateTime("not-a-date")).toBe("not-a-date");
    expect(formatLocalDateTime(value)).toBe(value.toLocaleString());
    expect(formatLocalDateTime(value.toISOString())).toBe(value.toLocaleString());
  });

  it("treats timezone-less backend timestamps as UTC", () => {
    expect(parseBackendDateTime("2026-09-03T08:30:00")?.toISOString()).toBe("2026-09-03T08:30:00.000Z");
    expect(parseBackendDateTime("2026-09-03T08:30:00+02:00")?.toISOString()).toBe("2026-09-03T06:30:00.000Z");
    expect(formatLocalDateTime("2026-09-03T08:30:00")).toBe(new Date("2026-09-03T08:30:00Z").toLocaleString());
    expect(parseBackendDateTime("not-a-date")).toBeNull();
  });

  it("centralizes elapsed-time buckets while clamping future timestamps", () => {
    const now = Date.parse("2026-09-03T10:45:30Z");
    expect(getBackendElapsedTime("2026-09-03T08:30:00Z", now)).toMatchObject({
      milliseconds: 8_130_000,
      minutes: 135,
      hours: 2,
      days: 0,
    });
    expect(getBackendElapsedTime("2026-09-04T08:30:00Z", now)).toMatchObject({
      milliseconds: 0,
      minutes: 0,
      hours: 0,
      days: 0,
    });
    expect(getBackendElapsedTime(undefined, now)).toBeNull();
  });
});
