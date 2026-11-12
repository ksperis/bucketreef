import { describe, expect, it } from "vitest";

import {
  buildQuotaAdvancedFilterRules,
  defaultQuotaAdvancedFilter,
  hasQuotaAdvancedFilters,
  quotaAdvancedNumericFields,
  quotaBaseAdvancedNumericFields,
  quotaUsageAdvancedNumericFields,
} from "./quotaAdvancedFilterModel";

describe("quotaAdvancedFilterModel", () => {
  it("keeps quota limits active when usage metrics are unavailable", () => {
    const advanced = {
      ...defaultQuotaAdvancedFilter,
      minQuotaBytes: "1024",
      minQuotaUsageSizePercent: "80",
    };

    expect(hasQuotaAdvancedFilters(advanced, false)).toBe(true);

    expect(buildQuotaAdvancedFilterRules(advanced, false)).toEqual([
      { field: "quota_max_size_bytes", op: "gte", value: 1024 },
    ]);
  });

  it("adds finite quota usage rules when metrics are available", () => {
    const advanced = {
      ...defaultQuotaAdvancedFilter,
      maxQuotaObjects: "invalid",
      minQuotaUsageObjectPercent: " 25 ",
    };

    expect(hasQuotaAdvancedFilters(advanced, true)).toBe(true);

    expect(buildQuotaAdvancedFilterRules(advanced, true)).toEqual([
      { field: "quota_usage_object_percent", op: "gte", value: 25 },
    ]);
  });

  it("derives base and usage numeric fields from the quota rule catalogue", () => {
    expect(quotaAdvancedNumericFields).toEqual([
      ...quotaBaseAdvancedNumericFields,
      ...quotaUsageAdvancedNumericFields,
    ]);
    expect(quotaBaseAdvancedNumericFields).toEqual([
      "minQuotaBytes",
      "maxQuotaBytes",
      "minQuotaObjects",
      "maxQuotaObjects",
    ]);
    expect(quotaUsageAdvancedNumericFields).toEqual([
      "minQuotaUsageSizePercent",
      "maxQuotaUsageSizePercent",
      "minQuotaUsageObjectPercent",
      "maxQuotaUsageObjectPercent",
    ]);
  });
});
