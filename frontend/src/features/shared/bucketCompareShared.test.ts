import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  bucketComparisonCancelledMessage,
  matchesBucketCompareRunFilters,
  normalizeBucketCompareParallelism,
  parseOptionalIsoDateTime,
  resolveBucketCompareRunSettlement,
  resolveBucketCompareRunError,
  summarizeBucketCompareRun,
  updateBucketCompareRunItem,
  updateBucketCompareRunProgress,
  updateBucketCompareConfigFeatures,
  useBucketCompareConfigFeatures,
  useBucketCompareRunState,
  useBucketCompareWorkflowState,
} from "./bucketCompareShared";

describe("bucket comparison configuration state", () => {
  it("centralizes run validation order and parallelism bounds", () => {
    const messages = {
      targetRequired: "target",
      scopeRequired: "scope",
      configFeatureRequired: "config",
      invalidCutoff: "cutoff",
    };
    const ready = {
      targetSelected: true,
      hasScopeSelected: true,
      includeConfig: false,
      hasConfigFeatureSelected: true,
      ignoreModifiedAfterInvalid: false,
      planError: null,
      messages,
    };

    expect(resolveBucketCompareRunError(ready)).toBeNull();
    expect(resolveBucketCompareRunError({ ...ready, targetSelected: false })).toBe("target");
    expect(resolveBucketCompareRunError({ ...ready, hasScopeSelected: false })).toBe("scope");
    expect(
      resolveBucketCompareRunError({
        ...ready,
        includeConfig: true,
        hasConfigFeatureSelected: false,
      })
    ).toBe("config");
    expect(resolveBucketCompareRunError({ ...ready, ignoreModifiedAfterInvalid: true })).toBe("cutoff");
    expect(resolveBucketCompareRunError({ ...ready, planError: "mapping" })).toBe("mapping");

    expect(normalizeBucketCompareParallelism(Number.NaN)).toBe(4);
    expect(normalizeBucketCompareParallelism(0)).toBe(1);
    expect(normalizeBucketCompareParallelism(8.9)).toBe(8);
    expect(normalizeBucketCompareParallelism(99)).toBe(20);
  });

  it("updates selected configuration features in canonical order", () => {
    const ordered = ["versioning", "policy", "tags"] as const;

    expect(
      updateBucketCompareConfigFeatures(["tags"], ordered, "versioning", true)
    ).toEqual(["versioning", "tags"]);
    expect(
      updateBucketCompareConfigFeatures(
        ["versioning", "policy"],
        ordered,
        "versioning",
        false
      )
    ).toEqual(["policy"]);
  });

  it("owns canonically ordered configuration feature selection", () => {
    const orderedFeatures = ["versioning", "policy", "tags"] as const;
    const { result } = renderHook(() =>
      useBucketCompareConfigFeatures(orderedFeatures)
    );

    act(() => result.current.toggleConfigFeature("policy", false));
    expect(result.current.selectedConfigFeatures).toEqual(["versioning", "tags"]);

    act(() => result.current.setSelectedConfigFeatures(["tags"]));
    act(() => result.current.toggleConfigFeature("policy", true));
    expect(result.current.selectedConfigFeatures).toEqual(["policy", "tags"]);
  });

  it("derives comparison readiness and mapping state in the shared workflow", () => {
    type TestRunItem = {
      status: "pending" | "running" | "success" | "failed" | "cancelled";
      result?: string;
      error?: string;
    };
    const { result } = renderHook(() =>
      useBucketCompareWorkflowState<"versioning", string, TestRunItem>({
        targetSelected: true,
        targetKind: "context",
        sourceBuckets: ["alpha"],
        targetBuckets: ["alpha"],
        sameTargetSelected: false,
        configFeatures: ["versioning"],
      })
    );

    expect(result.current.comparePlan).toEqual({
      mappings: [{ sourceBucket: "alpha", targetBucket: "alpha" }],
      error: null,
    });
    expect(result.current.progressPercent).toBe(0);
    expect(result.current.hasScopeSelected).toBe(true);
    expect(result.current.hasConfigFeatureSelected).toBe(true);
    expect(result.current.ignoreModifiedAfterIso).toBeNull();
    expect(result.current.ignoreModifiedAfterInvalid).toBe(false);
    expect(result.current.resultFilters).toEqual({
      search: "",
      status: "all",
      differences: "all",
    });

    act(() => result.current.setIncludeContent(false));
    expect(result.current.hasScopeSelected).toBe(false);

    act(() => result.current.setIgnoreModifiedAfter("invalid-date"));
    expect(result.current.ignoreModifiedAfterIso).toBeNull();
    expect(result.current.ignoreModifiedAfterInvalid).toBe(true);

    act(() => {
      result.current.setResultSearch("archive");
      result.current.setStatusFilter("success");
      result.current.setDiffFilter("with_diff");
    });
    expect(result.current.resultFilters).toEqual({
      search: "archive",
      status: "success",
      differences: "with_diff",
    });
    act(() => result.current.resetResultFilters());
    expect(result.current.resultFilters).toEqual({
      search: "",
      status: "all",
      differences: "all",
    });

    act(() =>
      result.current.setProgress({
        completed: 1,
        total: 2,
        failed: 0,
        cancelled: 0,
      })
    );
    expect(result.current.progressPercent).toBe(50);
  });

  it("owns comparison run lifecycle and cancellation in the shared workflow", async () => {
    type TestRunItem = {
      status: "pending" | "running" | "success" | "failed" | "cancelled";
      result?: string;
      error?: string;
    };
    const { result } = renderHook(() =>
      useBucketCompareWorkflowState<"versioning", string, TestRunItem>({
        targetSelected: true,
        targetKind: "context",
        sourceBuckets: ["alpha"],
        targetBuckets: ["alpha"],
        sameTargetSelected: false,
        configFeatures: ["versioning"],
      })
    );

    act(() => result.current.beginRun([{ status: "pending" }]));
    expect(result.current.running).toBe(true);
    expect(result.current.stopping).toBe(false);
    expect(result.current.progress).toEqual({
      completed: 0,
      total: 1,
      failed: 0,
      cancelled: 0,
    });

    await act(async () => {
      await expect(
        result.current.executeRunItem(0, async (signal) => {
          expect(signal.aborted).toBe(false);
          return "done";
        })
      ).resolves.toBe("done");
    });
    expect(result.current.items[0]?.status).toBe("running");

    act(() => result.current.settleRunItem({ status: "fulfilled", value: "done" }, 0));
    expect(result.current.items[0]).toEqual({ status: "success", result: "done" });

    act(() => result.current.beginRun([{ status: "pending" }]));
    let stopped = false;
    act(() => {
      stopped = result.current.stopRun();
    });
    expect(stopped).toBe(true);
    expect(result.current.stopping).toBe(true);
    expect(result.current.items[0]).toEqual({
      status: "cancelled",
      error: bucketComparisonCancelledMessage,
    });

    act(() => result.current.finishRun());
    expect(result.current.running).toBe(false);
    expect(result.current.stopping).toBe(false);
    expect(result.current.stopRun()).toBe(false);
  });
});

