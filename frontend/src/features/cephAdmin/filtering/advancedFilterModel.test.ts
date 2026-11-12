import { describe, expect, it } from "vitest";

import {
  buildNumericFilterRule,
  buildNumericFilterFields,
  buildNumericFilterFieldStates,
  buildNumericFilterSummaryItems,
  countActiveNumericFilterFields,
  numericFilterRangeFieldHighlight,
} from "./advancedFilterModel";

describe("advancedFilterModel", () => {
  it("builds only finite numeric rules", () => {
    expect(buildNumericFilterRule("max_buckets", "gte", " 12 ")).toEqual([
      { field: "max_buckets", op: "gte", value: 12 },
    ]);
    expect(buildNumericFilterRule("max_buckets", "lte", "")).toEqual([]);
    expect(buildNumericFilterRule("max_buckets", "lte", "invalid")).toEqual([]);
  });

  it("builds numeric and percentage summary items", () => {
    expect(
      buildNumericFilterSummaryItems(
        { count: " 1200 ", invalid: "many", percent: "25", blank: " " },
        [
          { key: "count", label: "Count >=" },
          { key: "invalid", label: "Invalid" },
          { key: "percent", label: "Usage >=", format: "percent" },
          { key: "blank", label: "Blank" },
        ],
        "draft-",
      ),
    ).toEqual([
      { field: "count", id: "draft-count", label: "Count >= 1,200" },
      { field: "invalid", id: "draft-invalid", label: "Invalid many" },
      { field: "percent", id: "draft-percent", label: "Usage >= 25%" },
    ]);
  });

  it("builds numeric range fields and presentation state consistently", () => {
    const ranges = [{ label: "Max buckets", minKey: "minBuckets", maxKey: "maxBuckets" }] as const;
    const fields = buildNumericFilterFields(ranges);
    const usageFields = buildNumericFilterFields(ranges, "percent");

    expect(fields).toEqual([
      { key: "minBuckets", label: "Max buckets >=", format: "number" },
      { key: "maxBuckets", label: "Max buckets <=", format: "number" },
    ]);
    expect(usageFields[0]?.format).toBe("percent");

    const draft = { minBuckets: " 10 ", maxBuckets: "25" };
    const applied = { minBuckets: "10", maxBuckets: "20" };
    const states = buildNumericFilterFieldStates(draft, applied, fields);
    expect(states.minBuckets.labelClass).toContain("text-emerald-700");
    expect(states.maxBuckets.labelClass).toContain("text-amber-700");
    expect(numericFilterRangeFieldHighlight(draft, applied, "minBuckets", "maxBuckets").labelClass)
      .toContain("text-amber-700");
  });

  it("counts active numeric fields from the shared field definition", () => {
    expect(countActiveNumericFilterFields(
      { minBuckets: " 2 ", maxBuckets: "", ignored: "7" },
      ["minBuckets", "maxBuckets"],
    )).toBe(1);
  });
});
