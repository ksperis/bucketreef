/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

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
import type { DetailsDrawerNavigationState } from "./DetailsDrawerNavigation";

const CONFIGURE_PARAM = "configure";
const CONFIGURE_CONTEXT_PARAM = "configure_ctx";

type UseBucketOpsNavigationOptions = {
  items: readonly CephAdminBucket[];
  mode: BucketOpsMode;
  selectedEndpointId: number | null;
};

type BucketConfigurationTarget = {
  bucketName: string;
  contextId: string | null;
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
  return encodeURIComponent(bucket.name);
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
  const location = useLocation();
  const navigate = useNavigate();
  const [requestedNavigationFocus, setRequestedNavigationFocus] = useState<
    "previous" | "next" | undefined
  >(undefined);

  const configurationTarget = useMemo<BucketConfigurationTarget | null>(() => {
    const params = new URLSearchParams(location.search);
    const bucketName = params.get(CONFIGURE_PARAM)?.trim() ?? "";
    if (!bucketName) return null;
    if (mode === "ceph-admin") {
      return { bucketName, contextId: null };
    }
    const contextId = params.get(CONFIGURE_CONTEXT_PARAM)?.trim() ?? "";
    if (!contextId) return null;
    return { bucketName, contextId };
  }, [location.search, mode]);

  const configuredBucketIndex = useMemo(() => {
    if (!configurationTarget) return -1;
    return items.findIndex((bucket) => {
      if (mode === "ceph-admin") {
        return bucket.name === configurationTarget.bucketName;
      }
      return (
        getStorageOpsBucketName(bucket) === configurationTarget.bucketName &&
        getStorageOpsContextId(bucket) === configurationTarget.contextId
      );
    });
  }, [configurationTarget, items, mode]);

  const viewedRowKey = useMemo(() => {
    if (configuredBucketIndex < 0) return null;
    return getBucketOpsConfigurationRowKey(mode, items[configuredBucketIndex]);
  }, [configuredBucketIndex, items, mode]);

  useEffect(() => {
    if (!viewedRowKey) return;
    const frame = window.requestAnimationFrame(() => {
      const rowButton = findRowButton(viewedRowKey);
      if (!rowButton) return;
      const bounds = rowButton.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        rowButton.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [viewedRowKey]);

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

  const updateConfigurationTarget = useCallback(
    (
      bucket: CephAdminBucket,
      options?: { replace?: boolean; focus?: "previous" | "next" },
    ) => {
      const params = new URLSearchParams(location.search);
      if (mode === "storage-ops") {
        const contextId = getStorageOpsContextId(bucket);
        const bucketName = getStorageOpsBucketName(bucket);
        if (!contextId || !bucketName) return;
        params.set(CONFIGURE_PARAM, bucketName);
        params.set(CONFIGURE_CONTEXT_PARAM, contextId);
      } else {
        params.set(CONFIGURE_PARAM, bucket.name);
        params.delete(CONFIGURE_CONTEXT_PARAM);
        if (selectedEndpointId) {
          params.set("ep", String(selectedEndpointId));
        }
      }
      setRequestedNavigationFocus(options?.focus);
      navigate(
        {
          pathname: location.pathname,
          search: params.size ? `?${params.toString()}` : "",
        },
        { replace: options?.replace ?? false },
      );
    },
    [location.pathname, location.search, mode, navigate, selectedEndpointId],
  );

  const openBucketConfiguration = useCallback(
    (bucket: CephAdminBucket) => {
      updateConfigurationTarget(bucket);
    },
    [updateConfigurationTarget],
  );

  const closeBucketConfiguration = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete(CONFIGURE_PARAM);
    params.delete(CONFIGURE_CONTEXT_PARAM);
    setRequestedNavigationFocus(undefined);
    navigate(
      {
        pathname: location.pathname,
        search: params.size ? `?${params.toString()}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  const configurationNavigation = useMemo<
    DetailsDrawerNavigationState | undefined
  >(() => {
    if (!configurationTarget || configuredBucketIndex < 0) return undefined;
    const previousBucket = items[configuredBucketIndex - 1];
    const nextBucket = items[configuredBucketIndex + 1];
    return {
      previous: previousBucket
        ? () =>
            updateConfigurationTarget(previousBucket, {
              replace: true,
              focus: "previous",
            })
        : undefined,
      next: nextBucket
        ? () =>
            updateConfigurationTarget(nextBucket, {
              replace: true,
              focus: "next",
            })
        : undefined,
      position: `${configuredBucketIndex + 1} / ${items.length}`,
      focus: requestedNavigationFocus,
      returnFocus: () =>
        viewedRowKey ? findRowButton(viewedRowKey) : null,
    };
  }, [
    configurationTarget,
    configuredBucketIndex,
    items,
    requestedNavigationFocus,
    updateConfigurationTarget,
    viewedRowKey,
  ]);

  return {
    closeBucketConfiguration,
    configurationNavigation,
    configurationTarget,
    navigateToBucketAction,
    openBucketConfiguration,
    viewedRowKey,
  };
}
