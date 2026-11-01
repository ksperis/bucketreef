/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import type { StorageStats } from "../../api/stats";
import { classifyApiError } from "../../utils/apiError";
import useAdminResourceController from "./useAdminResourceController";

type AdminStorageStatsFetcher = (id: number) => Promise<StorageStats>;

type UseAdminStorageStatsOptions = {
  id: number | null;
  enabled?: boolean;
  fetchStats: AdminStorageStatsFetcher;
  unavailableMessage: string;
};

export type UseAdminStorageStatsResult = {
  stats: StorageStats | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useAdminStorageStats({
  id,
  enabled = true,
  fetchStats,
  unavailableMessage,
}: UseAdminStorageStatsOptions): UseAdminStorageStatsResult {
  const loadStats = useCallback(
    () => (id == null ? Promise.resolve(null) : fetchStats(id)),
    [fetchStats, id],
  );
  const formatError = useCallback((reason: unknown) => {
    const fallback = "Unable to load storage stats.";
    const failure = classifyApiError(reason, fallback);
    return failure.status === 403 && failure.message === fallback
      ? unavailableMessage
      : failure.message;
  }, [unavailableMessage]);
  const active = enabled && id != null;
  const {
    resource,
    loading,
    error,
    refresh,
  } = useAdminResourceController<StorageStats | null>({
    loadResource: loadStats,
    initialResource: null,
    formatError,
    enabled: active,
  });
  const stats = active && !loading && !error ? resource : null;

  return { stats, loading, error, reload: refresh };
}
