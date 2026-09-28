import type { BrowserWriteGuard } from "./browserConflicts";
/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import type { ObjectTag } from "./browserContracts";
import {
  buildBrowserWorkspaceHeaders,
  mergeBrowserHeaders,
} from "./browserRequestHeaders";
import { buildSseCustomerBackendHeaders } from "./browserSseCustomer";
import type { BrowserRequestOptions } from "./browserWorkspace";
import client, { LONG_RUNNING_REQUEST_TIMEOUT_MS } from "./client";

export type MultipartPartReceipt = { part_number: number; etag: string; size: number };

export async function listMultipartParts(accountId: S3AccountSelector, bucketName: string, uploadId: string, key: string, signal?: AbortSignal, sseCustomerKeyBase64?: string | null, options?: BrowserRequestOptions): Promise<MultipartPartReceipt[]> {
  const parts: MultipartPartReceipt[] = [];
  let marker = 0;
  for (let page = 0; page < 11; page++) {
    const { data } = await client.get<{ parts: MultipartPartReceipt[]; is_truncated: boolean; next_part_number_marker?: number }>(
      `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/parts`,
      { params: withS3AccountParam({ key, part_number_marker: marker, max_parts: 1000 }, accountId), signal,
        headers: mergeBrowserHeaders(buildBrowserWorkspaceHeaders(options), buildSseCustomerBackendHeaders(sseCustomerKeyBase64)) },
    );
    parts.push(...data.parts);
    if (!data.is_truncated) return parts;
    if (!data.next_part_number_marker || data.next_part_number_marker <= marker) throw new Error("Multipart pagination did not advance.");
    marker = data.next_part_number_marker;
  }
  throw new Error("Multipart part count exceeds the supported limit.");
}

export async function proxyUploadPart(accountId: S3AccountSelector, bucketName: string, uploadId: string, key: string, partNumber: number, part: Blob, signal?: AbortSignal, sseCustomerKeyBase64?: string | null, options?: BrowserRequestOptions): Promise<MultipartPartReceipt> {
  const form = new FormData(); form.append("key", key); form.append("part_number", String(partNumber)); form.append("file", part, "part");
  const { data } = await client.post<MultipartPartReceipt>(`/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/parts`, form, {
    params: withS3AccountParam(undefined, accountId), signal, timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
    headers: mergeBrowserHeaders(buildBrowserWorkspaceHeaders(options), buildSseCustomerBackendHeaders(sseCustomerKeyBase64)),
  });
  return data;
}

type MultipartUploadInitRequest = {
  key: string;
  content_type?: string | null;
  metadata?: Record<string, string>;
  tags?: ObjectTag[];
  acl?: string | null;
};

type MultipartUploadInitResponse = {
  key: string;
  upload_id: string;
};

export type MultipartUploadItem = {
  key: string;
  upload_id: string;
  initiated?: string | null;
  storage_class?: string | null;
  owner?: string | null;
};

type ListMultipartUploadsResponse = {
  uploads: MultipartUploadItem[];
  is_truncated: boolean;
  next_key?: string | null;
  next_upload_id?: string | null;
};

export type PresignPartRequest = {
  key: string;
  part_number: number;
  expires_in?: number;
};

export type PresignPartResponse = {
  url: string;
  method: string;
  expires_in: number;
  headers?: Record<string, string>;
};

type CompleteMultipartUploadRequest = {
  write_guard?: BrowserWriteGuard;
  parts: Array<{ part_number: number; etag: string }>;
};

export async function initiateMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: MultipartUploadInitRequest,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<MultipartUploadInitResponse> {
  const { data } = await client.post<MultipartUploadInitResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/initiate`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
      ),
    },
  );
  return data;
}

export async function listMultipartUploads(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: {
    prefix?: string;
    keyMarker?: string | null;
    uploadIdMarker?: string | null;
    maxUploads?: number;
  } & BrowserRequestOptions,
): Promise<ListMultipartUploadsResponse> {
  const params = withS3AccountParam(
    {
      prefix: options?.prefix ?? undefined,
      key_marker: options?.keyMarker ?? undefined,
      upload_id_marker: options?.uploadIdMarker ?? undefined,
      max_uploads: options?.maxUploads ?? undefined,
    },
    accountId,
  );
  const { data } = await client.get<ListMultipartUploadsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart`,
    { params, headers: buildBrowserWorkspaceHeaders(options) },
  );
  return data;
}

export async function presignPart(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  payload: PresignPartRequest,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<PresignPartResponse> {
  const { data } = await client.post<PresignPartResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/presign`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
      ),
    },
  );
  return data;
}

export async function completeMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  key: string,
  payload: CompleteMultipartUploadRequest,
  options?: BrowserRequestOptions,
  sseCustomerKeyBase64?: string | null,
): Promise<void> {
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/complete`,
    payload,
    {
      params: withS3AccountParam({ key }, accountId),
      headers: mergeBrowserHeaders(buildBrowserWorkspaceHeaders(options), buildSseCustomerBackendHeaders(sseCustomerKeyBase64)),
    },
  );
}

export async function abortMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  key: string,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.delete(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}`,
    {
      params: withS3AccountParam({ key }, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
}
