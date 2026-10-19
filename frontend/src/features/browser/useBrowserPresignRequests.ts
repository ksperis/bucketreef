/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { StsCredentials } from "../../api/browserContracts";
import {
  presignPart,
  type PresignPartRequest,
  type PresignPartResponse,
} from "../../api/browserMultipart";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import {
  presignObject,
  type PresignRequest,
  type PresignedUrl,
} from "../../api/browserTransfers";
import type { BrowserUploadMode } from "./sseBrowserLogic";
import { presignObjectWithSts, presignPartWithSts } from "./stsPresigner";

type EnsureStsCredentials = (
  forceRefresh?: boolean,
) => Promise<StsCredentials | null>;

type UseBrowserPresignRequestsOptions = {
  contextId: S3ExecutionContextSelector;
  ensureStsCredentials: EnsureStsCredentials;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64: string | null;
  uploadMode: BrowserUploadMode;
  useStsPresigner: boolean;
};

async function tryStsPresign<T>(
  ensureCredentials: EnsureStsCredentials,
  presign: (credentials: StsCredentials) => Promise<T>,
): Promise<T | null> {
  const credentials = await ensureCredentials();
  if (!credentials) return null;
  try {
    return await presign(credentials);
  } catch {
    const refreshedCredentials = await ensureCredentials(true);
    if (!refreshedCredentials) return null;
    try {
      return await presign(refreshedCredentials);
    } catch {
      return null;
    }
  }
}

export function useBrowserPresignRequests({
  contextId,
  ensureStsCredentials,
  requestOptions,
  sseCustomerKeyBase64,
  uploadMode,
  useStsPresigner,
}: UseBrowserPresignRequestsOptions) {
  const presignObjectRequest = useCallback(
    async (
      bucketName: string,
      payload: PresignRequest,
    ): Promise<PresignedUrl> => {
      if (payload.operation === "put_object") {
        if (uploadMode === "sts") {
          const stsResponse = await tryStsPresign(
            ensureStsCredentials,
            (credentials) =>
              presignObjectWithSts(credentials, bucketName, payload),
          );
          if (stsResponse) return stsResponse;
          throw new Error("STS upload signing is unavailable.");
        }
        if (uploadMode !== "direct") {
          throw new Error("Direct upload signing is disabled by Browser settings.");
        }
        return presignObject(
          contextId,
          bucketName,
          payload,
          sseCustomerKeyBase64,
          requestOptions,
        );
      }
      if (useStsPresigner) {
        const stsResponse = await tryStsPresign(
          ensureStsCredentials,
          (credentials) =>
            presignObjectWithSts(credentials, bucketName, payload),
        );
        if (stsResponse) return stsResponse;
      }
      return presignObject(
        contextId,
        bucketName,
        payload,
        sseCustomerKeyBase64,
        requestOptions,
      );
    },
    [
      contextId,
      ensureStsCredentials,
      requestOptions,
      sseCustomerKeyBase64,
      uploadMode,
      useStsPresigner,
    ],
  );

  const presignPartRequest = useCallback(
    async (
      bucketName: string,
      uploadId: string,
      payload: PresignPartRequest,
    ): Promise<PresignPartResponse> => {
      if (uploadMode === "sts") {
        const stsResponse = await tryStsPresign(
          ensureStsCredentials,
          (credentials) =>
            presignPartWithSts(credentials, bucketName, uploadId, payload),
        );
        if (stsResponse) return stsResponse;
        throw new Error("STS upload signing is unavailable.");
      }
      if (uploadMode !== "direct") {
        throw new Error("Direct upload signing is disabled by Browser settings.");
      }
      return presignPart(
        contextId,
        bucketName,
        uploadId,
        payload,
        sseCustomerKeyBase64,
        requestOptions,
      );
    },
    [
      contextId,
      ensureStsCredentials,
      requestOptions,
      sseCustomerKeyBase64,
      uploadMode,
    ],
  );

  return { presignObjectRequest, presignPartRequest };
}