describe("bucket comparison run settlement", () => {
  it("turns fulfilled comparisons into successful run items", () => {
    const settlement = resolveBucketCompareRunSettlement(
      { status: "fulfilled", value: { has_differences: false } },
      false
    );

    expect(
      updateBucketCompareRunItem(
        { status: "running" as const, sourceBucket: "source", actionRunning: null },
        settlement
      )
    ).toEqual({
      status: "success",
      sourceBucket: "source",
      actionRunning: null,
      result: { has_differences: false },
    });
    expect(
      updateBucketCompareRunProgress(
        { completed: 1, total: 3, failed: 0, cancelled: 0 },
        settlement
      )
    ).toEqual({ completed: 2, total: 3, failed: 0, cancelled: 0 });
  });

  it("owns run progress, items, and cancellation interpretation", () => {
    const { result } = renderHook(() =>
      useBucketCompareRunState<
        { has_differences: boolean },
        {
          sourceBucket: string;
          targetBucket: string;
          status: "pending" | "running" | "success" | "failed" | "cancelled";
          result?: { has_differences: boolean };
          error?: string;
        }
      >()
    );

    act(() => {
      result.current.setProgress({ completed: 0, total: 1, failed: 0, cancelled: 0 });
      result.current.setItems([
        { sourceBucket: "alpha", targetBucket: "bravo", status: "running" },
      ]);
    });
    act(() => {
      result.current.settleRunItem(
        { status: "fulfilled", value: { has_differences: true } },
        0
      );
    });

    expect(result.current.progress).toEqual({
      completed: 1,
      total: 1,
      failed: 0,
      cancelled: 0,
    });
    expect(result.current.items[0]).toMatchObject({
      status: "success",
      result: { has_differences: true },
    });
  });

  it("normalizes rejected and explicitly cancelled comparisons", () => {
    const failed = resolveBucketCompareRunSettlement(
      { status: "rejected", reason: new Error("Backend comparison failed") },
      false
    );
    const aborted = resolveBucketCompareRunSettlement(
      { status: "rejected", reason: new DOMException("Aborted", "AbortError") },
      false
    );
    const cancelledAfterSuccess = resolveBucketCompareRunSettlement(
      { status: "fulfilled", value: { has_differences: true } },
      true
    );

    expect(failed).toEqual({ status: "failed", error: "Backend comparison failed" });
    expect(aborted).toEqual({
      status: "cancelled",
      error: bucketComparisonCancelledMessage,
    });
    expect(cancelledAfterSuccess).toEqual({
      status: "cancelled",
      error: bucketComparisonCancelledMessage,
    });
    expect(
      updateBucketCompareRunProgress(
        { completed: 0, total: 2, failed: 0, cancelled: 0 },
        failed
      )
    ).toEqual({ completed: 1, total: 2, failed: 1, cancelled: 0 });
  });
});

