/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import {
  getStorageOpsBucketName,
  getStorageOpsContextId,
} from "./bucketOpsPresentation";
import type { BucketOpsMode } from "./bucketOpsSurface";

export type BucketOpsNavigationAction = "browser" | "manager";

type BucketOpsNavigationTarget = {
  pathname: string;
  search: string;
};

type BuildBucketOpsNavigationTargetInput = {
  action: BucketOpsNavigationAction;
  bucket: CephAdminBucket;
  mode: BucketOpsMode;
  selectedEndpointId: number | null | undefined;
};

function withSearchParams(
  pathname: string,
  values: Readonly<Record<string, string>>,
): BucketOpsNavigationTarget {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => params.set(key, value));
  return { pathname, search: `?${params.toString()}` };
}

export function buildBucketOpsNavigationTarget({
  action,
  bucket,
  mode,
  selectedEndpointId,
}: BuildBucketOpsNavigationTargetInput): BucketOpsNavigationTarget | null {
  if (action === "browser") {
    if (mode !== "ceph-admin" || !selectedEndpointId) return null;
    return withSearchParams("/ceph-admin/browser", {
      ep: String(selectedEndpointId),
      bucket: bucket.name,
    });
  }

  if (mode === "ceph-admin") return null;

  if (action !== "manager") return null;
  const contextId = getStorageOpsContextId(bucket);
  const bucketName = getStorageOpsBucketName(bucket);
  if (!contextId || !bucketName) return null;
  return withSearchParams(
    `/manager/buckets/${encodeURIComponent(bucketName)}`,
    { ctx: contextId },
  );
}
