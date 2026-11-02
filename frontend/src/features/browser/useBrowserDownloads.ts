/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { BrowserObjectVersion } from "../../api/browserContracts";
import type {
  PresignRequest,
  PresignedUrl,
} from "../../api/browserTransfers";
import { runWithConcurrency } from "../../utils/concurrency";
import {
  triggerBlobDownload,
  triggerUrlDownload,
} from "../../utils/download";
import { clampPercentage } from "../../utils/numbers";
import { createRuntimeId } from "../../utils/runtimeId";
import { buildAttachmentDownloadDisposition } from "./browserObjectDetailsModel";
import {
  downloadBrowserTransferBlob,
  downloadBrowserTransferStream,
} from "./browserObjectTransferTransport";
import { formatBrowserOperationError } from "./browserOperationErrors";
import { updateOperationDetailById } from "./browserOperationDetailState";
import type { BrowserTransferReporter } from "./browserPageContract";
import type {
  BrowserItem,
  DownloadDetailStatus,
  OperationCompletionStatus,
} from "./browserTypes";
import { isAbortError } from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";
import { useBrowserI18n } from "./browserI18n";
import { useBrowserArchiveDownload } from "./useBrowserArchiveDownload";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

type UseBrowserDownloadsOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName: string;
  cancelDownloadDetails: OperationRegistry["cancelDownloadDetails"];
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  currentPath: string;
  enabled: boolean;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  onOpenDeletedItemVersions: (item: BrowserItem) => void;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  parallelism: number;
  presignDownload: (
    bucket: string,
    payload: PresignRequest,
  ) => Promise<PresignedUrl>;
  requestOptions?: BrowserRequestOptions;
  setDownloadDetails: OperationRegistry["setDownloadDetails"];
  showOperations: () => void;
  sseActive: boolean;
  sseCustomerKeyBase64: string | null;
  startOperation: OperationRegistry["startOperation"];
  streamingZipThresholdMb: number;
  transferReporter?: BrowserTransferReporter;
  updateOperation: OperationRegistry["updateOperation"];
  useProxyTransfers: boolean;
  versioningEnabled: boolean;
};

