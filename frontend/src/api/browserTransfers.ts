/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3ExecutionContextSelector } from "./accountParams";
import type { BrowserRequestOptions } from "./browserWorkspace";
import {
  buildBrowserRequestConfig,
  buildBrowserWorkspaceHeaders,
} from "./browserRequestHeaders";
import { buildSseCustomerBackendHeaders } from "./browserSseCustomer";
import client, {
  buildApiFetchHeaders,
  LONG_RUNNING_REQUEST_TIMEOUT_MS,
} from "./client";

export type UploadProgressEvent = {
  loaded: number;
  total?: number;
  progress?: number;
};

export type PresignOperation = "get_object" | "put_object" | "delete_object";

export type PresignRequest = {
  key: string;
  operation: PresignOperation;
  expires_in?: number;
  content_type?: string | null;
  response_content_disposition?: string | null;
  version_id?: string | null;
};

export type PresignedUrl = {
  url: string;
  method: string;
  expires_in: number;
  headers: Record<string, string>;
};

export function buildBrowserFetchHeaders(
  options?: BrowserRequestOptions,
  sseCustomerKeyBase64?: string | null,
): Record<string, string> {
  return buildApiFetchHeaders({
    ...buildBrowserWorkspaceHeaders(options),
    ...buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
  });
}

export async function presignObject(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  payload: PresignRequest,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<PresignedUrl> {
  const { data } = await client.post<PresignedUrl>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/presign`,
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

export async function proxyUpload(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  key: string,
  file: Blob,
  onUploadProgress?: (event: UploadProgressEvent) => void,
  signal?: AbortSignal,
  sseCustomerKeyBase64?: string | null,
  fileName?: string,
  options?: BrowserRequestOptions,
): Promise<void> {
  const form = new FormData();
  form.append("key", key);
  form.append("content_type", file.type || "application/octet-stream");
  const inferredName =
    fileName ??
    ("name" in file && typeof file.name === "string" && file.name
      ? file.name
      : "upload.bin");
  form.append("file", file, inferredName);
  onUploadProgress?.({ loaded: 0, total: file.size, progress: 0 });
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/proxy-upload`,
    form,
    {
      ...buildBrowserRequestConfig(
        contextId,
        options,
        undefined,
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
      ),
      signal,
      timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
    },
  );
  onUploadProgress?.({ loaded: file.size, total: file.size, progress: 1 });
}

export async function proxyDownload(
  contextId: S3ExecutionContextSelector,
  bucketName: string,
  key: string,
  signal?: AbortSignal,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
  versionId?: string | null,
): Promise<Blob> {
  const { data } = await client.get(
    `/browser/buckets/${encodeURIComponent(bucketName)}/download`,
    {
      ...buildBrowserRequestConfig(
        contextId,
        options,
        { key, ...(versionId != null ? { version_id: versionId } : {}) },
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
      ),
      responseType: "blob",
      signal,
      timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
    },
  );
  return data as Blob;
}
