/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createRuntimeId } from "../../utils/runtimeId";
import { buildBrowserSelectionManifest } from "./browserSelectionManifest";
import {
  buildBrowserFolderDownloadPlan,
  canStreamBrowserArchive,
  chooseBrowserArchiveFile,
  downloadBrowserFolderArchive,
  resolveBrowserFolderArchiveLabel,
  type BrowserArchiveOutput,
  type BrowserFolderDownloadPlan,
} from "./browserFolderDownload";
import { formatBrowserOperationError } from "./browserOperationErrors";
import type {
  BrowserItem,
  DownloadDetailStatus,
  OperationCompletionStatus,
} from "./browserTypes";
import { isAbortError } from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";
import { useBrowserI18n } from "./browserI18n";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

export type BrowserArchivePreparation =
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

type UseBrowserArchiveDownloadOptions = {
  bucketName: string;
  cancelDownloadDetails: OperationRegistry["cancelDownloadDetails"];
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  downloadBlob: (
    key: string,
    signal?: AbortSignal,
    versionId?: string,
  ) => Promise<Blob>;
  downloadStream: (
    key: string,
    signal?: AbortSignal,
  ) => Promise<ReadableStream<Uint8Array>>;
  enabled: boolean;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  parallelism: number;
  setDownloadDetails: OperationRegistry["setDownloadDetails"];
  showOperations: () => void;
  startOperation: OperationRegistry["startOperation"];
  streamingZipThresholdMb: number;
  updateDownloadDetail: (
    operationId: string,
    detailId: string,
    status: DownloadDetailStatus,
    errorMessage?: string,
  ) => void;
  updateOperation: OperationRegistry["updateOperation"];
};

