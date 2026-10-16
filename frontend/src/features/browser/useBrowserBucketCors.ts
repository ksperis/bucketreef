/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";
import {
  ensureBrowserBucketCors,
  getBrowserBucketCorsStatus,
} from "../../api/browserBuckets";
import type { BucketCorsStatus } from "../../api/browserContracts";
import { resolveBrowserCorsAvailability } from "./browserTransferPresentation";
import { useBrowserI18n } from "./browserI18n";

type ScopedValue<T> = {
  scopeKey: string;
  value: T;
};

type UseBrowserBucketCorsOptions = {
  contextIdForApi: S3ExecutionContextSelector;
  allowAction: boolean;
  bucketName: string;
  enabled: boolean;
  origin?: string;
  requestOptions?: BrowserRequestOptions;
  setStatusMessage: (message: string | null) => void;
};

function createScopeKey(
  contextIdForApi: S3ExecutionContextSelector,
  bucketName: string,
  origin: string | undefined,
  requestOptions: BrowserRequestOptions | undefined,
): string {
  return [
    String(contextIdForApi ?? ""),
    requestOptions?.workspaceSurface ?? "browser",
    bucketName,
    origin ?? "",
  ].join("::");
}

export function useBrowserBucketCors({
  contextIdForApi,
  allowAction,
  bucketName,
  enabled,
  origin,
  requestOptions,
  setStatusMessage,
}: UseBrowserBucketCorsOptions) {
  const { text } = useBrowserI18n();
  const scopeKey = enabled
    ? createScopeKey(contextIdForApi, bucketName, origin, requestOptions)
    : null;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;

  const [statusState, setStatusState] =
    useState<ScopedValue<BucketCorsStatus> | null>(null);
  const [errorState, setErrorState] =
    useState<ScopedValue<string> | null>(null);
  const [fixingScopeKey, setFixingScopeKey] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const status = statusState?.scopeKey === scopeKey ? statusState.value : null;
  const error = errorState?.scopeKey === scopeKey ? errorState.value : null;
  const fixing = fixingScopeKey === scopeKey;
  const actionAvailable = Boolean(
    allowAction &&
      origin &&
      resolveBrowserCorsAvailability(status) === "disabled",
  );

  const setStatus = useCallback(
    (nextStatus: BucketCorsStatus) => {
      if (!scopeKey || activeScopeRef.current !== scopeKey) return;
      setStatusState({ scopeKey, value: nextStatus });
    },
    [scopeKey],
  );
  const setError = useCallback(
    (message: string | null) => {
      if (!scopeKey || activeScopeRef.current !== scopeKey) return;
      setErrorState(message && scopeKey ? { scopeKey, value: message } : null);
    },
    [scopeKey],
  );

  const ensureCors = useCallback(async () => {
    if (!scopeKey || !origin) return;
    const requestedScopeKey = scopeKey;
    setFixingScopeKey(requestedScopeKey);
    setErrorState(null);
    setStatusMessage(null);
    try {
      const nextStatus = await ensureBrowserBucketCors(
        contextIdForApi,
        bucketName,
        origin,
        requestOptions,
      );
      if (activeScopeRef.current !== requestedScopeKey) return;
      setStatusState({ scopeKey: requestedScopeKey, value: nextStatus });
      if (nextStatus.enabled) {
        setStatusMessage(text("CORS rules updated for this bucket."));
        setPopoverOpen(false);
      } else {
        setErrorState({
          scopeKey: requestedScopeKey,
          value:
            nextStatus.error ??
            "CORS is still not enabled for this origin.",
        });
      }
    } catch {
      if (activeScopeRef.current !== requestedScopeKey) return;
      setErrorState({
        scopeKey: requestedScopeKey,
        value: "Unable to update bucket CORS configuration.",
      });
    } finally {
      if (activeScopeRef.current === requestedScopeKey) {
        setFixingScopeKey(null);
      }
    }
  }, [
    contextIdForApi,
    bucketName,
    origin,
    requestOptions,
    scopeKey,
    setStatusMessage,
    text,
  ]);

  useEffect(() => {
    setStatusState(null);
    setErrorState(null);
    setFixingScopeKey(null);
    setPopoverOpen(false);
    if (!scopeKey) return;

    let active = true;
    getBrowserBucketCorsStatus(
      contextIdForApi,
      bucketName,
      origin,
      requestOptions,
    )
      .then((nextStatus) => {
        if (!active || activeScopeRef.current !== scopeKey) return;
        setStatusState({ scopeKey, value: nextStatus });
        setErrorState(null);
      })
      .catch(() => {
        if (!active || activeScopeRef.current !== scopeKey) return;
        setStatusState({
          scopeKey,
          value: {
            enabled: false,
            rules: [],
            error: "Unable to check bucket CORS.",
          },
        });
      });
    return () => {
      active = false;
    };
  }, [contextIdForApi, bucketName, origin, requestOptions, scopeKey]);

  useDismissibleLayer({
    open: popoverOpen,
    insideRefs: [triggerRef, popoverRef],
    onDismiss: () => setPopoverOpen(false),
  });

  useEffect(() => {
    if (!actionAvailable) {
      setPopoverOpen(false);
    }
  }, [actionAvailable]);

  return {
    status,
    error,
    fixing,
    actionAvailable,
    popoverOpen,
    triggerRef,
    popoverRef,
    togglePopover: () => setPopoverOpen((open) => !open),
    ensureCors,
    setStatus,
    setError,
  };
}
