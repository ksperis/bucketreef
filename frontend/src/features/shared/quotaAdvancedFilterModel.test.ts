import { describe, expect, it } from "vitest";

import {
  appendQuotaAdvancedFilterRules,
  defaultQuotaAdvancedFilter,
  hasQuotaAdvancedFilters,
} from "./quotaAdvancedFilterModel";

describe("quotaAdvancedFilterModel", () => {
  it("keeps quota limits active when usage metrics are unavailable", () => {
    const advanced = {
      ...defaultQuotaAdvancedFilter,
      minQuotaBytes: "1024",
      minQuotaUsageSizePercent: "80",
    };

    expect(hasQuotaAdvancedFilters(advanced, false)).toBe(true);

    const rules: Array<Record<string, unknown>> = [];
    appendQuotaAdvancedFilterRules(rules, advanced, false);
    expect(rules).toEqual([
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

    const rules: Array<Record<string, unknown>> = [];
    appendQuotaAdvancedFilterRules(rules, advanced, true);
    expect(rules).toEqual([
      { field: "quota_usage_object_percent", op: "gte", value: 25 },
    ]);
  });
});
