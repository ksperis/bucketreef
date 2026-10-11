/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import type { ManagerStats } from "../../api/stats";
import { classifyApiError } from "../../utils/apiError";

type AdminStorageStatsFetcher = (id: number) => Promise<ManagerStats>;

type UseAdminStorageStatsOptions = {
  id: number | null;
  enabled?: boolean;
  refreshKey?: string | null;
  fetchStats: AdminStorageStatsFetcher;
  unavailableMessage: string;
};

export type UseAdminStorageStatsResult = {
  stats: ManagerStats | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useAdminStorageStats({
  id,
  enabled = true,
  refreshKey,
  fetchStats,
  unavailableMessage,
}: UseAdminStorageStatsOptions): UseAdminStorageStatsResult {
  const [stats, setStats] = useState<ManagerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || id == null) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setStats(null);
    try {
      setStats(await fetchStats(id));
      setError(null);
    } catch (reason) {
      const fallback = "Unable to load storage stats.";
      const failure = classifyApiError(reason, fallback);
      setError(
        failure.status === 403 && failure.message === fallback
          ? unavailableMessage
          : failure.message,
      );
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, fetchStats, id, unavailableMessage]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return { stats, loading, error, reload: load };
}
