import { buildBrowserSelectionManifest } from "./browserSelectionManifest";
/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
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
import {
  buildBrowserFolderDownloadPlan,
  canStreamBrowserArchive,
  chooseBrowserArchiveFile,
  downloadBrowserFolderArchive,
  resolveBrowserFolderArchiveLabel,
  type BrowserArchiveOutput,
  type BrowserFolderDownloadPlan,
} from "./browserFolderDownload";
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
import { isAbortError, makeId } from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

type BrowserArchivePreparation =
  | {
      phase: "inventorying";
      folderLabel: string;
      completedFolders: number;
      totalFolders: number;
    }
  | {
      phase: "ready";
      folderLabel: string;
      fileCount: number;
      totalBytes: number;
      excludedCount: number;
      canDownload: boolean;
      error?: string;
      basePrefix: string;
      plan: BrowserFolderDownloadPlan;
    };

type UseBrowserDownloadsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  cancelDownloadDetails: OperationRegistry["cancelDownloadDetails"];
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  currentPath: string;
  enabled: boolean;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
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
};

export function useBrowserDownloads({
  accountId,
  bucketName,
  cancelDownloadDetails,
  clearOperationController,
  completeOperation,
  createOperationController,
  currentPath,
  enabled,
  listAllObjectsForPrefix,
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
}: UseBrowserDownloadsOptions) {
  const [archivePreparation, setArchivePreparation] =
    useState<BrowserArchivePreparation | null>(null);
  const archiveInventoryControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => archiveInventoryControllerRef.current?.abort("unmount"),
    [],
  );
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
      if (!bucketName || !enabled) throw new Error("Missing bucket context.");
      return downloadBrowserTransferBlob({
        selector: accountId,
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
      accountId,
      bucketName,
      enabled,
      presignDownload,
      requestOptions,
      sseCustomerKeyBase64,
      useProxyTransfers,
    ],
  );

  const downloadStream = useCallback(
    async (key: string, signal?: AbortSignal) => {
      if (!bucketName || !enabled) throw new Error("Missing bucket context.");
      return downloadBrowserTransferStream({
        selector: accountId,
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
      accountId,
      bucketName,
      enabled,
      presignDownload,
      requestOptions,
      sseCustomerKeyBase64,
      useProxyTransfers,
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

  const executeArchive = useCallback(
    async (
      basePrefix: string,
      folderLabel: string,
      plan: BrowserFolderDownloadPlan,
      output: BrowserArchiveOutput,
    ) => {
      showOperations();
      const operationId = startOperation(
        "downloading",
        output.kind === "stream" ? "Streaming zip" : "Downloading archive",
        `${bucketName}/${basePrefix}`,
        { kind: "download", cancelable: true },
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      try {
        setDownloadDetails((previous) => ({
          ...previous,
          [operationId]: [...plan.excluded.map(entry => ({ id: makeId(), key: entry.key, label: entry.key, status: "failed" as const, errorMessage: `Excluded: ${entry.reason}` })), ...plan.targets.map((target) => ({
            id: target.detailId,
            key: target.key,
            label: target.relativeKey,
            status: "queued" as const,
            sizeBytes: target.sizeBytes,
          }))],
        }));
        if (plan.excluded.length) onWarning(`${plan.excluded.length} object(s) excluded due to unsafe paths or archive collisions. See operation details.`);
        const archiveResult = await downloadBrowserFolderArchive({
          includeRootFolder: false,
          controller,
          downloadBlob,
          downloadStream,
          folderLabel,
          onDetailChange: (detailId, status, errorMessage) =>
            updateDownloadDetail(
              operationId,
              detailId,
              status,
              errorMessage,
            ),
          onPhaseChange: (label) => updateOperation(operationId, { label }),
          onProgress: (progress) => updateOperation(operationId, { progress }),
          output,
          parallelism,
          memoryLimitBytes:
            Math.max(0, streamingZipThresholdMb) * 1024 * 1024,
          targets: plan.targets,
          totalBytes: plan.totalBytes,
        });
        if (archiveResult.cancelled) {
          completionStatus = "cancelled";
          onStatus(`Download cancelled for ${folderLabel}`);
          cancelDownloadDetails(operationId);
          return;
        }
        if (archiveResult.failedKeys.length > 0) {
          completionStatus = "failed";
          completionError = `Downloaded ${folderLabel} with ${archiveResult.failedKeys.length} failed file(s).`;
          onStatus(completionError);
        } else {
          if (plan.excluded.length) completionStatus = "failed";
          onStatus(`Downloaded ${folderLabel}${plan.excluded.length ? ` (${plan.excluded.length} excluded)` : ""}`);
        }
      } catch (caughtError) {
        if (isAbortError(caughtError) || controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus(`Download cancelled for ${folderLabel}`);
          cancelDownloadDetails(operationId);
        } else {
          completionStatus = "failed";
          console.error(caughtError);
          completionError = formatBrowserOperationError(
            caughtError,
            "Unable to download folder.",
            "Unable to download folder.",
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
      downloadBlob,
      downloadStream,
      onStatus,
      onWarning,
      parallelism,
      setDownloadDetails,
      showOperations,
      startOperation,
      streamingZipThresholdMb,
      updateDownloadDetail,
      updateOperation,
    ],
  );

  const downloadArchive = useCallback(
    async function prepareArchive(
      items: BrowserItem[],
      basePrefix = "",
    ) {
      if (!bucketName || !enabled || !items.length) return;
      archiveInventoryControllerRef.current?.abort("replaced");
      const controller = new AbortController();
      archiveInventoryControllerRef.current = controller;
      onWarning(null);
      const folderLabel = resolveBrowserFolderArchiveLabel(
        items.length === 1 ? items[0].name : "selection",
        basePrefix,
      );
      const totalFolders = items.filter((item) => item.type === "folder" && !item.isDeleted)
            .length;
      setArchivePreparation({
        phase: "inventorying",
        folderLabel,
        completedFolders: 0,
        totalFolders,
      });
      try {
        const objects =
          (await buildBrowserSelectionManifest(
            items,
            listAllObjectsForPrefix,
            controller.signal,
            (completedFolders, enumeratedFolders) =>
              setArchivePreparation((current) =>
                current?.phase === "inventorying" &&
                current.folderLabel === folderLabel
                  ? {
                      ...current,
                      completedFolders,
                      totalFolders: enumeratedFolders,
                    }
                  : current,
              ),
          ));
        controller.signal.throwIfAborted();
        const plan = buildBrowserFolderDownloadPlan(
          objects,
          basePrefix,
          makeId,
        );
        if (plan.excluded.length) {
          onWarning(
            `${plan.excluded.length} object(s) excluded due to unsafe paths or archive collisions.`,
          );
        }
        if (plan.targets.length === 0) {
          if (archiveInventoryControllerRef.current === controller) {
            archiveInventoryControllerRef.current = null;
          }
          setArchivePreparation(null);
          onStatus("No safe files to archive.");
          return;
        }
        const memoryLimitBytes =
          Math.max(0, streamingZipThresholdMb) * 1024 * 1024;
        if (plan.totalBytes >= memoryLimitBytes) {
          const canDownload = canStreamBrowserArchive();
          if (archiveInventoryControllerRef.current === controller) {
            archiveInventoryControllerRef.current = null;
          }
          setArchivePreparation({
            phase: "ready",
            folderLabel,
            fileCount: plan.targets.length,
            totalBytes: plan.totalBytes,
            excludedCount: plan.excluded.length,
            canDownload,
            error: canDownload
              ? undefined
              : "This browser cannot save large ZIP archives as a stream. Select fewer files or use a compatible browser.",
            basePrefix,
            plan,
          });
          return;
        }
        if (archiveInventoryControllerRef.current === controller) {
          archiveInventoryControllerRef.current = null;
        }
        setArchivePreparation(null);
        await executeArchive(
          basePrefix,
          folderLabel,
          plan,
          { kind: "memory" },
        );
      } catch (caughtError) {
        const ownsPreparation =
          archiveInventoryControllerRef.current === controller;
        if (isAbortError(caughtError) || controller.signal.aborted) {
          if (ownsPreparation) {
            setArchivePreparation(null);
            onStatus(`Download preparation cancelled for ${folderLabel}`);
          }
        } else {
          const message = formatBrowserOperationError(
            caughtError,
            "Unable to prepare the archive.",
            "Unable to prepare the archive.",
          );
          if (ownsPreparation) {
            setArchivePreparation(null);
            onStatus(message);
          }
        }
      } finally {
        if (archiveInventoryControllerRef.current === controller) {
          archiveInventoryControllerRef.current = null;
        }
      }
    },
    [
      bucketName,
      enabled,
      executeArchive,
      listAllObjectsForPrefix,
      onStatus,
      onWarning,
      streamingZipThresholdMb,
    ],
  );

  const savePreparedArchive = useCallback(async () => {
    if (archivePreparation?.phase !== "ready" || !archivePreparation.canDownload) {
      return;
    }
    try {
      const fileHandle = await chooseBrowserArchiveFile(
        archivePreparation.folderLabel,
      );
      if (!fileHandle) {
        setArchivePreparation((current) =>
          current?.phase === "ready"
            ? {
                ...current,
                error:
                  "File selection was cancelled. Choose a file when you are ready to start the download.",
              }
            : current,
        );
        return;
      }
      const prepared = archivePreparation;
      setArchivePreparation(null);
      await executeArchive(
        prepared.basePrefix,
        prepared.folderLabel,
        prepared.plan,
        { kind: "stream", fileHandle },
      );
    } catch (caughtError) {
      const message = formatBrowserOperationError(
        caughtError,
        "Unable to choose the archive destination.",
      );
      setArchivePreparation((current) =>
        current?.phase === "ready"
          ? { ...current, error: message }
          : current,
      );
    }
  }, [archivePreparation, executeArchive]);

  const cancelArchivePreparation = useCallback(() => {
    const wasInventorying = archivePreparation?.phase === "inventorying";
    archiveInventoryControllerRef.current?.abort("cancel");
    archiveInventoryControllerRef.current = null;
    setArchivePreparation(null);
    if (wasInventorying) onStatus("Archive preparation cancelled.");
  }, [archivePreparation?.phase, onStatus]);

  const downloadFolder = useCallback((folder: BrowserItem) => {
    const key = folder.key.endsWith("/") ? folder.key.slice(0, -1) : folder.key;
    return downloadArchive([folder], key.slice(0, key.lastIndexOf("/") + 1));
  }, [downloadArchive]);

  const downloadMultipleFiles = useCallback(
    async function runFileDownloads(files: BrowserItem[]): Promise<void> {
      showOperations();
      const operationId = startOperation(
        "downloading",
        `Downloading ${files.length} files`,
        currentPath || bucketName,
        { kind: "download", cancelable: true },
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      const targets = files.map((item) => ({ item, detailId: makeId() }));
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
          progress: Math.min(100, Math.round(base * 100)),
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
                  transferReporter?.fail(reportedId, "Download cancelled.");
                }
                aborted = true;
                controller.abort();
                return;
              }
              console.error(caughtError);
              const errorMessage = formatBrowserOperationError(
                caughtError,
                "Download failed.",
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
          onStatus("Download cancelled.");
          cancelDownloadDetails(operationId);
          return;
        }
        updateOperation(operationId, { progress: 100 });
        onStatus(`Downloaded ${files.length} files`);
        if (failedCount > 0) {
          completionStatus = "failed";
          completionError = `Downloaded ${files.length - failedCount} of ${files.length} files.`;
          onStatus(completionError);
        }
      } catch (caughtError) {
        if (isAbortError(caughtError) || controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus("Download cancelled.");
        } else {
          completionStatus = "failed";
          completionError = formatBrowserOperationError(
            caughtError,
            "Unable to download files.",
            "Unable to download files.",
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
          onWarning("Deleted objects cannot be downloaded directly.");
        }
        return;
      }
      onWarning(
        deletedCount > 0
          ? "Deleted objects were skipped. Open versions to restore before download."
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
                  "Unable to download object.",
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
            ? "Unable to download object."
            : "Unable to generate download URL.",
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
        onWarning("This version cannot be downloaded.");
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
        onStatus(`Downloaded version of ${filename}`);
      } catch (caughtError) {
        const message = formatBrowserOperationError(
          caughtError,
          "Unable to download object version.",
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
    ],
  );

  return {
    archivePreparation,
    cancelArchivePreparation,
    downloadArchive,
    downloadFolder,
    downloadItems,
    downloadVersion,
    savePreparedArchive,
  };
}
