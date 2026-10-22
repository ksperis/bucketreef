/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import {
  buildBucketOpsNavigationTarget,
  type BucketOpsNavigationAction,
} from "./bucketOpsTableNavigation";
import {
  getStorageOpsBucketName,
  getStorageOpsContextId,
} from "./bucketOpsPresentation";
import type { BucketOpsMode } from "./bucketOpsSurface";
import useDetailsDrawerListNavigation from "./useDetailsDrawerListNavigation";

type UseBucketOpsNavigationOptions = {
  items: readonly CephAdminBucket[];
  mode: BucketOpsMode;
  selectedEndpointId: number | null;
};

type BucketConfigurationTarget = {
  bucketName: string;
  contextId: string | null;
  tenant: string | null;
};

export function getBucketOpsConfigurationRowKey(
  mode: BucketOpsMode,
  bucket: CephAdminBucket,
): string {
  if (mode === "storage-ops") {
    return `${encodeURIComponent(getStorageOpsContextId(bucket))}:${encodeURIComponent(
      getStorageOpsBucketName(bucket),
    )}`;
  }
  return `${encodeURIComponent(bucket.tenant ?? "")}:${encodeURIComponent(bucket.name)}`;
}

function findRowButton(rowKey: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-bucket-row-key]"),
    ).find((element) => element.dataset.bucketRowKey === rowKey) ?? null
  );
}

export function useBucketOpsNavigation({
  items,
  mode,
  selectedEndpointId,
}: UseBucketOpsNavigationOptions) {
  const navigate = useNavigate();

  const navigateToBucketAction = useCallback(
    (action: BucketOpsNavigationAction, bucket: CephAdminBucket) => {
      const target = buildBucketOpsNavigationTarget({
        action,
        bucket,
        mode,
        selectedEndpointId,
      });
      if (target) navigate(target);
    },
    [mode, navigate, selectedEndpointId],
  );

  const configurationTargetFromRow = useCallback(
    (bucket: CephAdminBucket): BucketConfigurationTarget | null => {
      if (mode === "storage-ops") {
        const contextId = getStorageOpsContextId(bucket);
        const bucketName = getStorageOpsBucketName(bucket);
        if (!contextId || !bucketName) return null;
        return { bucketName, contextId, tenant: null };
      }
      return {
        bucketName: bucket.name,
        contextId: null,
        tenant: bucket.tenant || null,
      };
    },
    [mode],
  );
  const configurationRowMatchesTarget = useCallback(
    (bucket: CephAdminBucket, target: BucketConfigurationTarget) => {
      if (mode === "ceph-admin") {
        return (
          bucket.name === target.bucketName &&
          (bucket.tenant || null) === target.tenant
        );
      }
      return (
        getStorageOpsBucketName(bucket) === target.bucketName &&
        getStorageOpsContextId(bucket) === target.contextId
      );
    },
    [mode],
  );
  const configurationRowKey = useCallback(
    (bucket: CephAdminBucket) => getBucketOpsConfigurationRowKey(mode, bucket),
    [mode],
  );
  const {
    close: closeBucketConfiguration,
    navigation: configurationNavigation,
    open: openBucketConfiguration,
    target: configurationTarget,
    viewedRowKey,
  } = useDetailsDrawerListNavigation({
    items,
    resetKey: `${mode}:${selectedEndpointId ?? "none"}`,
    targetFromRow: configurationTargetFromRow,
    rowMatchesTarget: configurationRowMatchesTarget,
    rowKey: configurationRowKey,
    findRowAction: findRowButton,
  });

  return {
    closeBucketConfiguration,
    configurationNavigation,
    configurationTarget,
    navigateToBucketAction,
    openBucketConfiguration,
    viewedRowKey,
  };
}
