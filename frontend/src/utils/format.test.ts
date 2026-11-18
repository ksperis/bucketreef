/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import { formatBytesAxis, formatCheckMode, formatLatency, formatNumber, formatSpacedCompactNumber } from "./format";

describe("formatNumber", () => {
  it("formats exact integers with the requested UI locale", () => {
    expect(formatNumber(1_000, "en-US")).toBe("1,000");
    expect(formatNumber(1_000_000, "en-US")).toBe("1,000,000");
    expect(formatNumber(1_000_000, "fr-FR")).toBe("1\u202f000\u202f000");
    expect(formatNumber(1_000_000, "de-DE")).toBe("1.000.000");
  });
});

describe("formatSpacedCompactNumber", () => {
  it.each([
    [undefined, "-"],
    [null, "-"],
    [999, "999"],
    [1_000, "1 K"],
    [1_200_000, "1.2 M"],
    [1_000_000_000, "1 B"],
  ] as const)("formats %s as %s", (value, expected) => {
    expect(formatSpacedCompactNumber(value)).toBe(expected);
  });
});

describe("formatBytesAxis", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0])(
    "formats %s as zero",
    (value) => {
      expect(formatBytesAxis(value)).toBe("0");
    }
  );

  it("uses one decimal below ten and no decimals otherwise", () => {
    expect(formatBytesAxis(9)).toBe("9.0 B");
    expect(formatBytesAxis(10)).toBe("10 B");
    expect(formatBytesAxis(1024)).toBe("1.0 KB");
    expect(formatBytesAxis(10 * 1024)).toBe("10 KB");
  });

  it("keeps very large values capped at terabytes", () => {
    expect(formatBytesAxis(1024 ** 5)).toBe("1024 TB");
  });
});

describe("formatCheckMode", () => {
  it("normalizes configured and missing healthcheck modes", () => {
    expect(formatCheckMode("s3")).toBe("S3");
    expect(formatCheckMode("http")).toBe("HTTP");
    expect(formatCheckMode(null)).toBe("HTTP");
    expect(formatCheckMode(undefined)).toBe("HTTP");
  });
});

describe("formatLatency", () => {
  it("preserves endpoint latency precision and formats missing values", () => {
    expect(formatLatency(12.5)).toBe("12.5 ms");
    expect(formatLatency(0)).toBe("0 ms");
    expect(formatLatency(null)).toBe("-");
    expect(formatLatency(undefined)).toBe("-");
  });
});
