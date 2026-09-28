/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ensureSuccessfulBrowserTransferResponse } from "./browserFetchTransferResponse";
import { normalizeEtag } from "./browserUtils";

type CompletedPart = { part_number: number; etag: string };

type PresignedPart = {
  url: string;
  headers?: Record<string, string>;
};

export type BrowserMultipartUploadLifecycle = {
  initiate: () => Promise<string>;
  presignPart: (
    uploadId: string,
    partNumber: number,
  ) => Promise<PresignedPart>;
  complete: (uploadId: string, parts: CompletedPart[]) => Promise<void>;
  abort: (uploadId: string) => Promise<void>;
  uploadPart?: (uploadId: string, partNumber: number, blob: Blob, signal: AbortSignal) => Promise<string>;
};

type UploadFileMultipartParams = {
  file: File;
  partSize: number;
  concurrency: number;
  controller: AbortController;
  lifecycle: BrowserMultipartUploadLifecycle;
  onProgress: (percent: number) => void;
  resume?: {
    uploadId?: string;
    parts?: CompletedPart[];
    onInitiated: (uploadId: string) => Promise<void>;
    onPart: (part: CompletedPart & { size: number }) => Promise<void>;
    keepOnError: boolean;
  };
};

type UploadStreamMultipartParams = {
  stream: ReadableStream<Uint8Array>;
  sizeBytes: number;
  contentType?: string | null;
  partSize: number;
  signal?: AbortSignal;
  lifecycle: BrowserMultipartUploadLifecycle;
};

const abortStartedUpload = async (
  uploadId: string | null,
  lifecycle: BrowserMultipartUploadLifecycle,
): Promise<void> => {
  if (!uploadId) return;
  try {
    await lifecycle.abort(uploadId);
  } catch {
    // The original upload error is more useful than a best-effort cleanup error.
  }
};

export const uploadBrowserFileMultipart = async ({
  file,
  partSize,
  concurrency,
  controller,
  lifecycle,
  onProgress,
  resume,
}: UploadFileMultipartParams): Promise<void> => {
  let uploadId: string | null = null;
  const partProgress = new Map<number, number>();
  const totalParts = Math.ceil(file.size / partSize);
  if (totalParts > 10000 || partSize > 5 * 1024 ** 3) throw new Error("File exceeds multipart upload limits.");
  const parts = Array.from({ length: totalParts }, (_, index) => {
    const partNumber = index + 1;
    const start = index * partSize;
    const end = Math.min(start + partSize, file.size);
    return { partNumber, start, end, size: end - start };
  });
  const completedParts: CompletedPart[] = [...(resume?.parts ?? [])];
  const alreadyCompleted = new Set(completedParts.map(part => part.part_number));
  const transferController = new AbortController();
  const forwardAbort = () => transferController.abort(controller.signal.reason);
  controller.signal.addEventListener("abort", forwardAbort, { once: true });
  if (controller.signal.aborted) forwardAbort();

  const recordProgress = (
    partNumber: number,
    loadedBytes: number,
    currentPartSize: number,
  ) => {
    partProgress.set(
      partNumber,
      Math.min(loadedBytes, currentPartSize),
    );
    const loaded = Array.from(partProgress.values()).reduce(
      (sum, value) => sum + value,
      0,
    );
    onProgress(
      file.size ? Math.min(99, Math.round((loaded / file.size) * 100)) : 0,
    );
  };

  try {
    controller.signal.throwIfAborted();
    const startedUploadId = resume?.uploadId ?? await lifecycle.initiate();
    uploadId = startedUploadId;
    await resume?.onInitiated(startedUploadId);
    for (const part of parts) if (alreadyCompleted.has(part.partNumber)) recordProgress(part.partNumber, part.size, part.size);
    const remaining = parts.filter(part => !alreadyCompleted.has(part.partNumber));
    let cursor = 0;
    let failure: unknown;
    await Promise.all(Array.from({ length: Math.min(concurrency, remaining.length) }, async () => {
      while (!transferController.signal.aborted && cursor < remaining.length) {
        const part = remaining[cursor++];
        try {
          recordProgress(part.partNumber, 0, part.size);
          const blob = file.slice(part.start, part.end);
          const etag = lifecycle.uploadPart
            ? normalizeEtag(await lifecycle.uploadPart(startedUploadId, part.partNumber, blob, transferController.signal))
            : await (async () => {
              const presignedPart = await lifecycle.presignPart(startedUploadId, part.partNumber);
              transferController.signal.throwIfAborted();
              const response = await fetch(presignedPart.url, { method: "PUT", headers: presignedPart.headers || {}, body: blob, credentials: "omit", signal: transferController.signal });
              await ensureSuccessfulBrowserTransferResponse(response, "Multipart upload failed");
              return normalizeEtag(response.headers.get("etag") ?? undefined);
            })();
          if (!etag) {
            throw new Error("Missing ETag from multipart upload.");
          }
          completedParts.push({ part_number: part.partNumber, etag });
          await resume?.onPart({ part_number: part.partNumber, etag, size: part.size });
          recordProgress(part.partNumber, part.size, part.size);
        } catch (error) {
          failure ??= error;
          transferController.abort();
        }
      }
    }));
    if (failure) throw failure;
    if (controller.signal.aborted) throw new DOMException("Upload interrupted", "AbortError");
    onProgress(95);
    completedParts.sort((left, right) => left.part_number - right.part_number);
    await lifecycle.complete(startedUploadId, completedParts);
    onProgress(100);
  } catch (error) {
    if (resume?.keepOnError && controller.signal.reason === "cancel" && uploadId) {
      try { await lifecycle.abort(uploadId); }
      catch {
        const failure = new Error("Remote cancellation failed. Recovery information was retained; retry cancellation after signing in.");
        failure.name = "MultipartCancelError";
        throw failure;
      }
    } else if (!resume?.keepOnError) await abortStartedUpload(uploadId, lifecycle);
    throw error;
  } finally {
    controller.signal.removeEventListener("abort", forwardAbort);
  }
};

