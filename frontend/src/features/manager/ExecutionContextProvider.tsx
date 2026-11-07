/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { ExecutionContext } from "../../api/executionContexts";
import {
  fetchManagerContext,
  type ManagerAccessMode,
  type ManagerContext,
  type ManagerPrivateAccessState,
} from "../../api/managerContext";
import type { FeatureState } from "../../api/featurePolicies";
import { useExecutionContextCatalog } from "../../hooks/useExecutionContextCatalog";
import { useExecutionDestinationSelection } from "../../hooks/useExecutionDestinationSelection";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";
import { useBrowserContext } from "../browser/BrowserContext";

import type { NamingValidationProfile } from "../../utils/resourceNames";

type ExecutionContextState = {
  namingValidationProfile: NamingValidationProfile | null;
  contexts: ExecutionContext[];
  contextsLoaded: boolean;
  refreshContexts: (preferredContextId?: string) => Promise<ExecutionContext[]>;
  selectedContextId: string | null;
  requiresContextSelection: boolean;
  hasExecutionContext: boolean;
  contextIdForApi: string | null;
  sessionAccountName: string | null;
  selectedContextName: string | null;
  selectedContextKind: ExecutionContext["kind"] | null;
  selectedExecutionEndpointId: number | null;
  selectedStorageEndpointCapabilities: Record<string, boolean> | null;
  setExecutionEndpointId: (endpointId: number) => void;
  accessError?: string | null;
  iamIdentity: string | null;
  accessMode: ManagerAccessMode | null;
  managerStatsEnabled: boolean | null;
  managerStatsMessage: string | null;
  managerBrowserEnabled: boolean | null;
  managerBrowserMessage: string | null;
  managerBucketQuotaEnabled: boolean | null;
  managerCephKeysEnabled: boolean | null;
  managerAccessKeyMetadataEnabled: boolean | null;
  managerAccessKeyExpirationEnabled: boolean | null;
  managerPrivateAccessEnabled: boolean | null;
  managerPrivateAccessState: ManagerPrivateAccessState | null;
  managerFeatureStates: Record<string, FeatureState> | null;
};

type ManagerContextSnapshot = {
  contextId: string | null;
  data: ManagerContext | null;
  failed: boolean;
};

const EMPTY_MANAGER_CONTEXT_SNAPSHOT: ManagerContextSnapshot = {
  contextId: null,
  data: null,
  failed: false,
};

const defaultExecutionContextState: ExecutionContextState = {
  namingValidationProfile: null,
  contexts: [],
  contextsLoaded: false,
  refreshContexts: async () => [],
  selectedContextId: null,
  requiresContextSelection: true,
  hasExecutionContext: false,
  contextIdForApi: null,
  sessionAccountName: null,
  selectedContextName: null,
  selectedContextKind: null,
  selectedExecutionEndpointId: null,
  selectedStorageEndpointCapabilities: null,
  setExecutionEndpointId: () => undefined,
  accessError: null,
  iamIdentity: null,
  accessMode: null,
  managerStatsEnabled: null,
  managerStatsMessage: null,
  managerBrowserEnabled: null,
  managerBrowserMessage: null,
  managerBucketQuotaEnabled: null,
  managerCephKeysEnabled: null,
  managerAccessKeyMetadataEnabled: null,
  managerAccessKeyExpirationEnabled: null,
  managerPrivateAccessEnabled: null,
  managerPrivateAccessState: null,
  managerFeatureStates: null,
};
const ExecutionContextStateContext = createContext<ExecutionContextState>(
  defaultExecutionContextState,
);

type ExecutionContextProviderScope = "manager" | "browser";

type ExecutionContextProviderProps = {
  children: ReactNode;
  scope?: ExecutionContextProviderScope;
};