export function useBrowserArchiveDownload({
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
}: UseBrowserArchiveDownloadOptions) {
  const { text } = useBrowserI18n();
  const [archivePreparation, setArchivePreparation] =
    useState<BrowserArchivePreparation | null>(null);
  const archiveInventoryControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => archiveInventoryControllerRef.current?.abort("unmount"),
    [],
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
        output.kind === "stream" ? text("Streaming zip") : text("Downloading archive"),
        `${bucketName}/${basePrefix}`,
        { kind: "download", cancelable: true },
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      try {
        setDownloadDetails((previous) => ({
          ...previous,
          [operationId]: [
            ...plan.excluded.map((entry) => ({
              id: createRuntimeId(),
              key: entry.key,
              label: entry.key,
              status: "failed" as const,
              errorMessage: text("Excluded: {reason}", { reason: text(entry.reason) }),
            })),
            ...plan.targets.map((target) => ({
              id: target.detailId,
              key: target.key,
              label: target.relativeKey,
              status: "queued" as const,
              sizeBytes: target.sizeBytes,
            })),
          ],
        }));
        if (plan.excluded.length) {
          onWarning(
            text(
              "{count} object(s) excluded due to unsafe paths or archive collisions. See operation details.",
              { count: plan.excluded.length },
            ),
          );
        }
        const archiveResult = await downloadBrowserFolderArchive({
          includeRootFolder: false,
          controller,
          downloadBlob,
          downloadStream,
          folderLabel,
          onDetailChange: (detailId, status, errorMessage) =>
            updateDownloadDetail(operationId, detailId, status, errorMessage),
          onPhaseChange: (label) => updateOperation(operationId, { label }),
          onProgress: (progress) => updateOperation(operationId, { progress }),
          output,
          parallelism,
          memoryLimitBytes: Math.max(0, streamingZipThresholdMb) * 1024 * 1024,
          targets: plan.targets,
          totalBytes: plan.totalBytes,
          text,
        });
        if (archiveResult.cancelled) {
          completionStatus = "cancelled";
          onStatus(text("Download cancelled for {label}", { label: folderLabel }));
          cancelDownloadDetails(operationId);
          return;
        }
        if (archiveResult.failedKeys.length > 0) {
          completionStatus = "failed";
          completionError = text("Downloaded {label} with {count} failed file(s).", {
            label: folderLabel,
            count: archiveResult.failedKeys.length,
          });
          onStatus(completionError);
        } else {
          if (plan.excluded.length) completionStatus = "failed";
          onStatus(
            plan.excluded.length
              ? text("Downloaded {label} ({count} excluded)", {
                  label: folderLabel,
                  count: plan.excluded.length,
                })
              : text("Downloaded {label}", { label: folderLabel }),
          );
        }
      } catch (caughtError) {
        if (isAbortError(caughtError) || controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus(text("Download cancelled for {label}", { label: folderLabel }));
          cancelDownloadDetails(operationId);
        } else {
          completionStatus = "failed";
          console.error(caughtError);
          completionError = formatBrowserOperationError(
            caughtError,
            text("Unable to download folder."),
            text("Unable to download folder."),
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
      text,
      updateDownloadDetail,
      updateOperation,
    ],
  );

  const downloadArchive = useCallback(
    async function prepareArchive(items: BrowserItem[], basePrefix = "") {
      if (!bucketName || !enabled || !items.length) return;
      archiveInventoryControllerRef.current?.abort("replaced");
      const controller = new AbortController();
      archiveInventoryControllerRef.current = controller;
      onWarning(null);
      const folderLabel = resolveBrowserFolderArchiveLabel(
        items.length === 1 ? items[0].name : "selection",
        basePrefix,
      );
      const totalFolders = items.filter(
        (item) => item.type === "folder" && !item.isDeleted,
      ).length;
      setArchivePreparation({
        phase: "inventorying",
        folderLabel,
        completedFolders: 0,
        totalFolders,
      });
      try {
        const objects = await buildBrowserSelectionManifest(
          items,
          listAllObjectsForPrefix,
          controller.signal,
          (completedFolders, enumeratedFolders) =>
            setArchivePreparation((current) =>
              current?.phase === "inventorying" && current.folderLabel === folderLabel
                ? {
                    ...current,
                    completedFolders,
                    totalFolders: enumeratedFolders,
                  }
                : current,
            ),
          text,
        );
        controller.signal.throwIfAborted();
        const plan = buildBrowserFolderDownloadPlan(objects, basePrefix, createRuntimeId);
        if (plan.excluded.length) {
          onWarning(
            text("{count} object(s) excluded due to unsafe paths or archive collisions.", {
              count: plan.excluded.length,
            }),
          );
        }
        if (plan.targets.length === 0) {
          if (archiveInventoryControllerRef.current === controller) {
            archiveInventoryControllerRef.current = null;
          }
          setArchivePreparation(null);
          onStatus(text("No safe files to archive."));
          return;
        }
        const memoryLimitBytes = Math.max(0, streamingZipThresholdMb) * 1024 * 1024;
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
              : text(
                  "This browser cannot save large ZIP archives as a stream. Select fewer files or use a compatible browser.",
                ),
            basePrefix,
            plan,
          });
          return;
        }
        if (archiveInventoryControllerRef.current === controller) {
          archiveInventoryControllerRef.current = null;
        }
        setArchivePreparation(null);
        await executeArchive(basePrefix, folderLabel, plan, { kind: "memory" });
      } catch (caughtError) {
        const ownsPreparation = archiveInventoryControllerRef.current === controller;
        if (isAbortError(caughtError) || controller.signal.aborted) {
          if (ownsPreparation) {
            setArchivePreparation(null);
            onStatus(
              text("Download preparation cancelled for {label}", { label: folderLabel }),
            );
          }
        } else {
          const message = formatBrowserOperationError(
            caughtError,
            text("Unable to prepare the archive."),
            text("Unable to prepare the archive."),
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
      text,
    ],
  );

  const savePreparedArchive = useCallback(async () => {
    if (archivePreparation?.phase !== "ready" || !archivePreparation.canDownload) {
      return;
    }
    try {
      const fileHandle = await chooseBrowserArchiveFile(
        archivePreparation.folderLabel,
        undefined,
        text,
      );
      if (!fileHandle) {
        setArchivePreparation((current) =>
          current?.phase === "ready"
            ? {
                ...current,
                error: text(
                  "File selection was cancelled. Choose a file when you are ready to start the download.",
                ),
              }
            : current,
        );
        return;
      }
      const prepared = archivePreparation;
      setArchivePreparation(null);
      await executeArchive(prepared.basePrefix, prepared.folderLabel, prepared.plan, {
        kind: "stream",
        fileHandle,
      });
    } catch (caughtError) {
      const message = formatBrowserOperationError(
        caughtError,
        text("Unable to choose the archive destination."),
      );
      setArchivePreparation((current) =>
        current?.phase === "ready" ? { ...current, error: message } : current,
      );
    }
  }, [archivePreparation, executeArchive, text]);

  const cancelArchivePreparation = useCallback(() => {
    const wasInventorying = archivePreparation?.phase === "inventorying";
    archiveInventoryControllerRef.current?.abort("cancel");
    archiveInventoryControllerRef.current = null;
    setArchivePreparation(null);
    if (wasInventorying) onStatus(text("Archive preparation cancelled."));
  }, [archivePreparation?.phase, onStatus, text]);

  const downloadFolder = useCallback(
    (folder: BrowserItem) => {
      const key = folder.key.endsWith("/") ? folder.key.slice(0, -1) : folder.key;
      return downloadArchive([folder], key.slice(0, key.lastIndexOf("/") + 1));
    },
    [downloadArchive],
  );

  return {
    archivePreparation,
    cancelArchivePreparation,
    downloadArchive,
    downloadFolder,
    savePreparedArchive,
  };
}
