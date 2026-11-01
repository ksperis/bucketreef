import { describe, expect, it } from "vitest";

import {
  buildAccountAdvancedFilterPayload,
  defaultAccountAdvancedFilter,
  hasAccountAdvancedFilters,
  resolveAccountAdvancedFilterCost,
} from "./accountAdvancedFilterModel";

describe("accountAdvancedFilterModel", () => {
  it("serializes quick, profile, numeric, and metrics-gated account filters", () => {
    const advanced = {
      ...defaultAccountAdvancedFilter,
      accountName: "Analytics",
      minMaxUsers: "10",
      minBucketCount: "2",
      minQuotaUsageSizePercent: "80",
    };

    expect(
      JSON.parse(buildAccountAdvancedFilterPayload(advanced, "RGW-A, RGW-B", "contains", false) ?? "{}"),
    ).toEqual({
      match: "all",
      rules: [
        { field: "account_id", op: "in", value: ["RGW-A", "RGW-B"] },
        { field: "account_name", op: "contains", value: "Analytics" },
        { field: "max_users", op: "gte", value: 10 },
        { field: "bucket_count", op: "gte", value: 2 },
      ],
    });

    const metricsPayload = JSON.parse(
      buildAccountAdvancedFilterPayload(advanced, "", "contains", true) ?? "{}",
    );
    expect(metricsPayload.rules).toContainEqual({
      field: "quota_usage_size_percent",
      op: "gte",
      value: 80,
    });
  });

  it("detects active filters and preserves the account-specific cost tiers", () => {
    expect(hasAccountAdvancedFilters(defaultAccountAdvancedFilter, true)).toBe(false);
    expect(resolveAccountAdvancedFilterCost(defaultAccountAdvancedFilter, true)).toEqual({
      activeCount: 0,
      textCount: 0,
      numericCount: 0,
      level: "none",
    });

    expect(resolveAccountAdvancedFilterCost({
      ...defaultAccountAdvancedFilter,
      email: "ops@example.test",
    }, true).level).toBe("medium");

    expect(resolveAccountAdvancedFilterCost({
      ...defaultAccountAdvancedFilter,
      minMaxUsers: "1",
      maxMaxUsers: "2",
      minMaxBuckets: "3",
      maxMaxBuckets: "4",
      minQuotaBytes: "5",
      minQuotaObjects: "6",
    }, true).level).toBe("high");
  });
});
