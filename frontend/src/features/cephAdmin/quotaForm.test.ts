/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import {
  parseOptionalNonNegativeInteger,
  parseQuotaBytes,
  quotaBytesToForm,
} from "./quotaForm";

describe("Ceph Admin quota form conversions", () => {
  describe("parseOptionalNonNegativeInteger", () => {
    it.each(["", "  ", "-1", "1.5", "Infinity"])("returns null for %j", (value) => {
      expect(parseOptionalNonNegativeInteger(value)).toBeNull();
    });

    it.each([
      ["0", 0],
      [" 42 ", 42],
    ])("parses %j as %d", (value, expected) => {
      expect(parseOptionalNonNegativeInteger(value)).toBe(expected);
    });
  });

  describe("parseQuotaBytes", () => {
    it.each(["", "  ", "-1", "Infinity"])("returns null for %j", (value) => {
      expect(parseQuotaBytes(value, "GiB")).toBeNull();
    });

    it("converts decimals using the selected unit and rounds to bytes", () => {
      expect(parseQuotaBytes("1537", "B")).toBe(1537);
      expect(parseQuotaBytes("1.5", "MiB")).toBe(1_572_864);
      expect(parseQuotaBytes("0.000000001", "GiB")).toBe(1);
      expect(parseQuotaBytes("2", "TiB")).toBe(2 * 1024 ** 4);
    });

    it("rejects a finite input whose byte conversion overflows", () => {
      expect(parseQuotaBytes("1e308", "TiB")).toBeNull();
    });
  });

  describe("quotaBytesToForm", () => {
    it.each([undefined, null, -1, NaN, Infinity])("returns the empty GiB form for %s", (value) => {
      expect(quotaBytesToForm(value)).toEqual({ value: "", unit: "GiB" });
    });

    it("prefers the largest exact unit", () => {
      expect(quotaBytesToForm(2 * 1024 ** 4)).toEqual({ value: "2", unit: "TiB" });
      expect(quotaBytesToForm(3 * 1024 ** 3)).toEqual({ value: "3", unit: "GiB" });
      expect(quotaBytesToForm(512 * 1024 ** 2)).toEqual({ value: "512", unit: "MiB" });
    });

    it("keeps zero distinct from an empty limit", () => {
      expect(quotaBytesToForm(0)).toEqual({ value: "0", unit: "GiB" });
    });

    it("uses bytes when a larger unit would round the limit", () => {
      expect(quotaBytesToForm(1024 ** 3 + 1)).toEqual({ value: "1073741825", unit: "B" });
    });

    it.each([0, 1, 1537, 1024 ** 2 - 1, 1024 ** 2 + 1, 1.5 * 1024 ** 2, 1024 ** 3 + 1, 3 * 1024 ** 4, Number.MAX_SAFE_INTEGER])(
      "round-trips %d bytes exactly",
      (bytes) => {
        const form = quotaBytesToForm(bytes);
        expect(parseQuotaBytes(form.value, form.unit)).toBe(bytes);
      },
    );

    it("round-trips byte offsets around each larger unit", () => {
      for (const unit of [1024 ** 2, 1024 ** 3, 1024 ** 4]) {
        for (let offset = -1024; offset <= 1024; offset++) {
          const bytes = unit + offset;
          const form = quotaBytesToForm(bytes);
          expect(parseQuotaBytes(form.value, form.unit)).toBe(bytes);
        }
      }
    });
  });
});