export function ExecutionContextProvider({ children, scope = "manager" }: ExecutionContextProviderProps) {
  const executionContextStorageKey = scope === "browser"
    ? CLIENT_STORAGE_KEYS.selectedBrowserExecutionContext
    : CLIENT_STORAGE_KEYS.selectedManagerExecutionContext;
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
    scope,
    storageKey: executionContextStorageKey,
    accessDeniedMessage:
      scope === "browser"
        ? "Access to browser contexts is denied for this user."
        : "Access to manager is denied for this user.",
  });
  const [managerContextState, setManagerContextState] = useState<ManagerContextSnapshot>(
    EMPTY_MANAGER_CONTEXT_SNAPSHOT,
  );
  const [managerContextRefreshToken, setManagerContextRefreshToken] = useState(0);
  const hasExecutionContext = requiresContextSelection ? selectedContext !== null : true;
  const contextIdForApi = requiresContextSelection ? selectedContextId : null;
  const selectedContextName = selectedContext?.display_name ?? sessionAccountName;
  const selectedContextKind = selectedContext?.kind ?? null;
  const destinationSwitchingAvailable = Boolean(
    selectedContext?.destination_switching_allowed && selectedContext.execution_destinations.length > 0,
  );
  const {
    selectedExecutionEndpointId,
    selectedStorageEndpointCapabilities,
    setExecutionEndpointId,
  } = useExecutionDestinationSelection({
    selectedContextId,
    selectedContext,
    destinationSwitchingAvailable,
  });

  const namingValidationProfile = hasExecutionContext && managerContextState.contextId === contextIdForApi
    ? managerContextState.data?.naming_validation_profile ?? null : null;

  useEffect(() => {
    if (scope !== "manager") return;
    const handleRefresh = () => setManagerContextRefreshToken((value) => value + 1);
    window.addEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, handleRefresh);
  }, [scope]);

  useEffect(() => {
    setManagerContextState(EMPTY_MANAGER_CONTEXT_SNAPSHOT);
    if (!hasExecutionContext) {
      return;
    }
    let isMounted = true;
    fetchManagerContext(contextIdForApi)
      .then((data) => {
        if (!isMounted) return;
        setManagerContextState({ contextId: contextIdForApi, data, failed: false });
      })
      .catch(() => {
        if (!isMounted) return;
        setManagerContextState({
          ...EMPTY_MANAGER_CONTEXT_SNAPSHOT,
          failed: true,
        });
      });
    return () => {
      isMounted = false;
    };
  }, [contextIdForApi, hasExecutionContext, managerContextRefreshToken, selectedContext, selectedExecutionEndpointId]);

  return (
    <ExecutionContextStateContext.Provider
      value={{
        namingValidationProfile,
        contexts,
        contextsLoaded,
        refreshContexts,
        selectedContextId,
        requiresContextSelection,
        hasExecutionContext,
        contextIdForApi,
        sessionAccountName,
        selectedContextName,
        selectedContextKind,
        selectedExecutionEndpointId,
        selectedStorageEndpointCapabilities,
        setExecutionEndpointId,
        accessError,
        iamIdentity: managerContextState.data?.iam_identity ?? null,
        accessMode: managerContextState.data?.access_mode ?? null,
        managerStatsEnabled: managerContextState.data?.manager_stats_enabled ?? null,
        managerStatsMessage: managerContextState.data?.manager_stats_message ?? null,
        managerBrowserEnabled: managerContextState.data?.manager_browser_enabled ?? null,
        managerBrowserMessage: managerContextState.data?.manager_browser_message ?? null,
        managerBucketQuotaEnabled: managerContextState.data?.manager_bucket_quota_enabled ?? null,
        managerCephKeysEnabled: managerContextState.data?.manager_ceph_keys_enabled ?? null,
        managerAccessKeyMetadataEnabled: managerContextState.data?.manager_access_key_metadata_enabled ?? null,
        managerAccessKeyExpirationEnabled: managerContextState.data?.manager_access_key_expiration_enabled ?? null,
        managerPrivateAccessEnabled: managerContextState.data?.manager_private_access_enabled ?? null,
        managerPrivateAccessState: managerContextState.data?.manager_private_access_state ?? null,
        managerFeatureStates: managerContextState.data?.feature_states
          ?? (managerContextState.failed ? {} : null),
      }}
    >
      {children}
    </ExecutionContextStateContext.Provider>
  );
}

export function useExecutionContext() {
  return useContext(ExecutionContextStateContext);
}

/** Use the Browser's already-authorized catalogue without fetching Manager access. */
export function BrowserBucketExecutionContextProvider({ children }: { children: ReactNode }) {
  const browser = useBrowserContext();
  return (
    <ExecutionContextStateContext.Provider value={{
        ...defaultExecutionContextState,
        contexts: browser.contexts,
        contextsLoaded: browser.contextsLoaded,
        selectedContextId: browser.selectedContextId,
        requiresContextSelection: browser.requiresContextSelection,
        hasExecutionContext: browser.hasContext,
        contextIdForApi: browser.contextIdForApi ?? null,
        sessionAccountName: browser.sessionAccountName,
        selectedContextName: browser.selectedContext?.display_name ?? browser.sessionAccountName,
        selectedContextKind: browser.selectedKind,
        accessError: browser.accessError,
      }}>
      {children}
    </ExecutionContextStateContext.Provider>
  );
}
