/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { describe, expect, it } from "vitest";
import {
  buildManagerDashboardBucketRows,
  formatManagerDashboardHealthStatus,
  formatManagerDashboardLatency,
  formatManagerDashboardQuotaValue,
  formatManagerDashboardRelativeTime,
  localizeManagerDashboardTrendBaseline,
  resolveManagerDashboardBucketCount,
  type ManagerDashboardTextFunction,
} from "./managerDashboardModel";

const text: ManagerDashboardTextFunction = (message, values) =>
  message.replace("{count}", String(values?.count ?? ""));

describe("Manager dashboard model", () => {
  it("formats relative activity time without UI dependencies", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");

    expect(formatManagerDashboardRelativeTime("2026-11-02T12:00:00Z", text, now)).toBe("just now");
    expect(formatManagerDashboardRelativeTime("2026-11-02T11:42:00Z", text, now)).toBe("18m ago");
    expect(formatManagerDashboardRelativeTime("2026-11-02T09:00:00Z", text, now)).toBe("3h ago");
    expect(formatManagerDashboardRelativeTime("2026-10-30T12:00:00Z", text, now)).toBe("3d ago");
    expect(formatManagerDashboardRelativeTime(null, text, now)).toBe("");
  });

  it("localizes trend labels while preserving the baseline data", () => {
    const baseline = {
      window: "week" as const,
      label: "last week",
      period_start: "2026-10-26",
      used_bytes: 1024,
    };
    const localize: ManagerDashboardTextFunction = (message) => `translated:${message}`;

    expect(localizeManagerDashboardTrendBaseline(baseline, localize)).toEqual({
      ...baseline,
      label: "translated:last week",
    });
    expect(localizeManagerDashboardTrendBaseline(null, localize)).toBeNull();
  });

  it("formats health, latency, and quota values", () => {
    expect(formatManagerDashboardHealthStatus("up")).toBe("Operational");
    expect(formatManagerDashboardHealthStatus("degraded")).toBe("Degraded");
    expect(formatManagerDashboardHealthStatus("down")).toBe("Down");
    expect(formatManagerDashboardHealthStatus("unknown")).toBe("Unknown");
    expect(formatManagerDashboardLatency(12.6)).toBe("13 ms");
    expect(formatManagerDashboardLatency(null)).toBe("-");

    const formatter = (value: number) => `${value} units`;
    expect(formatManagerDashboardQuotaValue(null, 10, formatter)).toEqual({ current: "", quota: null });
    expect(formatManagerDashboardQuotaValue(4, 0, formatter)).toEqual({ current: "4 units", quota: null });
    expect(formatManagerDashboardQuotaValue(4, 10, formatter)).toEqual({ current: "4 units", quota: "10 units" });
  });

  it("ranks at most five buckets by storage and keeps a visible minimum bar", () => {
    expect(buildManagerDashboardBucketRows([
      { name: "empty", used_bytes: 0, object_count: 0 },
      { name: "largest", used_bytes: 100, object_count: 10 },
      { name: "middle", used_bytes: 25, object_count: 5 },
      { name: "fourth", used_bytes: 10, object_count: 4 },
      { name: "fifth", used_bytes: 5, object_count: 3 },
      { name: "sixth", used_bytes: 1, object_count: 2 },
      { name: "", used_bytes: 1000, object_count: 1 },
    ])).toEqual([
      { name: "largest", storageBytes: 100, objectCount: 10, percent: 100 },
      { name: "middle", storageBytes: 25, objectCount: 5, percent: 25 },
      { name: "fourth", storageBytes: 10, objectCount: 4, percent: 10 },
      { name: "fifth", storageBytes: 5, objectCount: 3, percent: 5 },
      { name: "sixth", storageBytes: 1, objectCount: 2, percent: 4 },
    ]);
  });

  it("prefers the loaded bucket list count and otherwise uses the fallback", () => {
    expect(resolveManagerDashboardBucketCount([{}, {}], 99)).toBe(2);
    expect(resolveManagerDashboardBucketCount([], 99)).toBe(99);
    expect(resolveManagerDashboardBucketCount([], null)).toBeNull();
  });
});
