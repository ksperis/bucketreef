/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fetchAdminAccountStats } from "../../api/stats";
import { useAdminStorageStats, type UseAdminStorageStatsResult } from "./useAdminStorageStats";

export function useAdminAccountStats(
  accountId: number | null,
  enabled: boolean = true,
  refreshKey?: string | null
): UseAdminStorageStatsResult {
  return useAdminStorageStats({
    id: accountId,
    enabled,
    refreshKey,
    fetchStats: fetchAdminAccountStats,
    unavailableMessage: "Storage metrics are not available for this account.",
  });
}
