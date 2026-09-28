/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import {
  proxyUpload,
  type PresignRequest,
  type PresignedUrl,
  type UploadProgressEvent,
} from "../../api/browserTransfers";
import {
  abortMultipartUpload,
  listMultipartParts,
  proxyUploadPart,
  completeMultipartUpload,
  initiateMultipartUpload,
  type PresignPartRequest,
  type PresignPartResponse,
} from "../../api/browserMultipart";
import {
  MULTIPART_CONCURRENCY,
  MULTIPART_THRESHOLD,
} from "./browserConstants";
import { uploadBrowserFile } from "./browserFileUpload";
import { uploadResumableBrowserFile } from "./browserResumableUpload";
import { listLocalUploads, removeLocalUpload, withLocalUploadLock, type LocalUpload } from "./browserTransferStore";
import type { PrepareBrowserWrites } from "./useBrowserWriteConflicts";
import { formatBrowserOperationError } from "./browserOperationErrors";
import type { BrowserTransferReporter } from "./browserPageContract";
import type { UploadQueueItem } from "./browserTypes";
import { isAbortError, isLikelyCorsError } from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

type UseBrowserQueuedUploadOptions = {
  owner?: string;
  prepareWrites?: PrepareBrowserWrites;
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  presignObject: (
    bucket: string,
    payload: PresignRequest,
  ) => Promise<PresignedUrl>;
  presignPart: (
    bucket: string,
    uploadId: string,
    payload: PresignPartRequest,
  ) => Promise<PresignPartResponse>;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64: string | null;
  startOperation: OperationRegistry["startOperation"];
  transferReporter?: BrowserTransferReporter;
  allowProxyFallback: boolean;
  updateOperation: OperationRegistry["updateOperation"];
  useProxyTransfers: boolean;
};

