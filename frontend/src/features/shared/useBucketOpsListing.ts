/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  shouldUsePostBucketListing,
  type BucketListingParams,
} from "../../api/bucketListingTransport";
import { isCancelledError } from "../../utils/apiError";
import type {
  CephAdminBucket,
  CephAdminBucketsStreamProgress,
  PaginatedCephAdminBucketsResponse,
} from "../../api/cephAdminBuckets";
import {
  FALLBACK_ADVANCED_PROGRESS,
  INACTIVE_ADVANCED_PROGRESS,
  PREPARING_ADVANCED_PROGRESS,
  progressFromAdvancedSearchEvent,
  type AdvancedSearchProgress,
} from "./advancedFilterShared";

type BucketSort = {
  field: string;
  direction: "asc" | "desc";
};

type UseBucketOpsListingParams = {
  selectedScopeId: number | null | undefined;
  page: number;
  pageSize: number;
  filterValue: string;
  advancedFilterParam?: string;
  advancedSearchEnabled: boolean;
  sort: BucketSort;
  includeParams: string[];
  requiresStats: boolean;
  baseRequiresStats: boolean;
  uiTagIds: number[];
  uiTagMatch: "any" | "all";
  extractError: (err: unknown) => string;
  listBuckets: (
    scopeId: number,
    params?: BucketListingParams,
    options?: { signal?: AbortSignal }
  ) => Promise<PaginatedCephAdminBucketsResponse>;
  streamBuckets: (
    scopeId: number,
    params?: BucketListingParams,
    options?: {
      signal?: AbortSignal;
      onProgress?: (event: CephAdminBucketsStreamProgress) => void;
    }
  ) => Promise<PaginatedCephAdminBucketsResponse>;
};

type UseBucketOpsListingResult = {
  items: CephAdminBucket[];
  total: number;
  loading: boolean;
  loadingDetails: boolean;
  advancedProgress: AdvancedSearchProgress;
  error: string | null;
  statsAvailable: boolean | null;
  statsScopeId: number | null;
  statsWarning: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  refresh: () => void;
};

const bucketRowKey = (bucket: CephAdminBucket) => `${bucket.tenant ?? ""}:${bucket.name}`;
const DETAILS_FETCH_DELAY_MS = 120;