export function useBrowserDownloads({
  contextId,
  bucketName,
  cancelDownloadDetails,
  clearOperationController,
  completeOperation,
  createOperationController,
  currentPath,
  enabled,
  listAllObjectsForPrefix,
  onOpenDeletedItemVersions,
  onStatus,
  onWarning,
  parallelism,
  presignDownload,
  requestOptions,
  setDownloadDetails,
  showOperations,
  sseActive,
  sseCustomerKeyBase64,
  startOperation,
  streamingZipThresholdMb,
  transferReporter,
  updateOperation,
  useProxyTransfers,
  versioningEnabled,
}: UseBrowserDownloadsOptions) {
  const { text } = useBrowserI18n();
  const startReportedTransfer = useCallback(
    (item: BrowserItem) =>
      transferReporter?.start({
        direction: "Download",
        bucketName,
        key: item.key,
        name: item.name || item.key,
        sizeBytes: item.sizeBytes,
      }) ?? null,
    [bucketName, transferReporter],
  );

  const downloadBlob = useCallback(
    async (key: string, signal?: AbortSignal, versionId?: string) => {
      if (!bucketName || !enabled) throw new Error(text("Missing bucket context."));
      return downloadBrowserTransferBlob({
        text,
        selector: contextId,
        bucket: bucketName,
        key,
        versionId,
        mode: useProxyTransfers ? "proxy" : "direct",
        signal,
        sseCustomerKeyBase64,
        options: requestOptions,
        directPresign: (payload) => presignDownload(bucketName, payload),
      });
    },
    [
      contextId,
      bucketName,
      enabled,
      presignDownload,
      requestOptions,
      sseCustomerKeyBase64,
      useProxyTransfers,
      text,
    ],
  );

  const downloadStream = useCallback(
    async (key: string, signal?: AbortSignal) => {
      if (!bucketName || !enabled) throw new Error(text("Missing bucket context."));
      return downloadBrowserTransferStream({
        text,
        selector: contextId,
        bucket: bucketName,
        key,
        mode: useProxyTransfers ? "proxy" : "direct",
        signal,
        sseCustomerKeyBase64,
        options: requestOptions,
        directPresign: (payload) => presignDownload(bucketName, payload),
      });
    },
    [
      contextId,
      bucketName,
      enabled,
      presignDownload,
      requestOptions,
      sseCustomerKeyBase64,
      useProxyTransfers,
      text,
    ],
  );

  const updateDownloadDetail = useCallback(
    (
      operationId: string,
      detailId: string,
      status: DownloadDetailStatus,
      errorMessage?: string,
    ) => {
      setDownloadDetails((previous) =>
        updateOperationDetailById(
          previous,
          operationId,
          detailId,
          status,
          errorMessage,
        ),
      );
    },
    [setDownloadDetails],
  );

  const {
    archivePreparation,
    cancelArchivePreparation,
    downloadArchive,
    downloadFolder,
    savePreparedArchive,
  } = useBrowserArchiveDownload({
    bucketName,
    cancelDownloadDetails,
    clearOperationController,
    completeOperation,
    createOperationController,
    downloadBlob,
    downloadStream,
    enabled,
    listAllObjectsForPrefix,
    onStatus,
    onWarning,
    parallelism,
    setDownloadDetails,
    showOperations,
    startOperation,
    streamingZipThresholdMb,
    updateDownloadDetail,
    updateOperation,
  });

  const downloadMultipleFiles = useCallback(
    async function runFileDownloads(files: BrowserItem[]): Promise<void> {
      showOperations();
      const operationId = startOperation(
        "downloading",
        text("Downloading {count} files", { count: files.length }),
        currentPath || bucketName,
        { kind: "download", cancelable: true },
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      const targets = files.map((item) => ({ item, detailId: createRuntimeId() }));
      setDownloadDetails((previous) => ({
        ...previous,
        [operationId]: targets.map((target) => ({
          id: target.detailId,
          key: target.item.key,
          label: target.item.name,
          status: "queued",
          sizeBytes: target.item.sizeBytes ?? undefined,
        })),
      }));
      const totalBytes = targets.reduce(
        (sum, target) => sum + (target.item.sizeBytes ?? 0),
        0,
      );
      let downloadedBytes = 0;
      let completed = 0;
      let aborted = false;
      let failedCount = 0;
      const updateProgress = () => {
        const base =
          totalBytes > 0
            ? downloadedBytes / totalBytes
            : completed / targets.length;
        updateOperation(operationId, {
          progress: clampPercentage(Math.round(base * 100)),
        });
      };
      try {
        await runWithConcurrency(
          targets,
          parallelism,
          async (target) => {
            if (controller.signal.aborted) {
              aborted = true;
              return;
            }
            updateDownloadDetail(operationId, target.detailId, "downloading");
            const reportedId = startReportedTransfer(target.item);
            try {
              const blob = await downloadBlob(
                target.item.key,
                controller.signal,
              );
              triggerBlobDownload(target.item.name || "download", blob);
              updateDownloadDetail(operationId, target.detailId, "done");
              if (reportedId) {
                transferReporter?.complete(
                  reportedId,
                  target.item.name || "download",
                );
              }
            } catch (caughtError) {
              if (isAbortError(caughtError) || controller.signal.aborted) {
                updateDownloadDetail(
                  operationId,
                  target.detailId,
                  "cancelled",
                );
                if (reportedId) {
                  transferReporter?.fail(reportedId, text("Download cancelled."));
                }
                aborted = true;
                controller.abort();
                return;
              }
              console.error(caughtError);
              const errorMessage = formatBrowserOperationError(
                caughtError,
                text("Download failed."),
              );
              updateDownloadDetail(
                operationId,
                target.detailId,
                "failed",
                errorMessage,
              );
              if (reportedId) transferReporter?.fail(reportedId, errorMessage);
              failedCount += 1;
            } finally {
              completed += 1;
              downloadedBytes += target.item.sizeBytes ?? 0;
              updateProgress();
            }
          },
          () => aborted,
        );
        if (aborted || controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus(text("Download cancelled."));
          cancelDownloadDetails(operationId);
          return;
        }
        updateOperation(operationId, { progress: 100 });
        onStatus(text("Downloaded {count} files", { count: files.length }));
        if (failedCount > 0) {
          completionStatus = "failed";
          completionError = text("Downloaded {done} of {total} files.", {
            done: files.length - failedCount,
            total: files.length,
          });
          onStatus(completionError);
        }
      } catch (caughtError) {
        if (isAbortError(caughtError) || controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus(text("Download cancelled."));
        } else {
          completionStatus = "failed";
          completionError = formatBrowserOperationError(
            caughtError,
            text("Unable to download files."),
            text("Unable to download files."),
          );
          onStatus(completionError);
        }
      } finally {
        clearOperationController(operationId);
        completeOperation(operationId, completionStatus, completionError);

      }
    },
    [
      bucketName,
      cancelDownloadDetails,
      clearOperationController,
      completeOperation,
      createOperationController,
      currentPath,
      downloadBlob,
      onStatus,
      parallelism,
      setDownloadDetails,
      showOperations,
      startOperation,
      startReportedTransfer,
      transferReporter,
      updateDownloadDetail,
      updateOperation,
      text,
    ],
  );

  const downloadItems = useCallback(
    async (items: BrowserItem[]) => {
      if (!bucketName || !enabled || items.length === 0) return;
      const files = items.filter(
        (item) => item.type === "file" && !item.isDeleted,
      );
      const deletedCount = items.filter(
        (item) => item.type === "file" && item.isDeleted,
      ).length;
      if (files.length === 0) {
        if (deletedCount > 0) {
          onWarning(text("Deleted objects cannot be downloaded directly."));
        }
        return;
      }
      onWarning(
        deletedCount > 0
          ? text("Deleted objects were skipped. Open versions to restore before download.")
          : null,
      );
      if (files.length > 1 || (files[0].sizeBytes != null && files[0].sizeBytes <= 25 * 1024 * 1024)) {
        await downloadMultipleFiles(files);
        return;
      }
      const item = files[0];
      try {
        if (useProxyTransfers || sseActive) {
          const reportedId = startReportedTransfer(item);
          try {
            const blob = await downloadBlob(item.key);
            triggerBlobDownload(item.name || "download", blob);
            if (reportedId) {
              transferReporter?.complete(reportedId, item.name || "download");
            }
          } catch (caughtError) {
            if (reportedId) {
              transferReporter?.fail(
                reportedId,
                formatBrowserOperationError(
                  caughtError,
                  text("Unable to download object."),
                ),
              );
            }
            throw caughtError;
          }
        } else {
          const presign = await presignDownload(bucketName, {
            key: item.key,
            operation: "get_object",
            expires_in: 900,
            response_content_disposition:
              buildAttachmentDownloadDisposition(item.name || "download"),
          });
          triggerUrlDownload(item.name || "download", presign.url);
        }
      } catch {
        onStatus(
          useProxyTransfers || sseActive
            ? text("Unable to download object.")
            : text("Unable to generate download URL."),
        );
      }
    },
    [
      bucketName,
      downloadBlob,
      downloadMultipleFiles,
      enabled,
      onStatus,
      onWarning,
      presignDownload,
      sseActive,
      startReportedTransfer,
      transferReporter,
      useProxyTransfers,
      text,
    ],
  );

  const downloadTarget = useCallback(
    async (item: BrowserItem) => {
      if (item.isDeleted) {
        onWarning(
          text(
            "This item is deleted. Open it or use versions to restore content before downloading.",
          ),
        );
        if (item.type === "file" && versioningEnabled) {
          onOpenDeletedItemVersions(item);
        }
        return;
      }
      if (item.type === "folder") {
        return downloadFolder(item);
      }
      return downloadItems([item]);
    },
    [
      downloadFolder,
      downloadItems,
      onOpenDeletedItemVersions,
      onWarning,
      text,
      versioningEnabled,
    ],
  );

  const downloadVersion = useCallback(
    async (version: BrowserObjectVersion) => {
      if (
        !bucketName ||
        !enabled ||
        version.is_delete_marker ||
        !version.version_id
      ) {
        onWarning(text("This version cannot be downloaded."));
        return;
      }
      const filename = version.key.split("/").filter(Boolean).at(-1) || "download";
      const reportItem: BrowserItem = {
        id: `version:${version.key}:${version.version_id}`,
        key: version.key,
        name: filename,
        type: "file",
        size: "",
        sizeBytes: version.size,
        modified: version.last_modified ?? "",
        modifiedAt: version.last_modified
          ? Date.parse(version.last_modified)
          : null,
        owner: "",
        storageClass: version.storage_class ?? undefined,
        etag: version.etag,
      };
      const reportedId = startReportedTransfer(reportItem);
      try {
        const blob = await downloadBlob(
          version.key,
          undefined,
          version.version_id,
        );
        triggerBlobDownload(filename, blob);
        if (reportedId) transferReporter?.complete(reportedId, filename);
        onStatus(text("Downloaded version of {filename}", { filename }));
      } catch (caughtError) {
        const message = formatBrowserOperationError(
          caughtError,
          text("Unable to download object version."),
        );
        if (reportedId) transferReporter?.fail(reportedId, message);
        onStatus(message);
      }
    },
    [
      bucketName,
      downloadBlob,
      enabled,
      onStatus,
      onWarning,
      startReportedTransfer,
      transferReporter,
      text,
    ],
  );

  return {
    archivePreparation,
    cancelArchivePreparation,
    downloadArchive,
    downloadFolder,
    downloadItems,
    downloadTarget,
    downloadVersion,
    savePreparedArchive,
  };
}
