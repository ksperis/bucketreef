/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { HealthCheckStatus } from "../../api/healthchecks";
import type { ManagerUsageTrendBaseline } from "../../api/stats";
import { getBackendRelativeTime } from "../../utils/dateTime";

export type ManagerDashboardTextFunction = (
  message: string,
  values?: Record<string, string | number>
) => string;

export type ManagerDashboardBucketRankingRow = {
  name: string;
  storageBytes: number | null;
  objectCount: number | null;
  percent: number;
};

export function formatManagerDashboardRelativeTime(
  value: string | null | undefined,
  text: ManagerDashboardTextFunction,
  now = Date.now()
): string {
  const relative = getBackendRelativeTime(value, now);
  if (!relative) return "";
  if (relative.unit === "now") return text("just now");
  if (relative.unit === "minutes") return text("{count}m ago", { count: relative.count });
  if (relative.unit === "hours") return text("{count}h ago", { count: relative.count });
  return text("{count}d ago", { count: relative.count });
}

export function localizeManagerDashboardTrendBaseline<
  T extends ManagerUsageTrendBaseline | null | undefined,
>(baseline: T, text: ManagerDashboardTextFunction): T {
  if (!baseline) return baseline;
  return { ...baseline, label: text(baseline.label) } as T;
}

export function formatManagerDashboardLatency(value?: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value)} ms`;
}

export function formatManagerDashboardQuotaValue(
  used: number | null | undefined,
  quota: number | null | undefined,
  formatter: (value: number) => string
): { current: string; quota: string | null } {
  if (used == null) return { current: "", quota: null };
  const usableQuota = quota != null && quota > 0 ? quota : null;
  return {
    current: formatter(used),
    quota: usableQuota == null ? null : formatter(usableQuota),
  };
}

export function formatManagerDashboardHealthStatus(status: HealthCheckStatus): string {
  if (status === "up") return "Operational";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Unknown";
}

export function buildManagerDashboardBucketRows(
  statsRows: Array<{ name: string; used_bytes?: number | null; object_count?: number | null }>
): ManagerDashboardBucketRankingRow[] {
  const rows = statsRows
    .filter((bucket) => bucket.name)
    .map((bucket) => ({
      name: bucket.name,
      storageBytes: bucket.used_bytes ?? null,
      objectCount: bucket.object_count ?? null,
      percent: 0,
    }))
    .sort((left, right) => (right.storageBytes ?? 0) - (left.storageBytes ?? 0))
    .slice(0, 5);
  const maxBytes = Math.max(...rows.map((row) => row.storageBytes ?? 0), 1);
  return rows.map((row) => ({
    ...row,
    percent: Math.max(4, ((row.storageBytes ?? 0) / maxBytes) * 100),
  }));
}

export function resolveManagerDashboardBucketCount(
  buckets: readonly unknown[],
  fallback?: number | null
): number | null {
  if (buckets.length > 0) return buckets.length;
  return fallback ?? null;
}