describe("bucket comparison run presentation", () => {
  const items = [
    {
      sourceBucket: "Source Alpha",
      targetBucket: "archive",
      status: "success" as const,
      result: { has_differences: true },
    },
    {
      sourceBucket: "beta",
      targetBucket: "Target Beta",
      status: "success" as const,
      result: { has_differences: false },
    },
    {
      sourceBucket: "gamma",
      targetBucket: "archive",
      status: "success" as const,
    },
    {
      sourceBucket: "delta",
      targetBucket: "archive",
      status: "failed" as const,
      error: "Permission denied",
    },
    {
      sourceBucket: "epsilon",
      targetBucket: "archive",
      status: "cancelled" as const,
    },
  ];

  it("summarizes terminal statuses and results in one shared model", () => {
    expect(summarizeBucketCompareRun(items)).toEqual({
      success: 3,
      failed: 1,
      cancelled: 1,
      withDiff: 1,
    });
  });

  it("matches status, difference, and case-insensitive text filters", () => {
    expect(
      items.filter((item) =>
        matchesBucketCompareRunFilters(item, {
          search: "  permission ",
          status: "failed",
          differences: "all",
        })
      )
    ).toEqual([items[3]]);
    expect(
      items.filter((item) =>
        matchesBucketCompareRunFilters(item, {
          search: "TARGET BETA",
          status: "all",
          differences: "no_diff",
        })
      )
    ).toEqual([items[1]]);
    expect(
      items.filter((item) =>
        matchesBucketCompareRunFilters(item, {
          search: "source alpha",
          status: "all",
          differences: "with_diff",
        })
      )
    ).toEqual([items[0]]);
  });

  it("keeps successful results without an explicit difference flag in no-diff results", () => {
    expect(
      items.filter((item) =>
        matchesBucketCompareRunFilters(item, {
          search: "",
          status: "all",
          differences: "no_diff",
        })
      )
    ).toEqual([items[1], items[2]]);
  });
});

describe("parseOptionalIsoDateTime", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["not-a-date", null],
    ["2026-09-03T10:15:00Z", "2026-09-03T10:15:00.000Z"],
  ] as const)("parses %s", (value, expected) => {
    expect(parseOptionalIsoDateTime(value)).toBe(expected);
  });
});