export const uploadBrowserStreamMultipart = async ({
  stream,
  sizeBytes,
  contentType,
  partSize,
  signal,
  lifecycle,
}: UploadStreamMultipartParams): Promise<void> => {
  let uploadId: string | null = null;
  const completedParts: CompletedPart[] = [];
  const reader = stream.getReader();
  let pending = new Uint8Array(0);
  let partNumber = 1;

  const flushPart = async (partBytes: Uint8Array) => {
    if (!uploadId) {
      throw new Error("Missing multipart upload ID.");
    }
    const currentPartNumber = partNumber;
    const presignedPart = await lifecycle.presignPart(
      uploadId,
      currentPartNumber,
    );
    const partBuffer = new Uint8Array(partBytes).buffer;
    const response = await fetch(presignedPart.url, {
      method: "PUT",
      headers: presignedPart.headers || {},
      body: new Blob([partBuffer], {
        type: contentType || "application/octet-stream",
      }),
      credentials: "omit",
      signal,
    });
    await ensureSuccessfulBrowserTransferResponse(
      response,
      "Multipart upload failed",
    );
    const etag = normalizeEtag(response.headers.get("etag") ?? undefined);
    if (!etag) {
      throw new Error("Missing ETag from multipart upload.");
    }
    completedParts.push({ part_number: currentPartNumber, etag });
    partNumber += 1;
  };

  try {
    const startedUploadId = await lifecycle.initiate();
    uploadId = startedUploadId;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const combined = new Uint8Array(pending.byteLength + value.byteLength);
      combined.set(pending, 0);
      combined.set(value, pending.byteLength);
      pending = combined;

      while (pending.byteLength >= partSize) {
        await flushPart(pending.slice(0, partSize));
        pending = pending.slice(partSize);
      }
    }

    if (pending.byteLength > 0 || sizeBytes === 0) {
      await flushPart(pending);
    }
    completedParts.sort((left, right) => left.part_number - right.part_number);
    await lifecycle.complete(startedUploadId, completedParts);
  } catch (error) {
    await abortStartedUpload(uploadId, lifecycle);
    throw error;
  } finally {
    reader.releaseLock();
  }
};
