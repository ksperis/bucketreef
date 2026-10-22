/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3ExecutionContextSelector } from "../../../api/accountParams";
import {
  getCephAdminBucketUsageStats,
  getManagerBucketUsageStats,
  streamCephAdminBucketUsageStatsForBucket,
  streamManagerBucketUsageStatsForBucket,
  type BucketUsageStatsSnapshot,
} from "../../../api/bucketUsageStats";
import { extractApiError, isCancelledError } from "../../../utils/apiError";
import {
  bucketUsageStatsErrorMessage,
  bucketUsageStatsMessage,
  useBucketUsageStatsI18n,
} from "../../shared/bucketUsageStatsMessage";

type UseBucketUsageStatsControllerOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName?: string;
  cephAdmin: boolean;
  cephAdminTenant?: string | null;
  enabled: boolean;
  endpointId?: number | null;
};

export function useBucketUsageStatsController({
  contextId,
  bucketName,
  cephAdmin,
  cephAdminTenant,
  enabled,
  endpointId,
}: UseBucketUsageStatsControllerOptions) {
  const { locale } = useBucketUsageStatsI18n();
  const [snapshot, setSnapshot] = useState<BucketUsageStatsSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const recalculationAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      setSnapshot(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let data;
      if (cephAdmin) {
        if (!endpointId) {
          setSnapshot(null);
          return;
        }
        data = await getCephAdminBucketUsageStats(endpointId, bucketName, cephAdminTenant);
      } else {
        data = await getManagerBucketUsageStats(contextId, bucketName);
      }
      setSnapshot(data.snapshot ?? null);
    } catch (loadFailure) {
      setSnapshot(null);
      setError(extractApiError(loadFailure, bucketUsageStatsMessage.loadError.en));
    } finally {
      setLoading(false);
    }
  }, [contextId, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const recalculate = useCallback(async () => {
    if (!bucketName || !enabled || recalculating || (cephAdmin && !endpointId)) return;
    const controller = new AbortController();
    recalculationAbortRef.current = controller;
    setRecalculating(true);
    setError(null);
    try {
      if (cephAdmin) {
        await streamCephAdminBucketUsageStatsForBucket(
          endpointId!,
          bucketName,
          cephAdminTenant,
          { signal: controller.signal },
        );
      } else {
        await streamManagerBucketUsageStatsForBucket(
          contextId,
          bucketName,
          { signal: controller.signal },
        );
      }
      await load();
    } catch (recalculationFailure) {
      if (!isCancelledError(recalculationFailure)) {
        setError(
          extractApiError(
            recalculationFailure,
            bucketUsageStatsMessage.recalculateError.en,
          ),
        );
      }
    } finally {
      if (recalculationAbortRef.current === controller) {
        recalculationAbortRef.current = null;
        setRecalculating(false);
      }
    }
  }, [contextId, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId, load, recalculating]);

  const cancelRecalculation = useCallback(() => {
    recalculationAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      recalculationAbortRef.current?.abort();
    };
  }, [contextId, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  return {
    cancelRecalculation,
    error: bucketUsageStatsErrorMessage(error, locale),
    load,
    loading,
    recalculate,
    recalculating,
    snapshot,
  };
}
