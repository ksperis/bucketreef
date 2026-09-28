import type { PrepareBrowserWrites } from "./useBrowserWriteConflicts";
import type { BrowserWriteGuard } from "../../api/browserConflicts";
import type { CopiedObjectCheckpoint } from "../../api/browserContracts";
import type { ClipboardCopyCheckpoint } from "./browserClipboardTransfer";
/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import {
  normalizeS3AccountSelectorId,
  type S3AccountSelector,
} from "../../api/accountParams";
import {
  copyObject,
  deleteObjects,
  fetchObjectMetadata,
} from "../../api/browserObjects";
import { getBrowserBucketCorsStatus } from "../../api/browserBuckets";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  initiateMultipartUpload,
  presignPart,
  proxyUploadPart,
} from "../../api/browserMultipart";
import { runWithConcurrency } from "../../utils/concurrency";
import type { BrowserFunctionalProfile } from "./browserActions";
import { PART_SIZE } from "./browserConstants";
import {
  transferClipboardObjectBetweenContexts,
  type ClipboardTransferMode,
} from "./browserClipboardTransfer";
import { formatBrowserOperationError } from "./browserOperationErrors";
import { updateOperationDetailById } from "./browserOperationDetailState";
import { resolveBrowserCorsAvailability } from "./browserTransferPresentation";
import {
  downloadBrowserTransferBlob,
  downloadBrowserTransferStream,
  uploadBrowserTransferBlob,
} from "./browserObjectTransferTransport";
import { uploadBrowserStreamMultipart } from "./browserMultipartUpload";
import type {
  BrowserItem,
  ClipboardState,
  CopyDetailItem,
  CopyDetailStatus,
} from "./browserTypes";
import {
  isAbortError,
  makeId,
  shortName,
} from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

export type BrowserTransferDestination = { bucket: string; prefix: string; name?: string };
type BrowserCopyTask = {
  writeGuard?: BrowserWriteGuard; modified?: string; sourceSelector: S3AccountSelector;
  sourceBucket: string; sourceKey: string; destinationBucket: string; destinationKey: string; detailId: string;
  sizeBytes?: number; checkpoint?: CopiedObjectCheckpoint; crossCheckpoint?: ClipboardCopyCheckpoint; done?: boolean;
};
type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;
type ClipboardTransferParameters = Parameters<
  typeof transferClipboardObjectBetweenContexts
>[0];

type UseBrowserClipboardOptions = {
  prepareWrites?: PrepareBrowserWrites;
  accountId: S3AccountSelector;
  bucketName: string;
  cancelCopyDetails: OperationRegistry["cancelCopyDetails"];
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  enabled: boolean;
  functionalProfile: BrowserFunctionalProfile;
  getSseCustomerKeyForScope: (
    selector: S3AccountSelector,
    bucket: string,
  ) => string | null;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  normalizedPrefix: string;
  onRefreshNow: (prefix: string) => Promise<void>;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  parallelism: number;
  proxyAllowed: boolean;
  requestOptions?: BrowserRequestOptions;
  setCopyDetails: OperationRegistry["setCopyDetails"];
  showOperations: () => void;
  startOperation: OperationRegistry["startOperation"];
  uiOrigin?: string;
  updateOperation: OperationRegistry["updateOperation"];
};

