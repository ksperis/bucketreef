/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ZipWriter } from "@zip.js/zip.js";
import JSZip from "jszip";

import type { BrowserObject } from "../../api/browserContracts";
import { runWithConcurrency } from "../../utils/concurrency";
import { triggerBlobDownload } from "../../utils/download";
import { formatBrowserOperationError } from "./browserOperationErrors";
import type { DownloadDetailStatus } from "./browserTypes";
import { isAbortError } from "./browserUtils";

type BrowserFolderDownloadTarget = {
  detailId: string;
  key: string;
  relativeKey: string;
  sizeBytes: number;
};

type BrowserFolderDownloadPlan = {
  targets: BrowserFolderDownloadTarget[];
  totalBytes: number;
  excluded: { key: string; reason: string }[];
};

type WritableFileStream = WritableStream<Uint8Array> & {
  abort?: () => Promise<void>;
};

type SaveFilePicker = (options?: unknown) => Promise<{
  createWritable: () => Promise<WritableStream<Uint8Array>>;
}>;

type BrowserFolderArchiveOptions = {
  includeRootFolder?: boolean;
  controller: AbortController;
  downloadBlob: (key: string, signal: AbortSignal) => Promise<Blob>;
  downloadStream: (
    key: string,
    signal: AbortSignal,
  ) => Promise<ReadableStream<Uint8Array>>;
  folderLabel: string;
  onDetailChange: (
    detailId: string,
    status: DownloadDetailStatus,
    errorMessage?: string,
  ) => void;
  onPhaseChange: (label: "Streaming zip" | "Packaging zip") => void;
  onProgress: (percent: number) => void;
  parallelism: number;
  saveFilePicker?: SaveFilePicker;
  streamingThresholdBytes: number;
  targets: BrowserFolderDownloadTarget[];
  totalBytes: number;
};

type BrowserFolderArchiveResult = {
  cancelled: boolean;
  failedKeys: string[];
};

export const resolveBrowserFolderArchiveLabel = (
  name: string | undefined,
  prefix: string,
): string => {
  const rawLabel = name || prefix.replace(/\/$/, "") || "folder";
  return rawLabel.replace(/[\\/]/g, "-") || "folder";
};

export const buildBrowserFolderDownloadPlan = (
  objects: BrowserObject[],
  folderPrefix: string,
  makeDetailId: () => string,
): BrowserFolderDownloadPlan => {
  const targets: BrowserFolderDownloadTarget[] = [];
  const excluded: { key: string; reason: string }[] = [];
  const seen = new Set<string>();
  const archiveNames = new Set<string>();
  const archiveDirectories = new Set<string>();
  for (const object of objects) {
    if (seen.has(object.key)) continue;
    seen.add(object.key);
    const relativeKey = object.key.startsWith(folderPrefix) ? object.key.slice(folderPrefix.length) : "";
    if (object.key === folderPrefix || (relativeKey.endsWith("/") && object.size === 0)) continue;
    const segments = relativeKey.split("/");
    let reason = !relativeKey || (/[\\:]/.test(relativeKey) || [...relativeKey].some(character => character.charCodeAt(0) < 32)) || segments.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)) ? "Unsafe or ambiguous archive path" : "";
    const canonical = relativeKey.normalize("NFC").toLowerCase();
    const parts = canonical.split("/");
    const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
    if (!reason && (archiveNames.has(canonical) || archiveDirectories.has(canonical) || ancestors.some(parent => archiveNames.has(parent)))) reason = "Archive path collision";
    if (!reason && (!Number.isFinite(object.size) || object.size < 0)) reason = "Object size is unavailable";
    if (reason) { excluded.push({ key: object.key, reason }); continue; }
    archiveNames.add(canonical);
    ancestors.forEach(parent => archiveDirectories.add(parent));
    targets.push({ detailId: makeDetailId(), key: object.key, relativeKey, sizeBytes: object.size });
  }
  return { targets, excluded, totalBytes: targets.reduce((sum, target) => sum + target.sizeBytes, 0) };
};

export const browserArchiveSaveFilePicker = (): SaveFilePicker | undefined =>
  typeof window === "undefined"
    ? undefined
    : (
        window as Window & {
          showSaveFilePicker?: SaveFilePicker;
        }
      ).showSaveFilePicker;

