/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fetchAdminS3UserStats } from "../../api/stats";
import { useAdminStorageStats, type UseAdminStorageStatsResult } from "./useAdminStorageStats";

export function useAdminS3UserStats(
  userId: number | null,
  enabled: boolean = true,
): UseAdminStorageStatsResult {
  return useAdminStorageStats({
    id: userId,
    enabled,
    fetchStats: fetchAdminS3UserStats,
    unavailableMessage: "Storage metrics are not available for this user.",
  });
}
