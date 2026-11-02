/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { timeoutForRequestProfile } from "./client";
import type { S3ExecutionContextSelector } from "./accountParams";
import { withS3ContextParam } from "./accountParams";
import type { Bucket } from "./bucketContracts";
import type { PaginatedResponse } from "./types";
import type {
  BucketCompareConfigDiff,
  BucketCompareConfigFeature,
  BucketCompareContentDiff,
} from "./bucketCompareContracts";

const MANAGER_BUCKETS_PATH = "/manager/buckets";

export type FeatureRuleFeature = "lifecycle" | "policy" | "cors" | "notifications" | "tags";
export type FeatureRuleInventoryStatus = "configured" | "empty" | "unavailable";

export type FeatureRuleInventoryRule = {
  id: string;
  type: string;
  title: string;
  summary: string;
  chips: string[];
  raw: Record<string, unknown>;
};

export type FeatureRuleInventoryBucket = {
  bucket_name: string;
  feature: FeatureRuleFeature;
  status: FeatureRuleInventoryStatus;
  rules: FeatureRuleInventoryRule[];
  error: string | null;
};

type ManagerBucketOption = { name: string };

export async function listBucketOptions(
  contextId: S3ExecutionContextSelector,
  query: { page?: number; page_size?: number; search?: string },
): Promise<PaginatedResponse<ManagerBucketOption>> {
  const { data } = await client.get<PaginatedResponse<ManagerBucketOption>>(`${MANAGER_BUCKETS_PATH}/options`, {
    params: withS3ContextParam(query, contextId),
  });
  return data;
}

export async function listBuckets(
  contextId: S3ExecutionContextSelector,
  options?: { include?: string[]; with_stats?: boolean; signal?: AbortSignal }
): Promise<Bucket[]> {
  const { data } = await client.get<Bucket[]>(MANAGER_BUCKETS_PATH, {
    params: withS3ContextParam(
      {
        include: options?.include?.join(","),
        with_stats: options?.with_stats,
      },
      contextId
    ),
    signal: options?.signal,
  });
  return data;
}

export async function listFeatureRuleInventory(
  contextId: S3ExecutionContextSelector,
  feature: FeatureRuleFeature
): Promise<FeatureRuleInventoryBucket[]> {
  const { data } = await client.get<FeatureRuleInventoryBucket[]>("/manager/feature-rules", {
    params: withS3ContextParam({ feature }, contextId),
    timeout: timeoutForRequestProfile("long_running"),
  });
  return data;
}

type CreateBucketOptions = {
  versioning: boolean;
  locationConstraint?: string;
};

export async function createBucket(name: string, contextId: S3ExecutionContextSelector, options: CreateBucketOptions): Promise<void> {
  const locationConstraint = options.locationConstraint?.trim();
  await client.post(
    MANAGER_BUCKETS_PATH,
    {
      name,
      versioning: options.versioning,
      location_constraint: locationConstraint || undefined,
    },
    { params: withS3ContextParam(undefined, contextId) }
  );
}

export async function deleteBucket(name: string, contextId: S3ExecutionContextSelector): Promise<void> {
  await client.delete(`${MANAGER_BUCKETS_PATH}/${encodeURIComponent(name)}`, {
    params: withS3ContextParam(undefined, contextId),
  });
}

type ManagerBucketCompareRequest = {
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  include_content?: boolean;
  include_config?: boolean;
  config_features?: BucketCompareConfigFeature[];
  ignore_modified_after?: string | null;
};

export type ManagerBucketCompareResult = {
  source_context_id: string;
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  has_differences: boolean;
  content_diff: BucketCompareContentDiff | null;
  config_diff: BucketCompareConfigDiff | null;
};

export type ManagerBucketCompareAction = "sync_source_only" | "sync_different" | "delete_target_only";

type ManagerBucketCompareActionRequest = {
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  action: ManagerBucketCompareAction;
  object_keys: string[];
  parallelism?: number;
};

export type ManagerBucketCompareActionResult = {
  succeeded_count: number;
  failed_count: number;
  message: string;
};

export async function compareManagerBucketPair(
  sourceContextId: S3ExecutionContextSelector,
  payload: ManagerBucketCompareRequest,
  options?: { signal?: AbortSignal }
): Promise<ManagerBucketCompareResult> {
  const { data } = await client.post<ManagerBucketCompareResult>(
    `${MANAGER_BUCKETS_PATH}/compare`,
    payload,
    {
      params: withS3ContextParam(undefined, sourceContextId),
      signal: options?.signal,
      timeout: timeoutForRequestProfile("long_running"),
    }
  );
  return data;
}

export async function runManagerBucketCompareAction(
  sourceContextId: S3ExecutionContextSelector,
  payload: ManagerBucketCompareActionRequest,
  options?: { signal?: AbortSignal }
): Promise<ManagerBucketCompareActionResult> {
  const { data } = await client.post<ManagerBucketCompareActionResult>(
    `${MANAGER_BUCKETS_PATH}/compare/action`,
    payload,
    {
      params: withS3ContextParam(undefined, sourceContextId),
      signal: options?.signal,
      timeout: timeoutForRequestProfile("long_running"),
    }
  );
  return data;
}
