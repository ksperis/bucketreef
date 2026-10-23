/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3ExecutionContextSelector, withS3ContextParam } from "./accountParams";
import {
  buildBrowserWorkspaceHeaders,
  mergeBrowserHeaders,
} from "./browserRequestHeaders";
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
  const params = withS3ContextParam(
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
    contextId
  );
  const { data } = await client.get<ListBrowserObjectsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/objects`,
    { params, headers: buildBrowserWorkspaceHeaders(options), signal: options?.signal }
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
      params: withS3ContextParam(undefined, contextId),
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(options?.sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
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
  const params = withS3ContextParam(
    {
      prefix: options?.prefix ?? "",
      delimiter: options?.delimiter ?? undefined,
      key: options?.key ?? undefined,
      key_marker: options?.keyMarker ?? undefined,
      version_id_marker: options?.versionIdMarker ?? undefined,
      max_keys: options?.maxKeys ?? undefined,
    },
    contextId
  );
  const { data } = await client.get<ListObjectVersionsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/versions`,
    {
      params,
      headers: buildBrowserWorkspaceHeaders(options?.requestOptions),
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
  const params = withS3ContextParam({ key, version_id: versionId ?? undefined }, contextId);
  const { data } = await client.get<ObjectMetadata>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-meta`,
    {
      params,
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
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
  const params = withS3ContextParam({ key, version_id: versionId ?? undefined }, contextId);
  const { data } = await client.get<ObjectTags>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-tags`,
    { params, headers: buildBrowserWorkspaceHeaders(options) }
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
      params: withS3ContextParam(undefined, contextId),
      headers: buildBrowserWorkspaceHeaders(options),
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
      params: withS3ContextParam(undefined, contextId),
      headers: buildBrowserWorkspaceHeaders(options),
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
      params: withS3ContextParam(undefined, contextId),
      headers: buildBrowserWorkspaceHeaders(options),
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
  const params = withS3ContextParam({ key, version_id: versionId ?? undefined }, contextId);
  const { data } = await client.get<ObjectLegalHold>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-legal-hold`,
    { params, headers: buildBrowserWorkspaceHeaders(options) }
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
      params: withS3ContextParam(undefined, contextId),
      headers: buildBrowserWorkspaceHeaders(options),
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
  const params = withS3ContextParam({ key, version_id: versionId ?? undefined }, contextId);
  const { data } = await client.get<ObjectRetention>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-retention`,
    { params, headers: buildBrowserWorkspaceHeaders(options) }
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
      params: withS3ContextParam(undefined, contextId),
      headers: buildBrowserWorkspaceHeaders(options),
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
    {
      params: withS3ContextParam(undefined, contextId),
      headers: buildBrowserWorkspaceHeaders(options),
    }
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
    params: withS3ContextParam(undefined, contextId),
    headers: buildBrowserWorkspaceHeaders(options),
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
    { params: withS3ContextParam(undefined, contextId), headers: buildBrowserWorkspaceHeaders(options), signal }
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
      params: withS3ContextParam(undefined, contextId),
      headers: buildBrowserWorkspaceHeaders(options),
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
    { params: withS3ContextParam(undefined, contextId), headers: buildBrowserWorkspaceHeaders(options) }
  );
}
