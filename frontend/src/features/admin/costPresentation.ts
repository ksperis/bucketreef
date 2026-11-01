/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CostCoverage } from "../../api/cost";

type CostText = (
  message: string,
  values?: Record<string, string | number>,
) => string;

export function formatCostCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
  intlLocale: string,
): string {
  if (value === undefined || value === null) return "-";
  const code = currency || "EUR";
  return `${new Intl.NumberFormat(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${code}`;
}

export function formatCostCoverage(
  coverage: CostCoverage | null | undefined,
  text: CostText,
): string {
  if (!coverage) return "-";
  return text("{percent}% ({collected}/{total} days)", {
    percent: Math.round(coverage.coverage_ratio * 100),
    collected: coverage.days_collected,
    total: coverage.days_in_month,
  });
}

export function formatCostCoverageBreakdown(
  coverage: CostCoverage | null | undefined,
  text: CostText,
): string {
  if (!coverage) return text("Coverage unavailable");
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return text("Storage {storage}d · Usage {usage}d", {
    storage: storageDays,
    usage: usageDays,
  });
}

export function hasPartialCostSources(coverage?: CostCoverage | null): boolean {
  if (!coverage) return false;
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return storageDays !== usageDays;
}

export function isLowCostCoverage(coverage?: CostCoverage | null): boolean {
  return Boolean(coverage && coverage.days_collected > 0 && coverage.coverage_ratio < 0.8);
}
