/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { listBucketOptions } from "../../api/managerBuckets";
import type { Bucket } from "../../api/bucketContracts";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import usePaginatedOptions from "../../hooks/usePaginatedOptions";
import { useExecutionContext } from "./ExecutionContextProvider";

export function useManagerBucketSelection() {
  const { contexts, selectedContextId, requiresContextSelection } = useExecutionContext();
  const sourceContextId = selectedContextId ?? "";
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());

  const sourceContext = useMemo(
    () => contexts.find((context) => context.id === sourceContextId) ?? null,
    [contexts, sourceContextId]
  );

  const loadBucketOptions = useCallback(
    async (query: { page?: number; page_size?: number; search?: string }) => {
      try {
        return await listBucketOptions(sourceContextId, query);
      } catch (requestError) {
        throw new Error(extractApiError(requestError, "Unable to load buckets."));
      }
    },
    [sourceContextId],
  );
  const catalog = usePaginatedOptions(loadBucketOptions, {
    enabled: Boolean(sourceContextId),
    initialPageSize: 25,
  });
  const filteredBuckets = useMemo<Bucket[]>(
    () => catalog.items.map((bucket) => ({ name: bucket.name })),
    [catalog.items],
  );

  useEffect(() => {
    setSelectedBuckets(new Set());
  }, [sourceContextId]);

  const selectedBucketList = useMemo(
    () => [...selectedBuckets].sort((left, right) => left.localeCompare(right)),
    [selectedBuckets]
  );

  const selectedTargets = useMemo(
    () =>
      selectedBucketList.map((bucketName) => ({
        bucketName,
        contextId: sourceContextId,
        contextName: sourceContext?.display_name ?? sourceContextId,
      })),
    [selectedBucketList, sourceContext?.display_name, sourceContextId]
  );

  const toggleBucket = (bucketName: string) => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      if (next.has(bucketName)) {
        next.delete(bucketName);
      } else {
        next.add(bucketName);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      filteredBuckets.forEach((bucket) => next.add(bucket.name));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedBuckets(new Set());
  };

  const tableStatus = resolveListTableStatus({
    loading: catalog.loading,
    error: catalog.error,
    rowCount: filteredBuckets.length,
  });

  return {
    clearSelection,
    error: catalog.error,
    filter: catalog.search,
    filteredBuckets,
    loading: catalog.loading,
    page: catalog.page,
    pageSize: catalog.pageSize,
    total: catalog.total,
    requiresContextSelection,
    selectedBucketList,
    selectedBuckets,
    selectedTargets,
    selectAllFiltered,
    setFilter: catalog.setSearch,
    setPage: catalog.setPage,
    setPageSize: catalog.setPageSize,
    sourceContext,
    sourceContextId,
    tableStatus,
    toggleBucket,
  };
}
