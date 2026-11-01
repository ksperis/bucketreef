/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { listBucketOptions } from "../../../api/managerBuckets";
import type { Bucket } from "../../../api/bucketContracts";
import { type ExecutionContext } from "../../../api/executionContexts";
import usePaginatedOptions from "../../../hooks/usePaginatedOptions";
import {
  getManagerMigration,
  listManagerMigrations,
  streamManagerMigration,
  type BucketMigrationDetail,
  type BucketMigrationListItem,
} from "../../../api/managerMigrations";
import { extractError, normalizeEndpointUrl } from "./shared";

export function useManagerSourceBuckets(sourceContextId: string) {
  const loadBucketOptions = useCallback(
    async (query: { page?: number; page_size?: number; search?: string }) => {
      try {
        return await listBucketOptions(sourceContextId, query);
      } catch (error) {
        throw new Error(extractError(error));
      }
    },
    [sourceContextId],
  );
  const catalog = usePaginatedOptions(loadBucketOptions, {
    enabled: Boolean(sourceContextId),
    initialPageSize: 25,
  });
  const sourceBuckets = useMemo<Bucket[]>(
    () => catalog.items.map((bucket) => ({ name: bucket.name })),
    [catalog.items],
  );

  return {
    sourceBuckets,
    bucketsLoading: catalog.loading,
    bucketsError: catalog.error,
    filter: catalog.search,
    setFilter: catalog.setSearch,
    page: catalog.page,
    setPage: catalog.setPage,
    pageSize: catalog.pageSize,
    setPageSize: catalog.setPageSize,
    total: catalog.total,
  };
}

export function useManagerMigrationsList(sourceContextId: string) {
  const [migrations, setMigrations] = useState<BucketMigrationListItem[]>([]);
  const [migrationsLoading, setMigrationsLoading] = useState(true);
  const [migrationsError, setMigrationsError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setMigrationsError(null);
    if (!sourceContextId) {
      setMigrations([]);
      return;
    }
    try {
      const items = await listManagerMigrations(100, sourceContextId);
      setMigrations(items);
    } catch (error) {
      setMigrationsError(extractError(error));
    }
  }, [sourceContextId]);

  useEffect(() => {
    setMigrationsLoading(true);
    refresh().finally(() => setMigrationsLoading(false));
    const interval = window.setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return {
    migrations,
    migrationsLoading,
    migrationsError,
    refresh,
    setMigrations,
  };
}

export function useManagerMigrationDetail(migrationId: number | null) {
  const [migrationDetail, setMigrationDetail] = useState<BucketMigrationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(migrationId));
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailStreamAbortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!migrationId) {
      setMigrationDetail(null);
      return;
    }
    setDetailError(null);
    setLoadFailure(null);
    const detail = await getManagerMigration(migrationId);
    setMigrationDetail(detail);
  }, [migrationId]);

  useEffect(() => {
    if (!migrationId) {
      detailStreamAbortRef.current?.abort();
      detailStreamAbortRef.current = null;
      setMigrationDetail(null);
      setDetailLoading(false);
      return;
    }

    let canceled = false;
    let fallbackInterval: number | null = null;

    const stopFallbackPolling = () => {
      if (fallbackInterval == null) return;
      window.clearInterval(fallbackInterval);
      fallbackInterval = null;
    };

    const applyDetail = (detail: BucketMigrationDetail) => {
      if (canceled) return;
      setMigrationDetail(detail);
      setDetailError(null);
      setLoadFailure(null);
    };

    const runFallbackPolling = () => {
      if (fallbackInterval != null) return;
      void getManagerMigration(migrationId)
        .then((detail) => {
          if (!canceled) applyDetail(detail);
        })
        .catch((error) => { if (!canceled) setDetailError(`Live updates unavailable: ${extractError(error)}`); });
      fallbackInterval = window.setInterval(() => {
        getManagerMigration(migrationId)
          .then((detail) => {
            if (!canceled) applyDetail(detail);
          })
          .catch((error) => { if (!canceled) setDetailError(`Live updates unavailable: ${extractError(error)}`); });
      }, 3000);
    };

    detailStreamAbortRef.current?.abort();
    const streamAbortController = new AbortController();
    detailStreamAbortRef.current = streamAbortController;

    setMigrationDetail(null);
    setLoadFailure(null);
    setDetailLoading(true);
    setDetailError(null);
    getManagerMigration(migrationId)
      .then((detail) => {
        applyDetail(detail);
      })
      .catch((error) => {
        if (canceled) return;
        setLoadFailure(error);
        setDetailError(extractError(error));
      })
      .finally(() => {
        if (!canceled) setDetailLoading(false);
      });

    void streamManagerMigration(migrationId, {
      signal: streamAbortController.signal,
      onSnapshot: (detail) => {
        if (canceled) return;
        setDetailLoading(false);
        applyDetail(detail);
      },
    }).then(() => {
      if (!canceled) runFallbackPolling();
    }).catch(() => {
      if (canceled || streamAbortController.signal.aborted) return;
      runFallbackPolling();
    });

    return () => {
      canceled = true;
      streamAbortController.abort();
      if (detailStreamAbortRef.current === streamAbortController) {
        detailStreamAbortRef.current = null;
      }
      stopFallbackPolling();
    };
  }, [migrationId]);

  return {
    migrationDetail,
    setMigrationDetail,
    detailLoading,
    detailError,
    loadFailure,
    setDetailError,
    refresh,
  };
}

export function useCrossEndpointSelection(source: ExecutionContext | null, target: ExecutionContext | null): boolean {
  return useMemo(() => {
    if (!source || !target) return false;
    if (source.endpoint_id != null && target.endpoint_id != null) {
      return source.endpoint_id !== target.endpoint_id;
    }
    const sourceEndpointUrl = normalizeEndpointUrl(source.endpoint_url);
    const targetEndpointUrl = normalizeEndpointUrl(target.endpoint_url);
    if (sourceEndpointUrl && targetEndpointUrl) {
      return sourceEndpointUrl !== targetEndpointUrl;
    }
    return false;
  }, [source, target]);
}
