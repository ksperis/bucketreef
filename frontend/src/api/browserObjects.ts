/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3ExecutionContextSelector } from "./accountParams";
import { buildBrowserRequestConfig } from "./browserRequestHeaders";
import { buildSseCustomerBackendHeaders } from "./browserSseCustomer";
import type {
  BrowserLazyColumnField,
  BrowserObjectColumnsResponse,
  BrowserObjectsQuery,
  CleanupObjectVersionsPayload,
  CleanupObjectVersionsResponse,
  CopyObjectPayload,
  DeleteObjectEntry,
  DeleteObjectsResponse,
  ListBrowserObjectsResponse,
  ListObjectVersionsResponse,
  ObjectAcl,
  ObjectAclUpdate,
  ObjectLegalHold,
  ObjectLegalHoldUpdate,
  ObjectMetadata,
  ObjectMetadataUpdate,
  ObjectRestoreRequest,
  ObjectRetention,
  ObjectRetentionUpdate,
  ObjectTags,
  ObjectTagsUpdate,
} from "./browserContracts";
import type { BrowserRequestOptions } from "./browserWorkspace";

export async function listBrowserObjects(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  options?: { prefix?: string; continuationToken?: string | null; maxKeys?: number; signal?: AbortSignal; forceRefresh?: boolean } & BrowserObjectsQuery & BrowserRequestOptions
): Promise<ListBrowserObjectsResponse> {
  const requestConfig = buildBrowserRequestConfig(
    contextId,
    options,
    {
      prefix: options?.prefix ?? "",
      continuation_token: options?.continuationToken ?? undefined,
      max_keys: options?.maxKeys ?? undefined,
      query: options?.query?.trim() || undefined,
      query_exact: options?.exactMatch ? true : undefined,
      query_case_sensitive: options?.caseSensitive ? true : undefined,
      item_type: options?.type && options.type !== "all" ? options.type : undefined,
      storage_class: options?.storageClass && options.storageClass !== "all" ? options.storageClass : undefined,
      recursive: options?.recursive ? true : undefined,
      include_folder_markers: options?.includeFolderMarkers ? true : undefined,
      force_refresh: options?.forceRefresh ? true : undefined,
      sort_by:
        options?.sortBy && !(options.sortBy === "name" && (options?.sortDir ?? "asc") === "asc")
          ? options.sortBy
          : undefined,
      sort_dir:
        options?.sortDir && (options.sortDir !== "asc" || (options?.sortBy && options.sortBy !== "name"))
          ? options.sortDir
          : undefined,
    },
  );
  const { data } = await client.get<ListBrowserObjectsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/objects`,
    { ...requestConfig, signal: options?.signal }
  );
  return data;
}

export async function fetchBrowserObjectColumns(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: {
    keys: string[];
    columns: BrowserLazyColumnField[];
  },
  options?: {
    sseCustomerKeyBase64?: string | null;
    signal?: AbortSignal;
  } & BrowserRequestOptions
): Promise<BrowserObjectColumnsResponse> {
  const { data } = await client.post<BrowserObjectColumnsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/objects/columns`,
    payload,
    {
      ...buildBrowserRequestConfig(
        contextId,
        options,
        undefined,
        buildSseCustomerBackendHeaders(options?.sseCustomerKeyBase64),
      ),
      signal: options?.signal,
    }
  );
  return data;
}

export async function listObjectVersions(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  options?: {
    prefix?: string;
    delimiter?: string;
    key?: string | null;
    keyMarker?: string | null;
    versionIdMarker?: string | null;
    maxKeys?: number;
    signal?: AbortSignal;
    requestOptions?: BrowserRequestOptions;
  }
): Promise<ListObjectVersionsResponse> {
  const requestConfig = buildBrowserRequestConfig(
    contextId,
    options?.requestOptions,
    {
      prefix: options?.prefix ?? "",
      delimiter: options?.delimiter ?? undefined,
      key: options?.key ?? undefined,
      key_marker: options?.keyMarker ?? undefined,
      version_id_marker: options?.versionIdMarker ?? undefined,
      max_keys: options?.maxKeys ?? undefined,
    },
  );
  const { data } = await client.get<ListObjectVersionsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/versions`,
    {
      ...requestConfig,
      signal: options?.signal,
    }
  );
  return data;
}

export async function fetchObjectMetadata(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  key: string,
  versionId?: string | null,
  sseCustomerKeyBase64?: string | null,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectMetadata> {
  const { data } = await client.get<ObjectMetadata>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-meta`,
    {
      ...buildBrowserRequestConfig(
        contextId,
        options,
        { key, version_id: versionId ?? undefined },
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
      ),
      signal,
    }
  );
  return data;
}

