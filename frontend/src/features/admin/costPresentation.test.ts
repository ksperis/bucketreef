import { describe, expect, it } from "vitest";
import type { CostCoverage } from "../../api/cost";
import {
  formatCostCoverage,
  formatCostCoverageBreakdown,
  formatCostCurrency,
  hasPartialCostSources,
  isLowCostCoverage,
} from "./costPresentation";

const coverage = (overrides: Partial<CostCoverage> = {}): CostCoverage => ({
  days_collected: 24,
  days_in_month: 31,
  coverage_ratio: 24 / 31,
  storage_days_collected: 24,
  usage_days_collected: 24,
  ...overrides,
});

const text = (message: string, values?: Record<string, string | number>) =>
  values
    ? Object.entries(values).reduce(
        (result, [key, value]) => result.replace(`{${key}}`, String(value)),
        message,
      )
    : message;

describe("costPresentation", () => {
  it("formats currency with the requested locale and default currency", () => {
    expect(formatCostCurrency(12.5, "EUR", "en-US")).toBe("12.50 EUR");
    expect(formatCostCurrency(12.5, null, "en-US")).toBe("12.50 EUR");
    expect(formatCostCurrency(null, "USD", "en-US")).toBe("-");
  });

  it("formats aggregate and source coverage", () => {
    expect(formatCostCoverage(coverage(), text)).toBe("77% (24/31 days)");
    expect(formatCostCoverageBreakdown(coverage(), text)).toBe("Storage 24d · Usage 24d");
    expect(formatCostCoverageBreakdown(coverage({ storage_days_collected: null, usage_days_collected: 20 }), text))
      .toBe("Storage 24d · Usage 20d");
    expect(formatCostCoverage(null, text)).toBe("-");
    expect(formatCostCoverageBreakdown(null, text)).toBe("Coverage unavailable");
  });

  it("detects partial sources and low non-empty coverage", () => {
    expect(hasPartialCostSources(coverage())).toBe(false);
    expect(hasPartialCostSources(coverage({ usage_days_collected: 20 }))).toBe(true);
    expect(isLowCostCoverage(coverage())).toBe(true);
    expect(isLowCostCoverage(coverage({ coverage_ratio: 0.8 }))).toBe(false);
    expect(isLowCostCoverage(coverage({ days_collected: 0, coverage_ratio: 0 }))).toBe(false);
    expect(hasPartialCostSources(null)).toBe(false);
    expect(isLowCostCoverage(null)).toBe(false);
  });
});
