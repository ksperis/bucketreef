/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3ExecutionContextSelector } from "./accountParams";
import type { ObjectTag } from "./browserContracts";
import { buildBrowserRequestConfig } from "./browserRequestHeaders";
import { buildSseCustomerBackendHeaders } from "./browserSseCustomer";
import type { BrowserRequestOptions } from "./browserWorkspace";
import type { PresignedUrl } from "./browserTransfers";
import client from "./client";

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
  initiated: string | null;
  storage_class: string | null;
  owner: string | null;
};

type ListMultipartUploadsResponse = {
  uploads: MultipartUploadItem[];
  is_truncated: boolean;
  next_key: string | null;
  next_upload_id: string | null;
};

export type PresignPartRequest = {
  key: string;
  part_number: number;
  expires_in?: number;
};

type CompleteMultipartUploadRequest = {
  parts: Array<{ part_number: number; etag: string }>;
};

export async function initiateMultipartUpload(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: MultipartUploadInitRequest,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<MultipartUploadInitResponse> {
  const { data } = await client.post<MultipartUploadInitResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/initiate`,
    payload,
    buildBrowserRequestConfig(
      contextId,
      options,
      undefined,
      buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
    ),
  );
  return data;
}

export async function listMultipartUploads(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  options?: {
    prefix?: string;
    keyMarker?: string | null;
    uploadIdMarker?: string | null;
    maxUploads?: number;
  } & BrowserRequestOptions,
): Promise<ListMultipartUploadsResponse> {
  const requestConfig = buildBrowserRequestConfig(
    contextId,
    options,
    {
      prefix: options?.prefix ?? undefined,
      key_marker: options?.keyMarker ?? undefined,
      upload_id_marker: options?.uploadIdMarker ?? undefined,
      max_uploads: options?.maxUploads ?? undefined,
    },
  );
  const { data } = await client.get<ListMultipartUploadsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart`,
    requestConfig,
  );
  return data;
}

export async function presignPart(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  uploadId: string,
  payload: PresignPartRequest,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<PresignedUrl> {
  const { data } = await client.post<PresignedUrl>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/presign`,
    payload,
    buildBrowserRequestConfig(
      contextId,
      options,
      undefined,
      buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
    ),
  );
  return data;
}

export async function completeMultipartUpload(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  uploadId: string,
  key: string,
  payload: CompleteMultipartUploadRequest,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/complete`,
    payload,
    buildBrowserRequestConfig(contextId, options, { key }),
  );
}

export async function abortMultipartUpload(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  uploadId: string,
  key: string,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.delete(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}`,
    buildBrowserRequestConfig(contextId, options, { key }),
  );
}
