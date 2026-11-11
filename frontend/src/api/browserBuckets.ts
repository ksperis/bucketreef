/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3ExecutionContextSelector } from "./accountParams";
import type { BucketVersioningStatus } from "./bucketContracts";
import type {
  BrowserSettings,
  BrowserUsageSummary,
  BucketCorsStatus,
  PaginatedBrowserBucketsResponse,
} from "./browserContracts";
import { buildBrowserRequestConfig } from "./browserRequestHeaders";
import type { BrowserRequestOptions } from "./browserWorkspace";
import client from "./client";

export async function searchBrowserBuckets(
  contextId: S3ExecutionContextSelector,
  options?: {
    search?: string;
    exact?: boolean;
    page?: number;
    pageSize?: number;
    forceRefresh?: boolean;
  } & BrowserRequestOptions,
): Promise<PaginatedBrowserBucketsResponse> {
  const requestConfig = buildBrowserRequestConfig(
    contextId,
    options,
    {
      search: options?.search?.trim() || undefined,
      exact: options?.exact ? true : undefined,
      page: options?.page ?? undefined,
      page_size: options?.pageSize ?? undefined,
      force_refresh: options?.forceRefresh ? true : undefined,
    },
  );
  const { data } = await client.get<PaginatedBrowserBucketsResponse>(
    "/browser/buckets/search",
    requestConfig,
  );
  return data;
}

export async function fetchBrowserUsageSummary(
  contextId: S3ExecutionContextSelector,
  options?: BrowserRequestOptions,
): Promise<BrowserUsageSummary> {
  const { data } = await client.get<BrowserUsageSummary>(
    "/browser/usage-summary",
    buildBrowserRequestConfig(contextId, options),
  );
  return data;
}

export async function createBrowserBucket(
  contextId: S3ExecutionContextSelector,
  name: string,
  options: { versioning: boolean } & BrowserRequestOptions,
): Promise<void> {
  await client.post(
    "/browser/buckets",
    {
      name,
      versioning: options.versioning,
    },
    buildBrowserRequestConfig(contextId, options),
  );
}

export async function getBrowserBucketVersioning(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  options?: BrowserRequestOptions,
): Promise<BucketVersioningStatus> {
  const { data } = await client.get<BucketVersioningStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/versioning`,
    buildBrowserRequestConfig(contextId, options),
  );
  return data;
}

export async function fetchBrowserSettings(
  contextId: S3ExecutionContextSelector,
  options?: BrowserRequestOptions,
): Promise<BrowserSettings> {
  const { data } = await client.get<BrowserSettings>(
    "/browser/settings",
    buildBrowserRequestConfig(contextId, options),
  );
  return data;
}

export async function getBrowserBucketCorsStatus(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  origin?: string,
  options?: BrowserRequestOptions,
): Promise<BucketCorsStatus> {
  const { data } = await client.get<BucketCorsStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/cors`,
    buildBrowserRequestConfig(contextId, options, origin ? { origin } : undefined),
  );
  return data;
}

export async function ensureBrowserBucketCors(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  origin: string,
  options?: BrowserRequestOptions,
): Promise<BucketCorsStatus> {
  const { data } = await client.post<BucketCorsStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/cors/ensure`,
    { origin },
    buildBrowserRequestConfig(contextId, options),
  );
  return data;
}