export const downloadBrowserFolderArchive = async ({
  controller,
  includeRootFolder = true,
  downloadBlob,
  downloadStream,
  folderLabel,
  onDetailChange,
  onPhaseChange,
  onProgress,
  parallelism,
  saveFilePicker = browserArchiveSaveFilePicker(),
  streamingThresholdBytes,
  targets,
  totalBytes,
}: BrowserFolderArchiveOptions): Promise<BrowserFolderArchiveResult> => {
  const entryName = (target: BrowserFolderDownloadTarget) => includeRootFolder ? `${folderLabel}/${target.relativeKey}` : target.relativeKey;
  const totalCount = targets.length;
  let downloadedBytes = 0;
  let completed = 0;
  let aborted = false;
  const failedKeys: string[] = [];

  const updateTransferProgress = () => {
    const base =
      totalBytes > 0 ? downloadedBytes / totalBytes : completed / totalCount;
    onProgress(Math.min(80, Math.round(base * 80)));
  };
  const supportsStreamingZip = Boolean(
    saveFilePicker &&
      typeof ReadableStream !== "undefined" &&
      typeof WritableStream !== "undefined" &&
      typeof TransformStream !== "undefined",
  );
  const shouldStreamZip =
    supportsStreamingZip && totalBytes >= streamingThresholdBytes;

  if (!supportsStreamingZip && totalBytes >= streamingThresholdBytes && totalBytes > 0) throw new Error("This archive exceeds the configured in-memory limit. Use a browser with streaming file downloads or select fewer files.");

  if (shouldStreamZip && saveFilePicker) {
    let fileStream: WritableFileStream | null = null;
    let zipWriter: ZipWriter<Uint8Array> | null = null;
    try {
      const handle = await saveFilePicker({
        suggestedName: `${folderLabel}.zip`,
        types: [
          {
            description: "ZIP archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      fileStream = (await handle.createWritable()) as WritableFileStream;
      zipWriter = new ZipWriter(fileStream);
    } catch (error) {
      if (isAbortError(error)) {
        return { cancelled: true, failedKeys };
      }
      throw error;
    }

    onPhaseChange("Streaming zip");
    for (const target of targets) {
      if (controller.signal.aborted) {
        aborted = true;
        break;
      }
      onDetailChange(target.detailId, "downloading");
      try {
        const stream = await downloadStream(target.key, controller.signal);
        const counter = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, streamController) {
            downloadedBytes += chunk.byteLength;
            updateTransferProgress();
            streamController.enqueue(chunk);
          },
        });
        await zipWriter.add(
          entryName(target),
          stream.pipeThrough(counter),
        );
        onDetailChange(target.detailId, "done");
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          onDetailChange(target.detailId, "cancelled");
          aborted = true;
          controller.abort();
          break;
        }
        console.error(error);
        onDetailChange(
          target.detailId,
          "failed",
          formatBrowserOperationError(error, "Download failed."),
        );
        failedKeys.push(target.key);
      } finally {
        completed += 1;
        if (totalBytes <= 0) updateTransferProgress();
      }
    }

    if (aborted || controller.signal.aborted) {
      if (fileStream.abort) await fileStream.abort();
      return { cancelled: true, failedKeys };
    }
    await zipWriter.close();
    onProgress(100);
    return { cancelled: false, failedKeys };
  }

  const zip = new JSZip();
  let retainedBytes = 0;
  await runWithConcurrency(
    targets,
    parallelism,
    async (target) => {
      if (controller.signal.aborted) {
        aborted = true;
        return;
      }
      onDetailChange(target.detailId, "downloading");
      try {
        const blob = await downloadBlob(target.key, controller.signal);
        if (retainedBytes + blob.size > streamingThresholdBytes) throw new Error("The files grew beyond the configured archive memory limit. Use streaming downloads.");
        retainedBytes += blob.size;
        zip.file(entryName(target), blob);
        onDetailChange(target.detailId, "done");
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          onDetailChange(target.detailId, "cancelled");
          aborted = true;
          controller.abort();
          return;
        }
        console.error(error);
        onDetailChange(
          target.detailId,
          "failed",
          formatBrowserOperationError(error, "Download failed."),
        );
        failedKeys.push(target.key);
      } finally {
        completed += 1;
        downloadedBytes += target.sizeBytes;
        updateTransferProgress();
      }
    },
    () => aborted,
  );

  if (aborted || controller.signal.aborted) {
    return { cancelled: true, failedKeys };
  }
  onPhaseChange("Packaging zip");
  const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
    controller.signal.throwIfAborted();
    onProgress(Math.min(99, 80 + Math.round(metadata.percent * 0.2)));
  });
  if (controller.signal.aborted) {
    return { cancelled: true, failedKeys };
  }
  onProgress(100);
  triggerBlobDownload(`${folderLabel}.zip`, zipBlob);
  return { cancelled: false, failedKeys };
};