export function useBrowserQueuedUpload({
  owner = "",
  prepareWrites,
  clearOperationController,
  completeOperation,
  createOperationController,
  onStatus,
  onWarning,
  presignObject,
  presignPart,
  requestOptions,
  sseCustomerKeyBase64,
  startOperation,
  transferReporter,
  allowProxyFallback,
  updateOperation,
  useProxyTransfers,
}: UseBrowserQueuedUploadOptions) {
  return useCallback(
    async function runUpload(item: UploadQueueItem): Promise<boolean> {
      if (!item.bucket || !item.accountId) return false;
      const {
        file,
        relativePath,
        key,
        bucket,
        accountId,
        groupId,
        groupLabel,
        groupKind,
        itemLabel,
      } = item;
      const operationId = startOperation(
        "uploading",
        "Uploading",
        `${bucket}/${key}`,
        {
          kind: "upload",
          destination: { accountId, bucket, prefix: key.slice(0, key.lastIndexOf("/") + 1) },
          groupId,
          groupLabel,
          groupKind,
          itemLabel,
          cancelable: true,
          sizeBytes: file.size,
        },
      );
      const controller = createOperationController(operationId);
      const transferId =
        transferReporter?.start({
          direction: "Upload",
          bucketName: bucket,
          key,
          name: itemLabel || relativePath || file.name,
          sizeBytes: file.size,
        }) ?? null;

      let localUploadId: string | null = item.resumeRecord?.id ?? null;
      try {
        if (file.size >= MULTIPART_THRESHOLD) {
          updateOperation(operationId, { label: "Multipart upload" });
          await uploadResumableBrowserFile({
            file,
            scope: { owner, workspace: requestOptions?.workspaceSurface ?? "browser", accountId, bucket, key,
              requiresSse: Boolean(sseCustomerKeyBase64), writeGuard: item.writeGuard },
            existing: item.resumeRecord,
            listParts: uploadId => listMultipartParts(accountId, bucket, uploadId, key, controller.signal, sseCustomerKeyBase64, requestOptions),
            onPreparing: percent => updateOperation(operationId, { label: "Checking file fingerprint", progress: percent }),
            onWarning: message => onWarning(message),
            onResumable: id => {
              localUploadId = id;
              updateOperation(operationId, { label: "Multipart upload", recoveryId: id ?? undefined, pause: id ? () => controller.abort("pause") : undefined });
            },
            concurrency: MULTIPART_CONCURRENCY,
            controller,
            lifecycle: {
              uploadPart: useProxyTransfers ? async (uploadId, partNumber, blob, signal) =>
                (await proxyUploadPart(accountId, bucket, uploadId, key, partNumber, blob, signal, sseCustomerKeyBase64, requestOptions)).etag : undefined,
              initiate: async () => {
                const result = await initiateMultipartUpload(
                  accountId,
                  bucket,
                  {
                    key,
                    content_type: file.type || undefined,
                  },
                  sseCustomerKeyBase64,
                  requestOptions,
                );
                return result.upload_id;
              },
              presignPart: (uploadId, partNumber) =>
                presignPart(bucket, uploadId, {
                  key,
                  part_number: partNumber,
                  expires_in: 1800,
                }),
              complete: (uploadId, parts) =>
                completeMultipartUpload(
                  accountId,
                  bucket,
                  uploadId,
                  key,
                  { parts, write_guard: item.writeGuard },
                  requestOptions,
                  sseCustomerKeyBase64,
                ),
              abort: (uploadId) =>
                abortMultipartUpload(
                  accountId,
                  bucket,
                  uploadId,
                  key,
                  requestOptions,
                ),
            },
            onProgress: (progress) => {
              updateOperation(operationId, { progress });
            },
          });
        } else {
          const onProgress = (event: UploadProgressEvent) => {
            const total = event.total ?? file.size;
            const progress = total
              ? Math.round((event.loaded / total) * 100)
              : 0;
            updateOperation(operationId, { progress });
          };
          const uploadProxyFile = () =>
            proxyUpload(
              accountId,
              bucket,
              key,
              file,
              onProgress,
              controller.signal,
              sseCustomerKeyBase64,
              undefined,
              requestOptions,
              item.writeGuard,
            );
          const uploadFile = (mode: "direct" | "proxy") => uploadBrowserFile({
            file,
            mode,
            signal: controller.signal,
            onProgress,
            uploadProxy: uploadProxyFile,
            presign: () =>
              presignObject(bucket, {
                key,
                operation: "put_object",
                write_guard: item.writeGuard,
                content_type: file.type || undefined,
                expires_in: 1800,
              }),
          });
          try {
            await uploadFile(useProxyTransfers ? "proxy" : "direct");
          } catch (directError) {
            if (
              useProxyTransfers ||
              !allowProxyFallback ||
              !isLikelyCorsError(directError)
            ) {
              throw directError;
            }
            updateOperation(operationId, { label: "Proxy upload fallback" });
            onWarning(
              "Direct upload was unavailable, so BucketReef completed it through the proxy.",
            );
            await uploadFile("proxy");
          }
        }
        completeOperation(operationId, "done");
        if (transferId) {
          transferReporter?.complete(
            transferId,
            itemLabel || relativePath || file.name,
          );
        }
        onStatus(`Uploaded ${relativePath}`);
        return true;
      } catch (caughtError) {
        if ((isAbortError(caughtError) || controller.signal.aborted) && (caughtError as Error)?.name !== "MultipartCancelError") {
          const paused = controller.signal.reason !== "cancel" && Boolean(localUploadId);
          completeOperation(operationId, paused ? "paused" : "cancelled");
          const message = "Upload " + (paused ? "paused" : "cancelled") + " for " + relativePath;
          if (transferId) transferReporter?.fail(transferId, message);
          onStatus(message);
        } else {
          const completionError = formatBrowserOperationError(
            caughtError,
            `Upload failed for ${relativePath}`,
            `Upload failed for ${relativePath}`,
          );
          completeOperation(operationId, "failed", completionError);
          if (transferId) transferReporter?.fail(transferId, completionError);
          onStatus(completionError);
          if (!useProxyTransfers && isLikelyCorsError(caughtError)) {
            onWarning(
              "Direct transfer failed before S3 returned an HTTP response. Possible causes: network reachability, TLS/certificate issue, CORS policy, or endpoint/proxy configuration.",
            );
          }
        }
        updateOperation(operationId, { pause: undefined, retry: async () => {
          let resumeRecord: LocalUpload | undefined;
          try {
            if (localUploadId) resumeRecord = (await listLocalUploads(owner, requestOptions?.workspaceSurface ?? "browser")).find(record => record.id === localUploadId);
            if (resumeRecord?.state === "unavailable") { onStatus("This remote multipart upload no longer exists."); return; }
            const choices = prepareWrites ? await prepareWrites([{ id: item.id, key, size: file.size }], bucket) : [{ id: item.id, key, writeGuard: item.writeGuard }];
            const choice = choices[0];
            if (!choice) return;
            if (resumeRecord && choice.key !== key) {
              const record = resumeRecord;
              await withLocalUploadLock(record.id, async () => {
                await abortMultipartUpload(accountId, bucket, record.uploadId, key, requestOptions);
                await removeLocalUpload(record.id);
              });
              resumeRecord = undefined;
            }
            updateOperation(operationId, { retry: undefined });
            await runUpload({ ...item, id: crypto.randomUUID(), key: choice.key, writeGuard: choice.writeGuard, resumeRecord });
          } catch (error) { onStatus(formatBrowserOperationError(error, "Unable to retry upload.")); }
        } });
        return false;
      } finally {
        clearOperationController(operationId);
      }
    },
    [
      owner,
      prepareWrites,
      clearOperationController,
      allowProxyFallback,
      completeOperation,
      createOperationController,
      onStatus,
      onWarning,
      presignObject,
      presignPart,
      requestOptions,
      sseCustomerKeyBase64,
      startOperation,
      transferReporter,
      updateOperation,
      useProxyTransfers,
    ],
  );
}
