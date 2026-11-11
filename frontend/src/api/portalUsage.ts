/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import { buildS3AccountRequestConfig } from "./accountParams";
import type {
  BucketUsageStatsAggregateResponse,
  BucketUsageStatsSnapshot,
} from "./bucketUsageStats";
import client from "./client";
import type {
  ManagerTrafficStats,
  ManagerUsageTrendsResponse,
  TrafficWindow,
} from "./stats";
import type {
  UsageHistoryTrendResponse,
  UsageHistoryTrendWindow,
} from "./usageHistory";

export type PortalUsage = {
  used_bytes: number | null;
  used_objects: number | null;
  quota_max_size_bytes: number | null;
  quota_max_objects: number | null;
  max_buckets: number | null;
  storage_spaces: PortalUsageStorageSpace[];
  other_storage_space: PortalUsageStorageSpace | null;
};

export type PortalUsageStorageSpace = {
  id: string;
  name: string;
  used_bytes: number | null;
  object_count: number | null;
  quota_max_size_bytes: number | null;
  quota_max_objects: number | null;
};

export type PortalStorageSpaceUsageStatsSnapshot = Omit<
  BucketUsageStatsSnapshot,
  "scope_kind" | "scope_id" | "scope_name" | "bucket_name" | "warnings"
>;

type PortalStorageSpaceUsageStatsResponse = {
  snapshot: PortalStorageSpaceUsageStatsSnapshot | null;
};

export async function fetchPortalUsage(
  accountId: S3AccountSelector,
): Promise<PortalUsage> {
  const { data } = await client.get<PortalUsage>(
    "/portal/usage",
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function fetchPortalUsageTrends(
  accountId: S3AccountSelector,
): Promise<ManagerUsageTrendsResponse> {
  const { data } = await client.get<ManagerUsageTrendsResponse>(
    "/portal/usage-trends",
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function getPortalUsageStatsAggregate(
  accountId: S3AccountSelector,
): Promise<BucketUsageStatsAggregateResponse> {
  const { data } = await client.get<BucketUsageStatsAggregateResponse>(
    "/portal/usage-stats/latest",
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function fetchPortalStorageSpaceUsageStats(
  accountId: S3AccountSelector,
  spaceId: string,
): Promise<PortalStorageSpaceUsageStatsResponse> {
  const { data } = await client.get<PortalStorageSpaceUsageStatsResponse>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/usage-stats`,
    buildS3AccountRequestConfig(accountId),
  );
  return data;
}

export async function fetchPortalUsageHistoryTrends(
  accountId: S3AccountSelector,
  window: UsageHistoryTrendWindow,
): Promise<UsageHistoryTrendResponse> {
  const { data } = await client.get<UsageHistoryTrendResponse>(
    "/portal/usage-history-trends",
    buildS3AccountRequestConfig(accountId, { window }),
  );
  return data;
}

export async function fetchPortalTraffic(
  accountId: S3AccountSelector,
  window: TrafficWindow,
  bucket?: string,
): Promise<ManagerTrafficStats> {
  const baseParams: Record<string, string | number> = { window };
  if (bucket) {
    baseParams.bucket = bucket;
  }
  const { data } = await client.get<ManagerTrafficStats>(
    "/portal/traffic",
    buildS3AccountRequestConfig(accountId, baseParams),
  );
  return data;
}
