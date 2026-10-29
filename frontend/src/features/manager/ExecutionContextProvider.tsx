/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { ExecutionContext } from "../../api/executionContexts";
import {
  clearExecutionDestinationForContext,
  setExecutionDestinationForContext,
} from "../../api/executionDestinationState";
import { fetchManagerContext, type ManagerAccessMode } from "../../api/managerContext";
import type { FeatureState } from "../../api/featurePolicies";
import { useExecutionContextCatalog } from "../../hooks/useExecutionContextCatalog";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";
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
  managerFeatureStates: Record<string, FeatureState> | null;
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
  const [namingProfileState, setNamingProfileState] = useState<{ contextId: string | null; profile: NamingValidationProfile } | null>(null);
  const [iamIdentity, setIamIdentity] = useState<string | null>(null);
  const [accessMode, setAccessModeState] = useState<ManagerAccessMode | null>(null);
  const [managerStatsEnabled, setManagerStatsEnabled] = useState<boolean | null>(null);
  const [managerStatsMessage, setManagerStatsMessage] = useState<string | null>(null);
  const [managerBrowserEnabled, setManagerBrowserEnabled] = useState<boolean | null>(null);
  const [managerBrowserMessage, setManagerBrowserMessage] = useState<string | null>(null);
  const [managerBucketQuotaEnabled, setManagerBucketQuotaEnabled] = useState<boolean | null>(null);
  const [managerCephKeysEnabled, setManagerCephKeysEnabled] = useState<boolean | null>(null);
  const [managerAccessKeyMetadataEnabled, setManagerAccessKeyMetadataEnabled] = useState<boolean | null>(null);
  const [managerAccessKeyExpirationEnabled, setManagerAccessKeyExpirationEnabled] = useState<boolean | null>(null);
  const [managerPrivateAccessEnabled, setManagerPrivateAccessEnabled] = useState<boolean | null>(null);
  const [managerFeatureStates, setManagerFeatureStates] = useState<Record<string, FeatureState> | null>(null);
  const hasExecutionContext = requiresContextSelection ? selectedContext !== null : true;
  const contextIdForApi = requiresContextSelection ? selectedContextId : null;
  const selectedContextName = selectedContext?.display_name ?? sessionAccountName;
  const selectedContextKind = selectedContext?.kind ?? null;
  const [selectedExecutionEndpointId, setSelectedExecutionEndpointId] = useState<number | null>(null);
  const previousExecutionContextIdRef = useRef<string | null>(null);
  const executionDestinationIds = useMemo(
    () => selectedContext?.execution_destinations?.map((item) => item.endpoint_id) ?? [],
    [selectedContext?.execution_destinations],
  );
  const destinationSwitchingAvailable = Boolean(
    selectedContext?.destination_switching_allowed && executionDestinationIds.length > 0,
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

  const namingValidationProfile = hasExecutionContext && namingProfileState?.contextId === contextIdForApi
    ? namingProfileState.profile : null;

  useEffect(() => {
    setNamingProfileState(null);
    if (!hasExecutionContext) {
      setIamIdentity(null);
      setAccessModeState(null);
      setManagerStatsEnabled(null);
      setManagerStatsMessage(null);
      setManagerBrowserEnabled(null);
      setManagerBrowserMessage(null);
      setManagerBucketQuotaEnabled(null);
      setManagerCephKeysEnabled(null);
      setManagerAccessKeyMetadataEnabled(null);
      setManagerAccessKeyExpirationEnabled(null);
      setManagerPrivateAccessEnabled(null);
      setManagerFeatureStates(null);
      return;
    }
    let isMounted = true;
    setManagerStatsEnabled(null);
    setManagerStatsMessage(null);
    setManagerBrowserEnabled(null);
    setManagerBrowserMessage(null);
    setManagerBucketQuotaEnabled(null);
    setManagerCephKeysEnabled(null);
    setManagerAccessKeyMetadataEnabled(null);
    setManagerAccessKeyExpirationEnabled(null);
    setManagerPrivateAccessEnabled(null);
    setManagerFeatureStates(null);
    fetchManagerContext(contextIdForApi)
      .then((data) => {
        if (!isMounted) return;
        setNamingProfileState({ contextId: contextIdForApi, profile: data.naming_validation_profile });
        setIamIdentity(data.iam_identity);
        setAccessModeState(data.access_mode);
        setManagerStatsEnabled(data.manager_stats_enabled);
        setManagerStatsMessage(data.manager_stats_message);
        setManagerBrowserEnabled(data.manager_browser_enabled);
        setManagerBrowserMessage(data.manager_browser_message);
        setManagerBucketQuotaEnabled(data.manager_bucket_quota_enabled);
        setManagerCephKeysEnabled(data.manager_ceph_keys_enabled);
        setManagerAccessKeyMetadataEnabled(data.manager_access_key_metadata_enabled);
        setManagerAccessKeyExpirationEnabled(data.manager_access_key_expiration_enabled);
        setManagerPrivateAccessEnabled(data.manager_private_access_enabled);
        setManagerFeatureStates(data.feature_states);
      })
      .catch(() => {
        if (!isMounted) return;
        setIamIdentity(null);
        setAccessModeState(null);
        setManagerStatsEnabled(null);
        setManagerStatsMessage(null);
        setManagerBrowserEnabled(null);
        setManagerBrowserMessage(null);
        setManagerBucketQuotaEnabled(null);
        setManagerCephKeysEnabled(null);
        setManagerAccessKeyMetadataEnabled(null);
        setManagerAccessKeyExpirationEnabled(null);
        setManagerPrivateAccessEnabled(null);
        setManagerFeatureStates({});
      });
    return () => {
      isMounted = false;
    };
  }, [contextIdForApi, hasExecutionContext, selectedExecutionEndpointId]);

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
        iamIdentity,
        accessMode,
        managerStatsEnabled,
        managerStatsMessage,
        managerBrowserEnabled,
        managerBrowserMessage,
        managerBucketQuotaEnabled,
        managerCephKeysEnabled,
        managerAccessKeyMetadataEnabled,
        managerAccessKeyExpirationEnabled,
        managerPrivateAccessEnabled,
        managerFeatureStates,
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