export async function getObjectTags(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  key: string,
  versionId?: string | null,
  options?: BrowserRequestOptions,
): Promise<ObjectTags> {
  const { data } = await client.get<ObjectTags>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-tags`,
    buildBrowserRequestConfig(contextId, options, {
      key,
      version_id: versionId ?? undefined,
    })
  );
  return data;
}

export async function updateObjectTags(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: ObjectTagsUpdate,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectTags> {
  const { data } = await client.put<ObjectTags>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-tags`,
    payload,
    {
      ...buildBrowserRequestConfig(contextId, options),
      signal,
    }
  );
  return data;
}

export async function updateObjectMetadata(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: ObjectMetadataUpdate,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectMetadata> {
  const { data } = await client.put<ObjectMetadata>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-meta`,
    payload,
    {
      ...buildBrowserRequestConfig(contextId, options),
      signal,
    }
  );
  return data;
}

export async function updateObjectAcl(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: ObjectAclUpdate,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectAcl> {
  const { data } = await client.put<ObjectAcl>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-acl`,
    payload,
    {
      ...buildBrowserRequestConfig(contextId, options),
      signal,
    }
  );
  return data;
}

export async function getObjectLegalHold(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  key: string,
  versionId?: string | null,
  options?: BrowserRequestOptions,
): Promise<ObjectLegalHold> {
  const { data } = await client.get<ObjectLegalHold>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-legal-hold`,
    buildBrowserRequestConfig(contextId, options, {
      key,
      version_id: versionId ?? undefined,
    })
  );
  return data;
}

export async function updateObjectLegalHold(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: ObjectLegalHoldUpdate,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectLegalHold> {
  const { data } = await client.put<ObjectLegalHold>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-legal-hold`,
    payload,
    {
      ...buildBrowserRequestConfig(contextId, options),
      signal,
    }
  );
  return data;
}

export async function getObjectRetention(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  key: string,
  versionId?: string | null,
  options?: BrowserRequestOptions,
): Promise<ObjectRetention> {
  const { data } = await client.get<ObjectRetention>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-retention`,
    buildBrowserRequestConfig(contextId, options, {
      key,
      version_id: versionId ?? undefined,
    })
  );
  return data;
}

export async function updateObjectRetention(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: ObjectRetentionUpdate,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectRetention> {
  const { data } = await client.put<ObjectRetention>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-retention`,
    payload,
    {
      ...buildBrowserRequestConfig(contextId, options),
      signal,
    }
  );
  return data;
}

export async function restoreObject(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: ObjectRestoreRequest,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-restore`,
    payload,
    buildBrowserRequestConfig(contextId, options)
  );
}

export async function copyObject(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: CopyObjectPayload,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.post(`/browser/buckets/${encodeURIComponent(bucketName)}/copy`, payload, {
    ...buildBrowserRequestConfig(contextId, options),
    signal,
  });
}

export async function deleteObjects(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  objects: DeleteObjectEntry[],
  signal?: AbortSignal,
  options?: BrowserRequestOptions
): Promise<number> {
  const { data } = await client.post<DeleteObjectsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/delete`,
    { objects },
    { ...buildBrowserRequestConfig(contextId, options), signal }
  );
  return data.deleted;
}

export async function cleanupObjectVersions(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: CleanupObjectVersionsPayload,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<CleanupObjectVersionsResponse> {
  const { data } = await client.post<CleanupObjectVersionsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/versions/cleanup`,
    payload,
    {
      ...buildBrowserRequestConfig(contextId, options),
      signal,
    }
  );
  return data;
}

export async function createFolder(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  prefix: string,
  options?: BrowserRequestOptions
): Promise<void> {
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/folders`,
    { prefix },
    buildBrowserRequestConfig(contextId, options)
  );
}
