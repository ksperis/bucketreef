/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, ReactNode } from "react";
import { S3ExecutionContextSelector } from "../../api/accountParams";
import { ExecutionContext, ExecutionContextKind } from "../../api/executionContexts";
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
