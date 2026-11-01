/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import {
  abortMultipartUpload,
  listMultipartUploads,
  type MultipartUploadItem,
} from "../../api/browserMultipart";
import { extractApiError } from "../../utils/apiError";
import {
  MULTIPART_UPLOADS_HARD_LIMIT,
  MULTIPART_UPLOADS_PAGE_SIZE,
} from "./browserConstants";
import { getMultipartUploadEntryId } from "./browserListingState";
import { useBrowserI18n } from "./browserI18n";

type UseBrowserMultipartUploadsOptions = {
  contextIdForApi: S3ExecutionContextSelector;
  bucketName: string;
  hasContext: boolean;
  requestOptions?: BrowserRequestOptions;
  requestConfirmation: (confirmation: {
    title: string;
    message: string;
    confirmLabel: string;
    tone: "danger";
    onConfirm: () => Promise<void>;
  }) => void;
  setStatusMessage: (message: string) => void;
  setWarningMessage: (message: string) => void;
};

export function useBrowserMultipartUploads({
  contextIdForApi,
  bucketName,
  hasContext,
  requestOptions,
  requestConfirmation,
  setStatusMessage,
  setWarningMessage,
}: UseBrowserMultipartUploadsOptions) {
  const { text, intlLocale } = useBrowserI18n();
  const [showModal, setShowModal] = useState(false);
  const [uploads, setUploads] = useState<MultipartUploadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [nextUploadId, setNextUploadId] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [abortingUploadIds, setAbortingUploadIds] = useState<Set<string>>(
    new Set(),
  );
  const scopeKey = hasContext && bucketName
    ? JSON.stringify([
        contextIdForApi ?? null,
        bucketName,
        requestOptions?.workspaceSurface ?? null,
      ])
    : null;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const sessionRef = useRef(0);
  const loadRequestRef = useRef(0);
  const activeLoadRef = useRef<number | null>(null);
  const uploadsRef = useRef<MultipartUploadItem[]>([]);
  uploadsRef.current = uploads;

  const reset = useCallback(() => {
    sessionRef.current += 1;
    loadRequestRef.current += 1;
    activeLoadRef.current = null;
    uploadsRef.current = [];
    setUploads([]);
    setLoading(false);
    setLoadingMore(false);
    setError(null);
    setNextKey(null);
    setNextUploadId(null);
    setIsTruncated(false);
    setAbortingUploadIds(new Set());
  }, []);

  const loadPage = async (options?: {
    append?: boolean;
    keyMarker?: string | null;
    uploadIdMarker?: string | null;
  }) => {
    if (!scopeKey || activeScopeRef.current !== scopeKey) return;
    const append = Boolean(options?.append);
    if (append && (!isTruncated || activeLoadRef.current !== null)) return;
    const requestedScope = scopeKey;
    const requestedSession = sessionRef.current;
    const requestId = ++loadRequestRef.current;
    activeLoadRef.current = requestId;
    const isCurrentRequest = () =>
      activeScopeRef.current === requestedScope &&
      sessionRef.current === requestedSession &&
      loadRequestRef.current === requestId;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setLoadingMore(false);
      setError(null);
    }
    try {
      const data = await listMultipartUploads(contextIdForApi, bucketName, {
        keyMarker: append ? (options?.keyMarker ?? undefined) : undefined,
        uploadIdMarker: append
          ? (options?.uploadIdMarker ?? undefined)
          : undefined,
        maxUploads: MULTIPART_UPLOADS_PAGE_SIZE,
        ...requestOptions,
      });
      if (!isCurrentRequest()) return;
      const baseUploads = append ? uploadsRef.current : [];
      const knownIds = new Set(
        baseUploads.map((upload) => getMultipartUploadEntryId(upload)),
      );
      const incomingUploads = append
        ? data.uploads.filter(
            (upload) => !knownIds.has(getMultipartUploadEntryId(upload)),
          )
        : data.uploads;
      const mergedUploads = append
        ? [...baseUploads, ...incomingUploads]
        : incomingUploads;
      const limitReached = mergedUploads.length > MULTIPART_UPLOADS_HARD_LIMIT;
      const visibleUploads = mergedUploads.slice(0, MULTIPART_UPLOADS_HARD_LIMIT);
      uploadsRef.current = visibleUploads;
      setUploads(visibleUploads);
      setError(null);
      if (limitReached) {
        setNextKey(null);
        setNextUploadId(null);
        setIsTruncated(false);
        setWarningMessage(
          text("Multipart uploads listing is limited to {count} entries. Narrow your scope to continue.", {
            count: MULTIPART_UPLOADS_HARD_LIMIT.toLocaleString(intlLocale),
          }),
        );
      } else {
        setNextKey(data.next_key ?? null);
        setNextUploadId(data.next_upload_id ?? null);
        setIsTruncated(Boolean(data.is_truncated));
      }
    } catch (loadError) {
      if (!isCurrentRequest()) return;
      setError(
        extractApiError(loadError, text("Unable to list multipart uploads.")),
      );
      if (!append) {
        uploadsRef.current = [];
        setUploads([]);
        setNextKey(null);
        setNextUploadId(null);
        setIsTruncated(false);
      }
    } finally {
      if (isCurrentRequest()) {
        activeLoadRef.current = null;
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    }
  };

  const open = () => {
    if (!scopeKey || activeScopeRef.current !== scopeKey) return;
    setShowModal(true);
    reset();
    void loadPage();
  };

  const refresh = () => {
    if (!scopeKey || activeScopeRef.current !== scopeKey) return;
    void loadPage();
  };

  const loadMore = () => {
    if (
      !scopeKey ||
      activeScopeRef.current !== scopeKey ||
      !isTruncated ||
      loading ||
      loadingMore
    ) {
      return;
    }
    void loadPage({
      append: true,
      keyMarker: nextKey,
      uploadIdMarker: nextUploadId,
    });
  };

  const abort = async (upload: MultipartUploadItem) => {
    if (!scopeKey || activeScopeRef.current !== scopeKey) return;
    const requestedScope = scopeKey;
    const requestedSession = sessionRef.current;
    const isCurrentSession = () =>
      activeScopeRef.current === requestedScope &&
      sessionRef.current === requestedSession;
    const uploadRowId = getMultipartUploadEntryId(upload);
    setAbortingUploadIds((current) => new Set(current).add(uploadRowId));
    try {
      await abortMultipartUpload(
        contextIdForApi,
        bucketName,
        upload.upload_id,
        upload.key,
        requestOptions,
      );
      if (!isCurrentSession()) return;
      setUploads((current) => {
        const nextUploads = current.filter(
          (entry) => getMultipartUploadEntryId(entry) !== uploadRowId,
        );
        uploadsRef.current = nextUploads;
        return nextUploads;
      });
      setStatusMessage(text("Multipart upload aborted for {key}.", { key: upload.key }));
    } catch (abortError) {
      if (!isCurrentSession()) return;
      const message = extractApiError(
        abortError,
        text("Unable to abort multipart upload."),
      );
      setError(message);
      setStatusMessage(message);
    } finally {
      if (isCurrentSession()) {
        setAbortingUploadIds((current) => {
          const next = new Set(current);
          next.delete(uploadRowId);
          return next;
        });
      }
    }
  };

  const requestAbort = (upload: MultipartUploadItem) => {
    requestConfirmation({
      title: text("Abort multipart upload"),
      message: text("Abort multipart upload for {key}?", { key: upload.key }),
      confirmLabel: text("Abort"),
      tone: "danger",
      onConfirm: () => abort(upload),
    });
  };

  useEffect(() => {
    setShowModal(false);
    reset();
  }, [reset, scopeKey]);

  return {
    showModal,
    uploads,
    loading,
    loadingMore,
    error,
    canLoadMore: isTruncated && Boolean(nextKey || nextUploadId),
    abortingUploadIds,
    open,
    refresh,
    loadMore,
    close: () => setShowModal(false),
    requestAbort,
  };
}
