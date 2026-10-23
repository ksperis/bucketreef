/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { decodeStorageOpsBucketRef } from "../../api/storageOps";
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import {
  encodeCephAdminBucketRef,
  getStorageOpsBucketName,
  getStorageOpsContextId,
  getStorageOpsContextName,
} from "./bucketOpsPresentation";

export type BucketOperationUiTarget = {
  bucketName: string;
  tenant?: string | null;
  contextId?: string | null;
  contextName?: string | null;
};

type CephAdminSelectionIdentity = [tenant: string, bucketName: string];

export function getBucketOpsSelectionKey(
  bucket: CephAdminBucket,
  isStorageOps: boolean,
): string {
  if (isStorageOps) return bucket.name;
  return JSON.stringify([
    String(bucket.tenant ?? "").trim(),
    bucket.name,
  ] satisfies CephAdminSelectionIdentity);
}

function decodeCephAdminSelectionKey(value: string): {
  bucketName: string;
  tenant: string | null;
} | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [tenant, bucketName] = parsed;
    if (typeof tenant !== "string" || typeof bucketName !== "string" || !bucketName.trim()) {
      return null;
    }
    return {
      bucketName: bucketName.trim(),
      tenant: tenant.trim() || null,
    };
  } catch {
    return null;
  }
}

export function buildStorageOpsBucketTargets(
  targets: readonly BucketOperationUiTarget[],
): Array<{ context_id: string; bucket_name: string }> {
  return targets.map((target) => {
    const contextId = target.contextId?.trim();
    if (!contextId) {
      throw new Error(`Missing context for bucket ${target.bucketName}.`);
    }
    return {
      context_id: contextId,
      bucket_name: target.bucketName,
    };
  });
}

export function buildCephAdminRgwBucketTargets(
  targets: readonly BucketOperationUiTarget[],
): Array<{ name: string; tenant: string }> {
  return targets.map((target) => ({
    name: target.bucketName,
    tenant: target.tenant?.trim() ?? "",
  }));
}

type BucketOpsSelectionProjectionInput = {
  allFilteredBucketNames: readonly string[] | null;
  allFilteredBucketNamesKey: string | null;
  isStorageOps: boolean;
  items: readonly CephAdminBucket[];
  selectedBuckets: ReadonlySet<string>;
  selectionQueryKey: string;
  total: number;
};

export function buildBucketOpsSelectionProjection({
  allFilteredBucketNames,
  allFilteredBucketNamesKey,
  isStorageOps,
  items,
  selectedBuckets,
  selectionQueryKey,
  total,
}: BucketOpsSelectionProjectionInput) {
  const selectedBucketKeys = Array.from(selectedBuckets).sort((left, right) =>
    left.localeCompare(right),
  );
  const selectedBucketItemByKey = new Map(
    items.map((bucket) => [getBucketOpsSelectionKey(bucket, isStorageOps), bucket]),
  );
  const selectedBucketList = selectedBucketKeys
    .map((selectionKey) => {
      if (isStorageOps) return selectionKey;
      const decoded = decodeCephAdminSelectionKey(selectionKey);
      return decoded
        ? encodeCephAdminBucketRef(decoded.bucketName, decoded.tenant)
        : "";
    })
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const selectedCount = selectedBuckets.size;
  const selectedOnPageCount = items.reduce(
    (count, bucket) =>
      count + (selectedBuckets.has(getBucketOpsSelectionKey(bucket, isStorageOps)) ? 1 : 0),
    0,
  );
  const hasResolvedFilteredNames =
    allFilteredBucketNamesKey === selectionQueryKey &&
    Array.isArray(allFilteredBucketNames) &&
    allFilteredBucketNames.length > 0;
  const selectedOnFilteredCount = hasResolvedFilteredNames
    ? allFilteredBucketNames.reduce(
        (count, bucketName) => count + (selectedBuckets.has(bucketName) ? 1 : 0),
        0,
      )
    : selectedOnPageCount;
  const allSelectedOnFiltered =
    hasResolvedFilteredNames &&
    total > 0 &&
    allFilteredBucketNames.length === total &&
    selectedOnFilteredCount === total;
  const fullyResolvedFilteredSelection =
    allSelectedOnFiltered && selectedCount === total && allFilteredBucketNames.length === total;
  const hiddenSelectedCount = Math.max(selectedCount - selectedOnPageCount, 0);
  const allSelectedOnPage = items.length > 0 && selectedOnPageCount === items.length;
  const headerChecked = hasResolvedFilteredNames ? allSelectedOnFiltered : allSelectedOnPage;
  const headerIndeterminate = hasResolvedFilteredNames
    ? selectedOnFilteredCount > 0 && !allSelectedOnFiltered
    : selectedOnPageCount > 0 && !allSelectedOnPage;

  const selectedOperationTargets: BucketOperationUiTarget[] = isStorageOps
    ? selectedBucketKeys
        .map((selectedName) => {
          const bucket = selectedBucketItemByKey.get(selectedName);
          if (bucket) {
            return {
              bucketName: getStorageOpsBucketName(bucket),
              contextId: getStorageOpsContextId(bucket),
              contextName: getStorageOpsContextName(bucket) || null,
            };
          }
          const decoded = decodeStorageOpsBucketRef(selectedName);
          return {
            bucketName: decoded?.bucketName ?? selectedName,
            contextId: decoded?.contextId ?? "",
          };
        })
        .filter((target) => target.bucketName.trim().length > 0)
    : selectedBucketKeys
        .flatMap((selectionKey) => {
          const bucket = selectedBucketItemByKey.get(selectionKey);
          if (bucket) {
            return [{
              bucketName: bucket.name,
              tenant: bucket.tenant ?? null,
            }];
          }
          const decoded = decodeCephAdminSelectionKey(selectionKey);
          return decoded
            ? [{ bucketName: decoded.bucketName, tenant: decoded.tenant }]
            : [];
        });

  const selectedUiTagSuggestions: BucketUiTagDefinition[] = Array.from(
    new Map(
      selectedBucketKeys
        .flatMap((selectedName) => selectedBucketItemByKey.get(selectedName)?.ui_tags ?? [])
        .map((tag) => [tag.id, tag]),
    ).values(),
  ).sort(
    (left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
      left.id - right.id,
  );

  return {
    allSelectedOnFiltered,
    fullyResolvedFilteredSelection,
    headerChecked,
    headerIndeterminate,
    hiddenSelectedCount,
    selectedBucketList,
    selectedCount,
    selectedOnFilteredCount,
    selectedOnPageCount,
    selectedOperationTargets,
    selectedUiTagSuggestions,
  };
}
