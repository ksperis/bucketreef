/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { S3ExecutionContextSelector } from "../../api/accountParams";
import { ExecutionContext, ExecutionContextKind } from "../../api/executionContexts";
import {
  clearExecutionDestinationForContext,
  setExecutionDestinationForContext,
} from "../../api/executionDestinationState";
import { useExecutionContextCatalog } from "../../hooks/useExecutionContextCatalog";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";

const EXECUTION_CONTEXT_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedBrowserExecutionContext;

type BrowserContextState = {
  contexts: ExecutionContext[];
  contextsLoaded: boolean;
  refreshContexts: (preferredContextId?: string) => Promise<ExecutionContext[]>;
  selectedContextId: string | null;
  selectedContext: ExecutionContext | null;
  requiresContextSelection: boolean;
  hasContext: boolean;
  contextIdForApi: S3ExecutionContextSelector;
  selectedKind: ExecutionContextKind | null;
  selectedExecutionEndpointId: number | null;
  selectedStorageEndpointCapabilities: Record<string, boolean> | null;
  setExecutionEndpointId: (endpointId: number) => void;
  sessionAccountName: string | null;
  accessError?: string | null;
};

const Ctx = createContext<BrowserContextState>({
  contexts: [],
  contextsLoaded: false,
  refreshContexts: async () => [],
  selectedContextId: null,
  selectedContext: null,
  requiresContextSelection: true,
  hasContext: false,
  contextIdForApi: null,
  selectedKind: null,
  selectedExecutionEndpointId: null,
  selectedStorageEndpointCapabilities: null,
  setExecutionEndpointId: () => undefined,
  sessionAccountName: null,
  accessError: null,
});

export function BrowserContextProvider({ children }: { children: ReactNode }) {
  const {
    contexts,
    contextsLoaded,
    refreshContexts,
    selectedContextId,
    selectedContext,
    requiresSelection: requiresContextSelection,
    accessError,
    sessionAccountName,
  } = useExecutionContextCatalog({
    scope: "browser",
    storageKey: EXECUTION_CONTEXT_STORAGE_KEY,
    accessDeniedMessage: "Access to /browser is denied for this user.",
  });
  const selectedKind = selectedContext?.kind ?? null;
  const hasContext = requiresContextSelection ? selectedContext !== null : true;
  const contextIdForApi: S3ExecutionContextSelector = requiresContextSelection ? selectedContextId : null;
  const [selectedExecutionEndpointId, setSelectedExecutionEndpointId] = useState<number | null>(null);
  const previousExecutionContextIdRef = useRef<string | null>(null);
  const executionDestinationIds = useMemo(
    () => selectedContext?.execution_destinations?.map((item) => item.endpoint_id) ?? [],
    [selectedContext?.execution_destinations],
  );
  const destinationSwitchingAvailable = Boolean(
    selectedContext?.kind === "connection"
      && selectedContext.destination_switching_allowed
      && executionDestinationIds.length > 1,
  );
  const selectedExecutionDestination = selectedContext?.execution_destinations?.find(
    (destination) => destination.endpoint_id === selectedExecutionEndpointId,
  ) ?? null;
  const selectedStorageEndpointCapabilities = selectedExecutionDestination?.storage_endpoint_capabilities
    ?? selectedContext?.storage_endpoint_capabilities
    ?? null;

  useEffect(() => {
    const contextChanged = previousExecutionContextIdRef.current !== selectedContextId;
    const originEndpointId = selectedContext?.endpoint_id ?? null;
    setSelectedExecutionEndpointId((current) => {
      if (!destinationSwitchingAvailable || originEndpointId == null) return null;
      if (contextChanged || current == null || !executionDestinationIds.includes(current)) {
        return originEndpointId;
      }
      return current;
    });
    previousExecutionContextIdRef.current = selectedContextId;
  }, [
    destinationSwitchingAvailable,
    executionDestinationIds,
    selectedContext?.endpoint_id,
    selectedContextId,
  ]);

  useEffect(() => {
    if (!selectedContextId) return;
    if (destinationSwitchingAvailable && selectedExecutionEndpointId != null) {
      setExecutionDestinationForContext(selectedContextId, selectedExecutionEndpointId);
    } else {
      clearExecutionDestinationForContext(selectedContextId);
    }
    return () => clearExecutionDestinationForContext(selectedContextId);
  }, [destinationSwitchingAvailable, selectedContextId, selectedExecutionEndpointId]);

  const setExecutionEndpointId = (endpointId: number) => {
    if (!destinationSwitchingAvailable || !executionDestinationIds.includes(endpointId)) return;
    if (selectedContextId) {
      setExecutionDestinationForContext(selectedContextId, endpointId);
    }
    setSelectedExecutionEndpointId(endpointId);
  };

  return (
    <Ctx.Provider
      value={{
        contexts,
        contextsLoaded,
        refreshContexts,
        selectedContextId,
        selectedContext,
        requiresContextSelection,
        hasContext,
        contextIdForApi,
        selectedKind,
        selectedExecutionEndpointId,
        selectedStorageEndpointCapabilities,
        setExecutionEndpointId,
        sessionAccountName,
        accessError,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useBrowserContext() {
  return useContext(Ctx);
}
