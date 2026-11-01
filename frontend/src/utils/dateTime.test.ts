import {
  dateTimeLocalInputToIsoString,
  formatDateTimeLocalInput,
  formatLocalDateTime,
  getBackendElapsedTime,
  getBackendRelativeTime,
  parseBackendDateTime,
} from "./dateTime";

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

  it("classifies backend timestamps into shared relative-time units", () => {
    const now = Date.parse("2026-09-03T10:45:30Z");
    expect(getBackendRelativeTime("2026-09-03T10:45:15Z", now)).toMatchObject({ unit: "now", count: 0 });
    expect(getBackendRelativeTime("2026-09-03T10:20:30Z", now)).toMatchObject({ unit: "minutes", count: 25 });
    expect(getBackendRelativeTime("2026-09-03T08:30:00Z", now)).toMatchObject({ unit: "hours", count: 2 });
    expect(getBackendRelativeTime("2026-08-31T08:30:00Z", now)).toMatchObject({ unit: "days", count: 3 });
    expect(getBackendRelativeTime("2026-09-04T08:30:00Z", now)).toMatchObject({ unit: "now", count: 0 });
    expect(getBackendRelativeTime(undefined, now)).toBeNull();
  });

  it("formats and parses datetime-local input values", () => {
    const value = new Date("2026-10-11T10:00:00Z");
    const localInput = formatDateTimeLocalInput(value);
    expect(localInput).toMatch(/^2026-10-11T\d{2}:\d{2}$/);
    expect(dateTimeLocalInputToIsoString(localInput)).toBe(value.toISOString());
    expect(formatDateTimeLocalInput("invalid")).toBe("");
    expect(dateTimeLocalInputToIsoString("invalid")).toBe("");
  });
});
