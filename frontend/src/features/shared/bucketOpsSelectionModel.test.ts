/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import {
  buildBucketOpsSelectionProjection,
  buildStorageOpsBucketTargets,
  getBucketOpsSelectionKey,
} from "./bucketOpsSelectionModel";

const tag = (id: number, label: string): BucketUiTagDefinition => ({
  id,
  label,
  color_key: "neutral",
  scope: "standard",
  visibility: "private",
});

const bucket = (
  name: string,
  overrides: Partial<CephAdminBucket> = {},
): CephAdminBucket => ({ name, ...overrides });

const cephKey = (name: string, tenant: string | null = null) =>
  getBucketOpsSelectionKey(bucket(name, { tenant }), false);

const project = (
  overrides: Partial<Parameters<typeof buildBucketOpsSelectionProjection>[0]> = {},
) =>
  buildBucketOpsSelectionProjection({
    allFilteredBucketNames: null,
    allFilteredBucketNamesKey: null,
    isStorageOps: false,
    items: [bucket("alpha"), bucket("bravo")],
    selectedBuckets: new Set([cephKey("alpha"), cephKey("charlie")]),
    selectionQueryKey: "current",
    total: 3,
    ...overrides,
  });

describe("buildBucketOpsSelectionProjection", () => {
  it("projects page selection and hidden selections", () => {
    const result = project();

    expect(result.selectedBucketList).toEqual(["alpha", "charlie"]);
    expect(result.selectedCount).toBe(2);
    expect(result.selectedOnPageCount).toBe(1);
    expect(result.selectedOnFilteredCount).toBe(1);
    expect(result.hiddenSelectedCount).toBe(1);
    expect(result.headerChecked).toBe(false);
    expect(result.headerIndeterminate).toBe(true);
    expect(result.allSelectedOnFiltered).toBe(false);
    expect(result.fullyResolvedFilteredSelection).toBe(false);
  });

  it("recognizes a fully resolved filtered selection", () => {
    const result = project({
      allFilteredBucketNames: [cephKey("alpha"), cephKey("bravo")],
      allFilteredBucketNamesKey: "current",
      selectedBuckets: new Set([cephKey("alpha"), cephKey("bravo")]),
      total: 2,
    });

    expect(result.selectedOnFilteredCount).toBe(2);
    expect(result.allSelectedOnFiltered).toBe(true);
    expect(result.fullyResolvedFilteredSelection).toBe(true);
    expect(result.headerChecked).toBe(true);
    expect(result.headerIndeterminate).toBe(false);
  });

  it("does not treat extra hidden selections as the exact filtered selection", () => {
    const result = project({
      allFilteredBucketNames: [cephKey("alpha"), cephKey("bravo")],
      allFilteredBucketNamesKey: "current",
      selectedBuckets: new Set([cephKey("alpha"), cephKey("bravo"), cephKey("charlie")]),
      total: 2,
    });

    expect(result.allSelectedOnFiltered).toBe(true);
    expect(result.fullyResolvedFilteredSelection).toBe(false);
  });

  it("ignores a resolved-name cache from another query", () => {
    const result = project({
      allFilteredBucketNames: [cephKey("alpha"), cephKey("bravo")],
      allFilteredBucketNamesKey: "stale",
      selectedBuckets: new Set([cephKey("alpha"), cephKey("bravo")]),
      total: 2,
    });

    expect(result.selectedOnFilteredCount).toBe(2);
    expect(result.headerChecked).toBe(true);
    expect(result.allSelectedOnFiltered).toBe(false);
  });

  it("builds Ceph targets and sorted unique tag suggestions", () => {
    const alpha = tag(1, "Alpha");
    const zulu = tag(2, "zulu");
    const result = project({
      items: [
        bucket("alpha", { ui_tags: [zulu, alpha] }),
        bucket("bravo", { ui_tags: [alpha] }),
      ],
      selectedBuckets: new Set([cephKey("bravo"), cephKey("alpha")]),
      total: 2,
    });

    expect(result.selectedOperationTargets).toEqual([
      { bucketName: "alpha", tenant: null },
      { bucketName: "bravo", tenant: null },
    ]);
    expect(result.selectedUiTagSuggestions).toEqual([alpha, zulu]);
  });

  it("keeps same-name buckets from different tenants as separate Ceph targets", () => {
    const result = project({
      items: [
        bucket("shared", { tenant: "tenant-a" }),
        bucket("shared", { tenant: "tenant-b" }),
      ],
      selectedBuckets: new Set([
        cephKey("shared", "tenant-a"),
        cephKey("shared", "tenant-b"),
      ]),
      total: 2,
    });

    expect(result.selectedCount).toBe(2);
    expect(result.selectedOnPageCount).toBe(2);
    expect(result.selectedBucketList).toEqual([
      "tenant-a:shared",
      "tenant-b:shared",
    ]);
    expect(result.selectedOperationTargets).toEqual([
      { bucketName: "shared", tenant: "tenant-a" },
      { bucketName: "shared", tenant: "tenant-b" },
    ]);
  });

  it("uses current Storage Ops metadata and decodes off-page bucket references", () => {
    const result = project({
      isStorageOps: true,
      items: [
        bucket("context-a::encoded-alpha", {
          bucket_name: "alpha",
          context_id: "context-a",
          context_name: "Account A",
        }),
      ],
      selectedBuckets: new Set(["context-b::bravo", "context-a::encoded-alpha"]),
      total: 2,
    });

    expect(result.selectedOperationTargets).toEqual([
      {
        bucketName: "alpha",
        contextId: "context-a",
        contextName: "Account A",
      },
      { bucketName: "bravo", contextId: "context-b" },
    ]);
  });
});

describe("buildStorageOpsBucketTargets", () => {
  it("projects UI targets to the backend contract and trims context IDs", () => {
    expect(
      buildStorageOpsBucketTargets([
        { bucketName: "alpha", contextId: " context-a " },
        { bucketName: "bravo", contextId: "context-b", contextName: "Account B" },
      ]),
    ).toEqual([
      { bucket_name: "alpha", context_id: "context-a" },
      { bucket_name: "bravo", context_id: "context-b" },
    ]);
  });

  it("rejects targets without an execution context", () => {
    expect(() =>
      buildStorageOpsBucketTargets([{ bucketName: "alpha", contextId: " " }]),
    ).toThrow("Missing context for bucket alpha.");
  });
});
