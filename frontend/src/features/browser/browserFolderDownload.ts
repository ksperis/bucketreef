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

export type BrowserFolderDownloadTarget = {
  detailId: string;
  key: string;
  relativeKey: string;
  sizeBytes: number;
};

export type BrowserFolderDownloadPlan = {
  targets: BrowserFolderDownloadTarget[];
  totalBytes: number;
  excluded: { key: string; reason: string }[];
};

type WritableFileStream = WritableStream<Uint8Array> & {
  abort?: (reason?: unknown) => Promise<void>;
};

export type BrowserArchiveFileHandle = {
  createWritable: () => Promise<WritableFileStream>;
};

type BrowserArchiveSaveFilePicker = (
  options?: unknown,
) => Promise<BrowserArchiveFileHandle>;

export type BrowserArchiveOutput =
  | { kind: "memory" }
  | { kind: "stream"; fileHandle: BrowserArchiveFileHandle };

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
  output: BrowserArchiveOutput;
  parallelism: number;
  memoryLimitBytes: number;
  finalizationTimeoutMs?: number;
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

const browserArchiveSaveFilePicker = ():
  | BrowserArchiveSaveFilePicker
  | undefined =>
  typeof window === "undefined"
    ? undefined
    : (
        window as Window & {
          showSaveFilePicker?: BrowserArchiveSaveFilePicker;
        }
      ).showSaveFilePicker;

export const canStreamBrowserArchive = (
  picker = browserArchiveSaveFilePicker(),
): boolean =>
  Boolean(
    picker &&
      typeof ReadableStream !== "undefined" &&
      typeof WritableStream !== "undefined" &&
      typeof TransformStream !== "undefined",
  );

export const chooseBrowserArchiveFile = async (
  folderLabel: string,
  picker = browserArchiveSaveFilePicker(),
): Promise<BrowserArchiveFileHandle | null> => {
  if (!canStreamBrowserArchive(picker) || !picker) {
    throw new Error(
      "This browser cannot save large ZIP archives as a stream. Select fewer files or use a compatible browser.",
    );
  }
  try {
    return await picker({
      suggestedName: `${folderLabel}.zip`,
      types: [
        {
          description: "ZIP archive",
          accept: { "application/zip": [".zip"] },
        },
      ],
    });
  } catch (error) {
    if (isAbortError(error)) return null;
    throw error;
  }
};

const abortPartialArchive = (stream: WritableFileStream, reason: unknown) => {
  if (!stream.abort) return;
  void stream.abort(reason).catch(() => undefined);
};

const finalizeStreamingArchive = async (
  zipWriter: ZipWriter<Uint8Array>,
  fileStream: WritableFileStream,
  timeoutMs: number,
) => {
  let finalizationActive = true;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const finalization = (async () => {
    await zipWriter.close(undefined, { preventClose: true });
    if (!finalizationActive) return;
    const writer = fileStream.getWriter();
    try {
      await writer.close();
    } finally {
      writer.releaseLock();
    }
  })();
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `The ZIP archive could not be finalized within ${Math.round(timeoutMs / 1000)} seconds. Delete the partial file and try the download again.`,
        ),
      );
    }, timeoutMs);
  });
  try {
    await Promise.race([finalization, timeout]);
  } catch (error) {
    finalizationActive = false;
    abortPartialArchive(fileStream, error);
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

export const downloadBrowserFolderArchive = async ({
  controller,
  includeRootFolder = true,
  downloadBlob,
  downloadStream,
  folderLabel,
  onDetailChange,
  onPhaseChange,
  onProgress,
  output,
  parallelism,
  memoryLimitBytes,
  finalizationTimeoutMs = 30_000,
  targets,
  totalBytes,
}: BrowserFolderArchiveOptions): Promise<BrowserFolderArchiveResult> => {
  const entryName = (target: BrowserFolderDownloadTarget) => includeRootFolder ? `${folderLabel}/${target.relativeKey}` : target.relativeKey;
  const totalCount = targets.length;
  let downloadedBytes = 0;
  let completed = 0;
  let succeeded = 0;
  let aborted = false;
  const failedKeys: string[] = [];

  const updateTransferProgress = () => {
    const base =
      totalBytes > 0 ? downloadedBytes / totalBytes : completed / totalCount;
    onProgress(Math.min(80, Math.round(base * 80)));
  };
  if (output.kind === "stream") {
    if (!canStreamBrowserArchive(() => Promise.resolve(output.fileHandle))) {
      throw new Error(
        "This browser cannot save large ZIP archives as a stream. Select fewer files or use a compatible browser.",
      );
    }
    let fileStream: WritableFileStream | null = null;
    try {
      fileStream = await output.fileHandle.createWritable();
    } catch (error) {
      if (isAbortError(error)) return { cancelled: true, failedKeys };
      throw error;
    }
    const zipWriter = new ZipWriter<Uint8Array>(fileStream);

    try {
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
          await zipWriter.add(entryName(target), stream.pipeThrough(counter));
          succeeded += 1;
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
        abortPartialArchive(fileStream, controller.signal.reason);
        return { cancelled: true, failedKeys };
      }
      if (succeeded === 0) {
        abortPartialArchive(
          fileStream,
          new Error("No files could be added to the archive."),
        );
        return { cancelled: false, failedKeys };
      }
      await finalizeStreamingArchive(
        zipWriter,
        fileStream,
        finalizationTimeoutMs,
      );
      onProgress(100);
      return { cancelled: false, failedKeys };
    } catch (error) {
      abortPartialArchive(fileStream, error);
      throw error;
    }
  }

  if (totalBytes >= memoryLimitBytes && totalBytes > 0) {
    throw new Error(
      "This archive exceeds the configured in-memory limit. Choose a streaming destination before downloading.",
    );
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
        if (
          retainedBytes + blob.size >= memoryLimitBytes &&
          retainedBytes + blob.size > 0
        ) {
          throw new Error(
            "The files grew beyond the configured archive memory limit. Choose a streaming destination and try again.",
          );
        }
        retainedBytes += blob.size;
        zip.file(entryName(target), blob);
        succeeded += 1;
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
  if (succeeded === 0) {
    return { cancelled: false, failedKeys };
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
