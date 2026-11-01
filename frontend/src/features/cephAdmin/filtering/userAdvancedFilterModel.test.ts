import { describe, expect, it } from "vitest";

import {
  buildUserAdvancedFilterPayload,
  defaultUserAdvancedFilter,
  hasUserAdvancedFilters,
  resolveUserAdvancedFilterCost,
} from "./userAdvancedFilterModel";

describe("userAdvancedFilterModel", () => {
  it("serializes quick and advanced RGW user filters", () => {
    const advanced = {
      ...defaultUserAdvancedFilter,
      accountId: "RGW-1",
      minMaxBuckets: "10",
      minQuotaUsageSizePercent: "25",
      suspended: "active" as const,
    };

    expect(
      JSON.parse(buildUserAdvancedFilterPayload(advanced, "alice, bob", "contains", false) ?? "{}"),
    ).toEqual({
      match: "all",
      rules: [
        { field: "uid", op: "in", value: ["alice", "bob"] },
        { field: "account_id", op: "contains", value: "RGW-1" },
        { field: "max_buckets", op: "gte", value: 10 },
        { field: "suspended", op: "eq", value: false },
      ],
    });

    const metricsPayload = JSON.parse(
      buildUserAdvancedFilterPayload(advanced, "", "contains", true) ?? "{}",
    );
    expect(metricsPayload.rules).toContainEqual({
      field: "quota_usage_size_percent",
      op: "gte",
      value: 25,
    });
  });

  it("detects active filters and preserves the user-specific cost model", () => {
    expect(hasUserAdvancedFilters(defaultUserAdvancedFilter, true)).toBe(false);
    expect(resolveUserAdvancedFilterCost(defaultUserAdvancedFilter, true)).toEqual({
      activeCount: 0,
      directTextCount: 0,
      enrichedTextCount: 0,
      numericCount: 0,
      level: "none",
    });

    expect(resolveUserAdvancedFilterCost({ ...defaultUserAdvancedFilter, tenant: "tenant-a" }, true).level)
      .toBe("low");
    expect(resolveUserAdvancedFilterCost({ ...defaultUserAdvancedFilter, email: "a@example.test" }, true).level)
      .toBe("medium");
    expect(resolveUserAdvancedFilterCost({
      ...defaultUserAdvancedFilter,
      minMaxBuckets: "1",
      minQuotaBytes: "2",
      minQuotaObjects: "3",
      minQuotaUsageSizePercent: "4",
    }, true).level).toBe("high");
  });
});
