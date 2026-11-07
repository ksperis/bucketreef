/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { timeoutForRequestProfile } from "./client";
import type { PaginatedResponse } from "./types";
import type { BucketUiTagDefinition } from "./bucketUiTags";
import type { BucketFeatureStatus, BucketTag } from "./bucketContracts";
import {
  buildBucketListingQuery,
  buildBucketListingRequestBody,
  shouldUsePostBucketListing,
  type BucketListingParams,
} from "./bucketListingTransport";
import {
  resolveApiBaseUrl,
  streamApiResultWithSse,
  type SseStreamOptions,
} from "./sseApiStream";
import type { CephAdminListingStreamProgress } from "./cephAdminEntityListing";
import type { RgwBucketReference } from "./bucketOperation";
import type {
  BucketCompareConfigDiff,
  BucketCompareConfigFeature,
  BucketCompareContentDiff,
} from "./bucketCompareContracts";

export type CephAdminBucket = {
  name: string;
  tenant: string | null;
  owner: string | null;
  owner_name: string | null;
  owner_suspended: boolean | null;
  used_bytes: number | null;
  object_count: number | null;
  quota_max_size_bytes: number | null;
  quota_max_objects: number | null;
  owner_used_bytes: number | null;
  owner_object_count: number | null;
  owner_quota_max_size_bytes: number | null;
  owner_quota_max_objects: number | null;
  tags: BucketTag[] | null;
  features: Record<string, BucketFeatureStatus> | null;
  column_details: Record<string, unknown> | null;
  ui_tags: BucketUiTagDefinition[];
};

export type PaginatedCephAdminBucketsResponse = PaginatedResponse<CephAdminBucket> & {
  stats_available: boolean;
  stats_warning: string | null;
};

type ListCephAdminBucketsOptions = {
  signal?: AbortSignal;
};

type CephAdminBucketListingCacheRefreshResponse = {
  refreshed: boolean;
  endpoint_id: number;
};

export type CephAdminBucketConfigBackupFeature =
  | "quota"
  | "versioning"
  | "object_lock"
  | "public_access_block"
  | "lifecycle"
  | "cors"
  | "policy"
  | "access_logging"
  | "tags";

type CephAdminBucketConfigBackupRequest = {
  buckets: RgwBucketReference[];
  features: CephAdminBucketConfigBackupFeature[];
};

type CephAdminBucketConfigBackupBucket = {
  name: string;
  tenant: string;
  configuration: Record<string, unknown>;
  errors: Record<string, string>;
};

type CephAdminBucketConfigBackupResponse = {
  kind: string;
  version: number;
  generated_at: string;
  source: {
    surface: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
  };
  features: CephAdminBucketConfigBackupFeature[];
  buckets: CephAdminBucketConfigBackupBucket[];
};

export async function listCephAdminBuckets(
  endpointId: number,
  params?: BucketListingParams,
  options?: ListCephAdminBucketsOptions
): Promise<PaginatedCephAdminBucketsResponse> {
  const usePost = shouldUsePostBucketListing(params);
  const { data } = usePost
    ? await client.post<PaginatedCephAdminBucketsResponse>(
        `/ceph-admin/endpoints/${endpointId}/buckets/query`,
        buildBucketListingRequestBody(params),
        {
          signal: options?.signal,
        }
      )
    : await client.get<PaginatedCephAdminBucketsResponse>(`/ceph-admin/endpoints/${endpointId}/buckets`, {
        params: buildBucketListingQuery(params),
        signal: options?.signal,
      });
  return data;
}

export async function refreshCephAdminBucketListingCache(
  endpointId: number
): Promise<CephAdminBucketListingCacheRefreshResponse> {
  const { data } = await client.post<CephAdminBucketListingCacheRefreshResponse>(
    `/ceph-admin/endpoints/${endpointId}/buckets/cache/refresh`
  );
  return data;
}

export async function backupCephAdminBucketConfigs(
  endpointId: number,
  payload: CephAdminBucketConfigBackupRequest,
  options?: { signal?: AbortSignal }
): Promise<CephAdminBucketConfigBackupResponse> {
  const { data } = await client.post<CephAdminBucketConfigBackupResponse>(
    `/ceph-admin/endpoints/${endpointId}/buckets/config-backup`,
    payload,
    { signal: options?.signal, timeout: timeoutForRequestProfile("long_running") }
  );
  return data;
}

export async function streamCephAdminBuckets(
  endpointId: number,
  params?: BucketListingParams,
  options?: SseStreamOptions<CephAdminListingStreamProgress>
): Promise<PaginatedCephAdminBucketsResponse> {
  const baseUrl = resolveApiBaseUrl();
  const query = buildBucketListingQuery(params);
  const queryText = query.toString();
  const url = `${baseUrl}/ceph-admin/endpoints/${endpointId}/buckets/stream${queryText ? `?${queryText}` : ""}`;
  return streamApiResultWithSse<CephAdminListingStreamProgress, PaginatedCephAdminBucketsResponse>({
    url,
    options,
    streamFailedLabel: "Advanced search stream failed",
    missingResultMessage: "Advanced search stream ended without a result payload",
  });
}

type CephAdminBucketCompareRequest = {
  target_endpoint_id: number;
  source: RgwBucketReference;
  target: RgwBucketReference;
  include_content?: boolean;
  include_config?: boolean;
  config_features?: BucketCompareConfigFeature[];
  ignore_modified_after?: string | null;
};

export type CephAdminBucketCompareResult = {
  source_endpoint_id: number;
  target_endpoint_id: number;
  source_bucket: string;
  target_bucket: string;
  source_tenant: string;
  target_tenant: string;
  has_differences: boolean;
  content_diff: BucketCompareContentDiff | null;
  config_diff: BucketCompareConfigDiff | null;
};

export async function compareCephAdminBucketPair(
  sourceEndpointId: number,
  payload: CephAdminBucketCompareRequest,
  options?: { signal?: AbortSignal }
): Promise<CephAdminBucketCompareResult> {
  const { data } = await client.post<CephAdminBucketCompareResult>(
    `/ceph-admin/endpoints/${sourceEndpointId}/buckets/compare`,
    payload,
    { signal: options?.signal, timeout: timeoutForRequestProfile("long_running") }
  );
  return data;
}
