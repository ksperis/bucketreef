/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useBrowserI18n } from "./browserI18n";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import {
  getBrowserStsCredentials,
  getBrowserStsStatus,
} from "../../api/browserSts";
import type {
  StsCredentials,
  StsStatus,
} from "../../api/browserContracts";
import { extractApiError } from "../../utils/apiError";
import { isStsCredentialsExpiring } from "./browserTransferPresentation";

type ScopedValue<T> = {
  scopeKey: string;
  value: T;
};

type InFlightCredentials = {
  scopeKey: string;
  request: Promise<StsCredentials | null>;
};

type UseBrowserStsSessionOptions = {
  contextIdForApi: S3ExecutionContextSelector;
  enabled: boolean;
  hasContext: boolean;
  requestOptions?: BrowserRequestOptions;
};

function createScopeKey(
  contextIdForApi: S3ExecutionContextSelector,
  requestOptions?: BrowserRequestOptions,
): string {
  return `${String(contextIdForApi ?? "")}::${requestOptions?.workspaceSurface ?? "browser"}`;
}

export function useBrowserStsSession({
  contextIdForApi,
  enabled,
  hasContext,
  requestOptions,
}: UseBrowserStsSessionOptions) {
  const { text } = useBrowserI18n();
  const scopeKey =
    enabled && hasContext
      ? createScopeKey(contextIdForApi, requestOptions)
      : null;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;

  const [statusState, setStatusState] =
    useState<ScopedValue<StsStatus> | null>(null);
  const [credentialsState, setCredentialsState] =
    useState<ScopedValue<StsCredentials> | null>(null);
  const [errorState, setErrorState] =
    useState<ScopedValue<string> | null>(null);
  const credentialsCacheRef = useRef<ScopedValue<StsCredentials> | null>(null);
  const inFlightRef = useRef<InFlightCredentials | null>(null);

  const status = statusState?.scopeKey === scopeKey ? statusState.value : null;
  const credentials =
    credentialsState?.scopeKey === scopeKey ? credentialsState.value : null;
  const credentialsError =
    errorState?.scopeKey === scopeKey ? errorState.value : null;

  const ensureCredentials = useCallback(
    async (force = false): Promise<StsCredentials | null> => {
      if (!scopeKey || !status?.available) return null;

      const cached = credentialsCacheRef.current;
      if (
        !force &&
        cached?.scopeKey === scopeKey &&
        !isStsCredentialsExpiring(cached.value.expiration)
      ) {
        return cached.value;
      }

      const inFlight = inFlightRef.current;
      if (inFlight?.scopeKey === scopeKey) {
        return inFlight.request;
      }

      const requestedScopeKey = scopeKey;
      const request = getBrowserStsCredentials(contextIdForApi, requestOptions)
        .then((nextCredentials) => {
          if (activeScopeRef.current !== requestedScopeKey) return null;
          const scopedCredentials = {
            scopeKey: requestedScopeKey,
            value: nextCredentials,
          };
          credentialsCacheRef.current = scopedCredentials;
          setCredentialsState(scopedCredentials);
          setErrorState(null);
          return nextCredentials;
        })
        .catch((requestError) => {
          if (activeScopeRef.current !== requestedScopeKey) return null;
          credentialsCacheRef.current = null;
          setCredentialsState(null);
          setErrorState({
            scopeKey: requestedScopeKey,
            value: extractApiError(
              requestError,
              "Unable to load STS credentials.",
            ),
          });
          return null;
        })
        .finally(() => {
          if (inFlightRef.current?.request === request) {
            inFlightRef.current = null;
          }
        });
      inFlightRef.current = { scopeKey: requestedScopeKey, request };
      return request;
    }, [
      contextIdForApi,
      requestOptions,
      scopeKey,
      status?.available,
    ],
  );

  useEffect(() => {
    credentialsCacheRef.current = null;
    setStatusState(null);
    setCredentialsState(null);
    setErrorState(null);
    if (!scopeKey) return;

    let active = true;
    getBrowserStsStatus(contextIdForApi, requestOptions)
      .then((nextStatus) => {
        if (!active || activeScopeRef.current !== scopeKey) return;
        setStatusState({ scopeKey, value: nextStatus });
      })
      .catch((statusError) => {
        if (!active || activeScopeRef.current !== scopeKey) return;
        setStatusState({
          scopeKey,
          value: {
            available: false,
            error: extractApiError(
              statusError,
              "Unable to reach STS endpoint.",
            ),
          },
        });
      });
    return () => {
      active = false;
    };
  }, [contextIdForApi, requestOptions, scopeKey]);

  useEffect(() => {
    if (!status?.available) return;
    void ensureCredentials(true);
  }, [ensureCredentials, status?.available]);

  return {
    available: Boolean(scopeKey && status?.available),
    credentials,
    credentialsError: credentialsError ? text(credentialsError) : null,
    ensureCredentials,
  };
}