export function useBrowserClipboard({
  prepareWrites,
  accountId,
  bucketName,
  cancelCopyDetails,
  clearOperationController,
  completeOperation,
  createOperationController,
  enabled,
  functionalProfile,
  getSseCustomerKeyForScope,
  listAllObjectsForPrefix,
  normalizedPrefix,
  onRefreshNow,
  onStatus,
  onWarning,
  parallelism,
  proxyAllowed,
  requestOptions,
  setCopyDetails,
  showOperations,
  startOperation,
  uiOrigin,
  updateOperation,
}: UseBrowserClipboardOptions) {
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const currentAccountId = normalizeS3AccountSelectorId(accountId);
  const clipboardAccountId = normalizeS3AccountSelectorId(
    clipboard?.sourceSelector ?? null,
  );
  const clipboardMatchesContext = Boolean(
    clipboard && clipboardAccountId === currentAccountId,
  );
  const canPaste = Boolean(clipboard && bucketName && enabled);
  const canPasteInFunctionalProfile =
    canPaste &&
    (functionalProfile === "advanced" || clipboardMatchesContext);

  const copy = useCallback(
    (items: BrowserItem[]) => {
      if (!bucketName || items.length === 0) return;
      const eligibleItems = items.filter((item) => !item.isDeleted);
      if (eligibleItems.length === 0) {
        onWarning("Deleted objects cannot be copied directly.");
        return;
      }
      onWarning(
        eligibleItems.length !== items.length
          ? "Deleted objects were skipped."
          : null,
      );
      setClipboard({
        items: eligibleItems,
        sourceBucket: bucketName,
        sourceSelector: accountId ?? null,
        mode: "copy",
      });
      onStatus("Items copied.");
    },
    [accountId, bucketName, onStatus, onWarning],
  );

  const cut = useCallback(
    (items: BrowserItem[]) => {
      if (!bucketName || items.length === 0) return;
      const eligibleItems = items.filter((item) => !item.isDeleted);
      if (eligibleItems.length === 0) {
        onWarning("Deleted objects cannot be moved directly.");
        return;
      }
      onWarning(
        eligibleItems.length !== items.length
          ? "Deleted objects were skipped."
          : null,
      );
      setClipboard({
        items: eligibleItems,
        sourceBucket: bucketName,
        sourceSelector: accountId ?? null,
        mode: "move",
      });
      onStatus("Items ready to move.");
    },
    [accountId, bucketName, onStatus, onWarning],
  );

  const resolveTransferMode = useCallback(
    async (
      selector: S3AccountSelector,
      targetBucket: string,
    ): Promise<ClipboardTransferMode> => {
      try {
        const status = await getBrowserBucketCorsStatus(
          selector,
          targetBucket,
          uiOrigin,
          requestOptions,
        );
        if (resolveBrowserCorsAvailability(status) !== "disabled") {
          return "direct";
        }
      } catch {
        return "direct";
      }
      if (proxyAllowed) return "proxy";
      throw new Error(
        `Direct transfer is unavailable for ${targetBucket} and proxy transfers are disabled.`,
      );
    },
    [proxyAllowed, requestOptions, uiOrigin],
  );

  const downloadBlob = useCallback<
    ClipboardTransferParameters["downloadBlob"]
  >(
    (parameters) =>
      downloadBrowserTransferBlob({
        ...parameters,
        options: requestOptions,
      }),
    [requestOptions],
  );

  const downloadStream = useCallback<
    ClipboardTransferParameters["downloadStream"]
  >(
    (parameters) =>
      downloadBrowserTransferStream({
        ...parameters,
        options: requestOptions,
      }),
    [requestOptions],
  );

  const uploadBlob = useCallback<ClipboardTransferParameters["uploadBlob"]>(
    (parameters) =>
      uploadBrowserTransferBlob({
        ...parameters,
        options: requestOptions,
      }),
    [requestOptions],
  );

  const uploadMultipartStream = useCallback<
    ClipboardTransferParameters["uploadMultipartStream"]
  >(
    async ({
      mode,
      selector,
      bucket,
      key,
      stream,
      writeGuard,
      sizeBytes,
      contentType,
      sseCustomerKeyBase64,
      signal,
    }) => {
      await uploadBrowserStreamMultipart({
        stream,
        sizeBytes,
        contentType,
        partSize: Math.max(PART_SIZE, Math.ceil(sizeBytes / 10000 / 1048576) * 1048576),
        signal,
        lifecycle: {
          uploadPart: mode === "proxy" ? async (uploadId, number, blob, partSignal) => (await proxyUploadPart(selector, bucket, uploadId, key, number, blob, partSignal, sseCustomerKeyBase64, requestOptions)).etag : undefined,
          initiate: async () => {
            const result = await initiateMultipartUpload(
              selector,
              bucket,
              { key, content_type: contentType ?? undefined },
              sseCustomerKeyBase64,
              requestOptions,
            );
            return result.upload_id;
          },
          presignPart: (uploadId, partNumber) =>
            presignPart(
              selector,
              bucket,
              uploadId,
              { key, part_number: partNumber, expires_in: 1800 },
              sseCustomerKeyBase64,
              requestOptions,
            ),
          complete: (uploadId, parts) =>
            completeMultipartUpload(
              selector,
              bucket,
              uploadId,
              key,
              { parts, write_guard: writeGuard },
              requestOptions,
              sseCustomerKeyBase64,
            ),
          abort: (uploadId) =>
            abortMultipartUpload(
              selector,
              bucket,
              uploadId,
              key,
              requestOptions,
            ),
        },
      });
    },
    [requestOptions],
  );

  const deleteObject = useCallback<ClipboardTransferParameters["deleteObject"]>(
    async ({ selector, bucket, key, etag }) => {
      await deleteObjects(selector, bucket, [{ key, if_match: etag }], undefined, requestOptions);
    },
    [requestOptions],
  );

  const updateCopyDetailStatus = useCallback(
    (
      operationId: string,
      detailId: string,
      status: CopyDetailStatus,
      errorMessage?: string,
    ) => {
      setCopyDetails((previous) =>
        updateOperationDetailById(
          previous,
          operationId,
          detailId,
          status,
          errorMessage,
        ),
      );
    },
    [setCopyDetails],
  );

  const paste = useCallback(async function runPaste(destination?: BrowserTransferDestination, explicitClipboard?: ClipboardState, retryTasks?: BrowserCopyTask[]): Promise<void> {
    const sourceClipboard = explicitClipboard ?? clipboard;
    if (!sourceClipboard || !bucketName || !enabled) return;
    const sameContext = normalizeS3AccountSelectorId(sourceClipboard.sourceSelector) === currentAccountId;
    if (functionalProfile !== "advanced" && !sameContext) {
      onWarning(
        "Cross-context copy and move require the Advanced Browser profile.",
      );
      return;
    }
    onWarning(null);
    const destinationBucket = destination?.bucket ?? bucketName;
    const destinationPrefix = destination?.prefix ?? normalizedPrefix;
    const { items: selectedItems, sourceBucket, sourceSelector, mode } = sourceClipboard;
    // Eliminate overlapping sources before expanding folders into a per-object manifest.
    const items = selectedItems.filter((item, index) => !item.isDeleted && selectedItems.findIndex(other => other.key === item.key) === index && !selectedItems.some(other => other !== item && other.type === "folder" && item.key.startsWith(other.key.endsWith("/") ? other.key : `${other.key}/`)));
    if (sameContext && sourceBucket === destinationBucket && items.some(item => item.type === "folder" && destinationPrefix.startsWith(item.key.endsWith("/") ? item.key : `${item.key}/`))) {
      onWarning("Cannot copy or move a folder into itself or a descendant."); return;
    }
    const isMove = mode === "move";
    const useServerSideCopy = sameContext;
    let copyTasks: BrowserCopyTask[] = retryTasks ?? [];
    const copyDetailItems: CopyDetailItem[] = [];
    let skipped = 0;

    for (const item of retryTasks ? [] : items) {
      if (item.type === "file") {
        const destinationKey = `${destinationPrefix}${destination?.name ?? item.name}`;
        if (
          useServerSideCopy &&
          sourceBucket === destinationBucket &&
          destinationKey === item.key
        ) {
          skipped += 1;
          continue;
        }
        const detailId = makeId();
        copyTasks.push({
          sourceSelector,
          sourceBucket,
          sourceKey: item.key,
          modified: item.modified,
          destinationBucket,
          destinationKey,
          detailId,
        });
        copyDetailItems.push({
          id: detailId,
          key: destinationKey,
          label: shortName(destinationKey, destinationPrefix) || destinationKey,
          status: "queued",
          sizeBytes: item.sizeBytes ?? undefined,
        });
        continue;
      }

      const sourcePrefix = item.key.endsWith("/") ? item.key : `${item.key}/`;
      const destinationFolderPrefix = `${destinationPrefix}${destination?.name ?? item.name}/`;
      if (
        useServerSideCopy &&
        sourceBucket === destinationBucket &&
        destinationFolderPrefix === sourcePrefix
      ) {
        skipped += 1;
        continue;
      }
      const objects = await listAllObjectsForPrefix(
        sourcePrefix,
        sourceBucket,
        sourceSelector,
      );
      objects.forEach((object) => {
        const relativeKey = object.key.startsWith(sourcePrefix)
          ? object.key.slice(sourcePrefix.length)
          : object.key;

        const destinationKey = `${destinationFolderPrefix}${relativeKey}`;
        if (
          useServerSideCopy &&
          sourceBucket === destinationBucket &&
          destinationKey === object.key
        ) {
          skipped += 1;
          return;
        }
        const detailId = makeId();
        copyTasks.push({
          sourceSelector,
          sourceBucket,
          sourceKey: object.key,
          modified: object.last_modified || undefined,
          destinationBucket,
          destinationKey,
          detailId,
        });
        copyDetailItems.push({
          id: detailId,
          key: destinationKey,
          label: shortName(destinationKey, destinationPrefix) || destinationKey,
          status: "queued",
          sizeBytes: object.size ?? undefined,
        });
      });
    }

    if (retryTasks) for (const task of retryTasks) copyDetailItems.push({ id: task.detailId, key: task.destinationKey, label: task.destinationKey, status: "queued", sizeBytes: task.sizeBytes });
    for (const task of copyTasks) task.sizeBytes = copyDetailItems.find(detail => detail.id === task.detailId)?.sizeBytes;
    if (prepareWrites) {
      try {
        const prepared = await prepareWrites(copyTasks.filter(task => !task.checkpoint && !task.crossCheckpoint).map((task) => ({ id: task.detailId, key: task.destinationKey, modified: task.modified, size: copyDetailItems.find((item) => item.id === task.detailId)?.sizeBytes })), destinationBucket);
        const byId = new Map(prepared.map((item) => [item.id, item]));
        copyTasks = copyTasks.flatMap((task) => { if (task.checkpoint || task.crossCheckpoint) return [task]; const ready = byId.get(task.detailId); return ready ? [{ ...task, destinationKey: ready.key, writeGuard: ready.writeGuard }] : []; });
        for (let index = copyDetailItems.length - 1; index >= 0; index--) {
          const ready = byId.get(copyDetailItems[index].id);
          if (!ready && !copyTasks.some(task => task.detailId === copyDetailItems[index].id)) copyDetailItems.splice(index, 1);
          else if (ready) { copyDetailItems[index].key = ready.key; copyDetailItems[index].label = ready.key; }
        }
      } catch (error) { onStatus(error instanceof Error ? error.message : "Destination inspection failed."); return; }
    }

    if (copyTasks.length === 0) {
      onStatus(skipped > 0 ? "Nothing new to paste here." : "No items to paste.");
      return;
    }

    if (copyTasks.length > 1) showOperations();
    const operationId = startOperation(
      "copying",
      isMove ? "Moving items" : "Copying items",
      destinationPrefix
        ? `${destinationBucket}/${destinationPrefix}`
        : destinationBucket,
      { kind: "copy", cancelable: true, destination: { accountId: String(accountId), bucket: destinationBucket, prefix: destinationPrefix } },
      0,
    );
    const controller = createOperationController(operationId);
    setCopyDetails((previous) => ({
      ...previous,
      [operationId]: copyDetailItems,
    }));
    const total = copyTasks.length;
    let completed = 0;
    let succeeded = 0;
    let failures = 0;
    let cancelled = false;
    const updateProgress = () => {
      const progress = total > 0 ? Math.round((completed / total) * 100) : 100;
      updateOperation(operationId, { progress });
    };

    try {
      const transferModeCache = new Map<
        string,
        Promise<ClipboardTransferMode>
      >();
      const resolveTransferModeCached = (
        selector: S3AccountSelector,
        targetBucket: string,
      ) => {
        const cacheKey = `${normalizeS3AccountSelectorId(selector) ?? ""}::${targetBucket}`;
        const cached = transferModeCache.get(cacheKey);
        if (cached) return cached;
        const request = resolveTransferMode(selector, targetBucket);
        transferModeCache.set(cacheKey, request);
        return request;
      };

      await runWithConcurrency(
        copyTasks,
        parallelism,
        async (task) => {
          if (controller.signal.aborted) {
            cancelled = true;
            return;
          }
          try {
            updateCopyDetailStatus(operationId, task.detailId, "copying");
            if (useServerSideCopy) {
              const result = await copyObject(
                accountId,
                destinationBucket,
                {
                  source_bucket: task.sourceBucket,
                  source_key: task.sourceKey,
                  destination_key: task.destinationKey,
                  move: isMove,
                  copied_checkpoint: task.checkpoint,
                  write_guard: task.writeGuard,
                },
                controller.signal,
                requestOptions,
              );
              if (result?.checkpoint) task.checkpoint = result.checkpoint;
              if (isMove && result?.copied && !result.source_deleted) throw new Error(result.reason || "Copied, not deleted.");
            } else {
              const sourceSseCustomerKeyBase64 = getSseCustomerKeyForScope(
                task.sourceSelector,
                task.sourceBucket,
              );
              const destinationSseCustomerKeyBase64 =
                getSseCustomerKeyForScope(accountId, destinationBucket);
              const sourceMetadata = await fetchObjectMetadata(
                task.sourceSelector,
                task.sourceBucket,
                task.sourceKey,
                null,
                sourceSseCustomerKeyBase64,
                controller.signal,
                requestOptions,
              );
              await transferClipboardObjectBetweenContexts({
                checkpoint: task.crossCheckpoint,
                onCopied: checkpoint => { task.crossCheckpoint = checkpoint; },
                source: {
                  selector: task.sourceSelector,
                  bucket: task.sourceBucket,
                  key: task.sourceKey,
                  etag: sourceMetadata.etag ?? undefined,
                  versionId: sourceMetadata.version_id ?? undefined,
                  sseCustomerKeyBase64: sourceSseCustomerKeyBase64,
                },
                destination: {
                  selector: accountId,
                  bucket: destinationBucket,
                  key: task.destinationKey,
                  writeGuard: task.writeGuard,
                  sseCustomerKeyBase64: destinationSseCustomerKeyBase64,
                },
                sizeBytes: sourceMetadata.size,
                contentType: sourceMetadata.content_type ?? undefined,
                move: isMove,
                signal: controller.signal,
                resolveMode: resolveTransferModeCached,
                downloadBlob,
                downloadStream,
                uploadBlob,
                uploadMultipartStream,
                verifyObject: async ({
                  selector,
                  bucket,
                  key,
                  sseCustomerKeyBase64,
                }) => {
                  const metadata = await fetchObjectMetadata(
                    selector,
                    bucket,
                    key,
                    null,
                    sseCustomerKeyBase64,
                    controller.signal,
                    requestOptions,
                  );
                  return { sizeBytes: metadata.size, etag: metadata.etag ?? undefined };
                },
                deleteObject,
              });
            }
            task.done = true;
            updateCopyDetailStatus(operationId, task.detailId, "done");
            succeeded += 1;
          } catch (caughtError) {
            if (isAbortError(caughtError) || controller.signal.aborted) {
              cancelled = true;
              controller.abort();
              updateCopyDetailStatus(
                operationId,
                task.detailId,
                "cancelled",
              );
              return;
            }
            updateCopyDetailStatus(
              operationId,
              task.detailId,
              "failed",
              formatBrowserOperationError(caughtError, "Copy failed."),
            );
            failures += 1;
          } finally {
            completed += 1;
            updateProgress();
          }
        },
        () => cancelled,
      );

      if (cancelled || controller.signal.aborted) {
        cancelCopyDetails(operationId);
        completeOperation(operationId, "cancelled");
        onStatus(
          `${isMove ? "Move" : "Copy"} cancelled after ${succeeded} of ${total} item(s).`,
        );
        await onRefreshNow(normalizedPrefix);
        return;
      }

      const completionError =
        failures > 0 ? "Some items failed to copy or move." : undefined;
      completeOperation(
        operationId,
        failures > 0 ? "failed" : "done",
        completionError,
      );
      onStatus(
        `${isMove ? "Moved" : "Copied"} ${total - failures} of ${total} item(s).`,
      );
      await onRefreshNow(normalizedPrefix);
      if (isMove && failures === 0) setClipboard(null);
    } catch (caughtError) {
      if (isAbortError(caughtError) || controller.signal.aborted) {
        cancelCopyDetails(operationId);
        completeOperation(operationId, "cancelled");
        onStatus(
          `${isMove ? "Move" : "Copy"} cancelled after ${succeeded} of ${total} item(s).`,
        );
        await onRefreshNow(normalizedPrefix);
        return;
      }
      const completionError = formatBrowserOperationError(
        caughtError,
        "Unable to paste items.",
        "Unable to paste items.",
      );
      completeOperation(operationId, "failed", completionError);
      onStatus(completionError);
    } finally {
      clearOperationController(operationId);
      updateOperation(operationId, { resultCounts: { succeeded, failed: failures, cancelled: Math.max(0, total - succeeded - failures) } });
      const pending = copyTasks.filter(task => !task.done);
      if (pending.length) updateOperation(operationId, { retry: async () => {
        updateOperation(operationId, { retry: undefined });
        await runPaste({ ...destination, bucket: destinationBucket, prefix: destinationPrefix }, sourceClipboard, pending);
      } });
    }
  }, [
    accountId,
    bucketName,
    cancelCopyDetails,
    clearOperationController,
    prepareWrites,
    clipboard,
    currentAccountId,
    completeOperation,
    createOperationController,
    deleteObject,
    downloadBlob,
    downloadStream,
    enabled,
    functionalProfile,
    getSseCustomerKeyForScope,
    listAllObjectsForPrefix,
    normalizedPrefix,
    onRefreshNow,
    onStatus,
    onWarning,
    parallelism,
    requestOptions,
    resolveTransferMode,
    setCopyDetails,
    showOperations,
    startOperation,
    updateCopyDetailStatus,
    updateOperation,
    uploadBlob,
    uploadMultipartStream,
  ]);

  const transferTo = useCallback((items: BrowserItem[], destination: BrowserTransferDestination, mode: "copy" | "move") => paste(destination, { items, sourceBucket: bucketName, sourceSelector: accountId, mode }), [accountId, bucketName, paste]);

  return useMemo(
    () => ({
      canPaste: canPasteInFunctionalProfile,
      clipboard,
      copy,
      cut,
      paste,
      transferTo,
    }),
    [canPasteInFunctionalProfile, clipboard, copy, cut, paste, transferTo],
  );
}