export function useBucketOpsListing({
  selectedScopeId,
  page,
  pageSize,
  filterValue,
  advancedFilterParam,
  advancedSearchEnabled,
  sort,
  includeParams,
  requiresStats,
  baseRequiresStats,
  uiTagIds,
  uiTagMatch,
  extractError,
  listBuckets,
  streamBuckets,
}: UseBucketOpsListingParams): UseBucketOpsListingResult {
  const [items, setItems] = useState<CephAdminBucket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [advancedProgress, setAdvancedProgress] = useState<AdvancedSearchProgress>(INACTIVE_ADVANCED_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [statsAvailable, setStatsAvailable] = useState<boolean | null>(null);
  const [statsScopeId, setStatsScopeId] = useState<number | null>(null);
  const [statsWarning, setStatsWarning] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const uiTagIdsKey = uiTagIds.join(",");
  const stableUiTagIds = useMemo(
    () =>
      Array.from(
        new Set(
          uiTagIdsKey
            .split(",")
            .map((value) => Number(value))
            .filter((id) => Number.isInteger(id) && id > 0)
        )
      ),
    [uiTagIdsKey]
  );

  const refresh = useCallback(() => {
    setReloadNonce((prev) => prev + 1);
  }, []);

  const fetchBuckets = useCallback(async () => {
    if (!selectedScopeId) return;

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    requestAbortRef.current?.abort();
    const requestAbort = new AbortController();
    requestAbortRef.current = requestAbort;

    setLoading(true);
    setLoadingDetails(false);
    setItems([]);
    setTotal(0);
    setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
    setError(null);
    if (baseRequiresStats) {
      setStatsScopeId(selectedScopeId);
      setStatsAvailable(null);
      setStatsWarning(null);
    }

    try {
      const baseParams = {
        page,
        page_size: pageSize,
        filter: filterValue.trim() || undefined,
        advanced_filter: advancedFilterParam,
        sort_by: sort.field,
        sort_dir: sort.direction,
        with_stats: baseRequiresStats,
        ui_tag_ids: stableUiTagIds.length > 0 ? stableUiTagIds : undefined,
        ui_tag_match: uiTagMatch,
      };
      const canUseAdvancedStream =
        advancedSearchEnabled &&
        typeof advancedFilterParam === "string" &&
        advancedFilterParam.trim().startsWith("{") &&
        !shouldUsePostBucketListing(baseParams);

      let baseResponse;
      if (canUseAdvancedStream) {
        setAdvancedProgress(PREPARING_ADVANCED_PROGRESS);
        try {
          baseResponse = await streamBuckets(selectedScopeId, baseParams, {
            signal: requestAbort.signal,
            onProgress: (event: CephAdminBucketsStreamProgress) => {
              if (requestId !== requestSeqRef.current || requestAbort.signal.aborted) return;
              setAdvancedProgress(progressFromAdvancedSearchEvent(event));
            },
          });
        } catch (streamErr) {
          if (requestAbort.signal.aborted || isCancelledError(streamErr)) return;
          if (requestId !== requestSeqRef.current) return;
          setAdvancedProgress(FALLBACK_ADVANCED_PROGRESS);
          baseResponse = await listBuckets(selectedScopeId, baseParams, { signal: requestAbort.signal });
        }
      } else {
        baseResponse = await listBuckets(selectedScopeId, baseParams, { signal: requestAbort.signal });
      }

      if (requestAbort.signal.aborted) return;
      if (requestId !== requestSeqRef.current) return;

      const baseItems = baseResponse.items;
      setItems(baseItems);
      setTotal(baseResponse.total);
      if (baseRequiresStats) {
        setStatsScopeId(selectedScopeId);
        setStatsAvailable(baseResponse.stats_available);
        setStatsWarning(baseResponse.stats_warning);
      } else if (!baseResponse.stats_available) {
        setStatsScopeId(selectedScopeId);
        setStatsAvailable(false);
      }
      setLoading(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);

      const needsDetails = includeParams.length > 0 || (requiresStats && !baseRequiresStats);
      if (!needsDetails || baseItems.length === 0) return;

      const detailWithStats = requiresStats && baseResponse.stats_available;

      setLoadingDetails(true);
      try {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, DETAILS_FETCH_DELAY_MS);
        });
        if (requestAbort.signal.aborted) return;
        if (requestId !== requestSeqRef.current) return;

        const detailResponse = await listBuckets(
          selectedScopeId,
          {
            page,
            page_size: pageSize,
            filter: filterValue.trim() || undefined,
            advanced_filter: advancedFilterParam,
            sort_by: sort.field,
            sort_dir: sort.direction,
            include: includeParams.length > 0 ? includeParams : undefined,
            with_stats: detailWithStats,
            ui_tag_ids: stableUiTagIds.length > 0 ? stableUiTagIds : undefined,
            ui_tag_match: uiTagMatch,
          },
          { signal: requestAbort.signal }
        );
        if (requestAbort.signal.aborted) return;
        if (requestId !== requestSeqRef.current) return;

        const detailsByKey = new Map(detailResponse.items.map((bucket) => [bucketRowKey(bucket), bucket]));
        if (detailWithStats) {
          setStatsScopeId(selectedScopeId);
          setStatsAvailable(detailResponse.stats_available);
          setStatsWarning(detailResponse.stats_warning);
        } else if (!detailResponse.stats_available) {
          setStatsScopeId(selectedScopeId);
          setStatsAvailable(false);
        }
        setItems(baseItems.map((bucket) => detailsByKey.get(bucketRowKey(bucket)) ?? bucket));
      } finally {
        if (!requestAbort.signal.aborted && requestId === requestSeqRef.current) {
          setLoadingDetails(false);
        }
      }
    } catch (err) {
      if (requestAbort.signal.aborted || isCancelledError(err)) return;
      if (requestId !== requestSeqRef.current) return;
      console.error(err);
      setError(extractError(err));
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
    }
  }, [
    selectedScopeId,
    page,
    pageSize,
    filterValue,
    advancedFilterParam,
    advancedSearchEnabled,
    sort.field,
    sort.direction,
    includeParams,
    requiresStats,
    baseRequiresStats,
    stableUiTagIds,
    uiTagMatch,
    extractError,
    listBuckets,
    streamBuckets,
  ]);

  useEffect(() => {
    if (!selectedScopeId) {
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
      setStatsScopeId(null);
      setStatsAvailable(null);
      setStatsWarning(null);
      return;
    }
    void fetchBuckets();
  }, [selectedScopeId, fetchBuckets, reloadNonce]);

  useEffect(() => {
    return () => {
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, []);

  return {
    items,
    total,
    loading,
    loadingDetails,
    advancedProgress,
    error,
    statsAvailable,
    statsScopeId,
    statsWarning,
    setError,
    refresh,
  };
}
