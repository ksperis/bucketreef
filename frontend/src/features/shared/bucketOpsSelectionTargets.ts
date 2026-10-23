/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdminBuckets";
import { loadBucketOpsBucketsByNames } from "./bucketOpsNamedBucketLoader";
import {
  decodeCephAdminBucketRef,
  encodeCephAdminBucketRef,
} from "./bucketOpsPresentation";

type SelectionTarget = {
  key: string;
  name: string;
  tenant: string | null;
};

type SelectionTargetPage = {
  items: CephAdminBucket[];
  has_next: boolean;
};

type ResolveBucketOpsSelectionTargetsInput<Target extends SelectionTarget> = {
  bucketNames: readonly string[];
  isStorageOps: boolean;
  listBuckets: (
    scopeId: number,
    params: ListCephAdminBucketsParams,
  ) => Promise<SelectionTargetPage>;
  onProgress?: (progress: {
    completed: number;
    total: number;
    failed: number;
  }) => void;
  resolveTarget: (bucket: CephAdminBucket) => Target | null;
  scopeId: number | null;
};

export async function resolveBucketOpsSelectionTargets<
  Target extends SelectionTarget,
>({
  bucketNames,
  isStorageOps,
  listBuckets,
  onProgress,
  resolveTarget,
  scopeId,
}: ResolveBucketOpsSelectionTargetsInput<Target>): Promise<{
  targets: Target[];
  missingNames: string[];
}> {
  if (scopeId === null || bucketNames.length === 0) {
    return { targets: [], missingNames: [...bucketNames] };
  }

  const bucketsByName = await loadBucketOpsBucketsByNames({
    bucketKey: isStorageOps
      ? (bucket) => bucket.name
      : (bucket) => encodeCephAdminBucketRef(bucket.name, bucket.tenant),
    bucketNames,
    concurrency: 4,
    listBuckets,
    onProgress,
    queryBucketName: isStorageOps
      ? undefined
      : (bucketName) => decodeCephAdminBucketRef(bucketName).bucketName,
    scopeId,
    withStats: false,
  });
  const targetByKey = new Map<string, Target>();
  const resolvedNames = new Set<string>();
  bucketsByName.forEach((bucket, bucketKey) => {
    const target = resolveTarget(bucket);
    if (!target) return;
    targetByKey.set(target.key, target);
    resolvedNames.add(bucketKey);
  });

  return {
    missingNames: bucketNames.filter((name) => !resolvedNames.has(name)),
    targets: Array.from(targetByKey.values()).sort((left, right) => {
      if (left.name !== right.name) return left.name.localeCompare(right.name);
      return (left.tenant ?? "").localeCompare(right.tenant ?? "");
    }),
  };
}
