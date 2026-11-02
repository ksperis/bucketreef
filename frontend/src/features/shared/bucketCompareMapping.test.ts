import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildBucketCompareMappingModel,
  mergeRawBucketCompareMappings,
  reconcileBucketCompareManualMapping,
  useBucketCompareManualMappingState,
} from "./bucketCompareMapping";

const buildModel = (
  overrides: Partial<Parameters<typeof buildBucketCompareMappingModel>[0]> = {},
) =>
  buildBucketCompareMappingModel({
    targetSelected: true,
    targetKind: "context",
    sourceBuckets: ["alpha", "beta"],
    targetBuckets: ["alpha", "gamma"],
    sameTargetSelected: false,
    mappingMode: "by_name",
    rawMapping: new Map(),
    manualMapping: {},
    ...overrides,
  });

describe("bucket comparison mapping model", () => {
  it("builds the by-name plan and reports missing targets", () => {
    const model = buildModel();

    expect(model.comparePlan).toEqual({
      mappings: [
        { sourceBucket: "alpha", targetBucket: "alpha" },
        { sourceBucket: "beta", targetBucket: "beta" },
      ],
      error: null,
    });
    expect(model.missingByName).toEqual(["beta"]);
  });

  it("resolves raw mappings before manual values and by-name fallbacks", () => {
    const model = buildModel({
      sourceBuckets: ["alpha", "beta", "gamma"],
      targetBuckets: ["alpha", "gamma"],
      mappingMode: "manual",
      rawMapping: new Map([["alpha", "raw-alpha"]]),
      manualMapping: { alpha: "manual-alpha", beta: "manual-beta" },
    });

    expect(Object.fromEntries(model.resolvedManualMapping)).toEqual({
      alpha: "raw-alpha",
      beta: "manual-beta",
      gamma: "gamma",
    });
    expect(model.comparePlan.mappings).toEqual([
      { sourceBucket: "alpha", targetBucket: "raw-alpha" },
      { sourceBucket: "beta", targetBucket: "manual-beta" },
      { sourceBucket: "gamma", targetBucket: "gamma" },
    ]);
  });

  it("excludes selected source buckets from same-target choices", () => {
    const model = buildModel({
      targetKind: "endpoint",
      targetBuckets: ["alpha", "beta", "archive"],
      sameTargetSelected: true,
      mappingMode: "manual",
      manualMapping: { alpha: "beta", beta: "archive" },
    });

    expect(model.availableTargetBucketNames).toEqual(["archive"]);
    expect(model.comparePlan).toEqual({
      mappings: [],
      error:
        "When source and target endpoint are the same, mapped target buckets must be outside the selected source set.",
    });
  });

  it("keeps target-specific validation messages in the shared plan", () => {
    expect(buildModel({ targetSelected: false }).comparePlan.error).toBe(
      "Select a target context.",
    );
    expect(
      buildModel({
        targetKind: "endpoint",
        sameTargetSelected: true,
      }).comparePlan.error,
    ).toBe("Same-endpoint comparison requires manual mapping.");
  });
});

describe("bucket comparison manual mapping state", () => {
  it("reconciles selected sources while preserving explicit manual targets", () => {
    expect(
      reconcileBucketCompareManualMapping({
        previous: { alpha: " custom-alpha ", stale: "archive" },
        sourceBuckets: ["alpha", "beta", "missing"],
        targetBuckets: ["alpha", "beta"],
        sameTargetSelected: false,
      }),
    ).toEqual({ alpha: "custom-alpha", beta: "beta" });
    expect(
      reconcileBucketCompareManualMapping({
        previous: { alpha: "beta", beta: "external" },
        sourceBuckets: ["alpha", "beta"],
        targetBuckets: ["alpha", "beta", "external"],
        sameTargetSelected: true,
      }),
    ).toEqual({ beta: "external" });
  });

  it("merges raw mappings only for selected sources and preserves identity when unchanged", () => {
    const previous = { alpha: "raw-alpha", beta: "manual-beta" };
    const rawMapping = new Map([
      ["alpha", "raw-alpha"],
      ["beta", "raw-beta"],
      ["stale", "raw-stale"],
    ]);

    expect(mergeRawBucketCompareMappings(previous, ["alpha"], rawMapping)).toBe(previous);
    expect(
      mergeRawBucketCompareMappings(previous, ["alpha", "beta"], rawMapping),
    ).toEqual({ alpha: "raw-alpha", beta: "raw-beta" });
  });

  it("owns manual and raw mapping transitions for comparison consumers", async () => {
    const sourceBuckets = ["alpha", "beta"];
    const targetBuckets = ["alpha", "beta", "archive"];
    const { result, rerender } = renderHook(
      ({ sameTargetSelected }) =>
        useBucketCompareManualMappingState({
          mappingMode: "manual",
          sourceBuckets,
          targetBuckets,
          sameTargetSelected,
        }),
      { initialProps: { sameTargetSelected: false } },
    );

    await waitFor(() => {
      expect(result.current.manualMapping).toEqual({ alpha: "alpha", beta: "beta" });
    });

    act(() => result.current.setRawMappingText("alpha => archive"));
    await waitFor(() => {
      expect(result.current.manualMapping).toEqual({ alpha: "archive", beta: "beta" });
    });

    rerender({ sameTargetSelected: true });
    await waitFor(() => {
      expect(result.current.manualMapping).toEqual({ alpha: "archive" });
    });
  });
});
