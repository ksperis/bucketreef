/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { ExecutionContext } from "../../api/executionContexts";
import { fetchManagerContext, type ManagerAccessMode } from "../../api/managerContext";
import type { FeatureState } from "../../api/featurePolicies";
import { useExecutionContextCatalog } from "../../hooks/useExecutionContextCatalog";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";

import type { NamingValidationProfile } from "../../utils/resourceNames";

type ExecutionContextState = {
  namingValidationProfile: NamingValidationProfile | null;
  contexts: ExecutionContext[];
  contextsLoaded: boolean;
  selectedContextId: string | null;
  requiresContextSelection: boolean;
  hasExecutionContext: boolean;
  contextIdForApi: string | null;
  sessionAccountName: string | null;
  selectedContextName: string | null;
  selectedContextKind: ExecutionContext["kind"] | null;
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

const ExecutionContextStateContext = createContext<ExecutionContextState>({
  namingValidationProfile: null,
  contexts: [],
  contextsLoaded: false,
  selectedContextId: null,
  requiresContextSelection: true,
  hasExecutionContext: false,
  contextIdForApi: null,
  sessionAccountName: null,
  selectedContextName: null,
  selectedContextKind: null,
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
});

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
        setNamingProfileState({ contextId: contextIdForApi, profile: data.naming_validation_profile ?? "standard" });
        setIamIdentity(data.iam_identity ?? null);
        setAccessModeState(data.access_mode);
        setManagerStatsEnabled(Boolean(data.manager_stats_enabled));
        setManagerStatsMessage(data.manager_stats_message ?? null);
        setManagerBrowserEnabled(data.manager_browser_enabled === true);
        setManagerBrowserMessage(data.manager_browser_message ?? null);
        setManagerBucketQuotaEnabled(Boolean(data.manager_bucket_quota_enabled));
        setManagerCephKeysEnabled(Boolean(data.manager_ceph_keys_enabled));
        setManagerAccessKeyMetadataEnabled(Boolean(data.manager_access_key_metadata_enabled));
        setManagerAccessKeyExpirationEnabled(Boolean(data.manager_access_key_expiration_enabled));
        setManagerPrivateAccessEnabled(Boolean(data.manager_private_access_enabled));
        setManagerFeatureStates(data.feature_states ?? {});
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
  }, [contextIdForApi, hasExecutionContext]);

  return (
    <ExecutionContextStateContext.Provider
      value={{
        namingValidationProfile,
        contexts,
        contextsLoaded,
        selectedContextId,
        requiresContextSelection,
        hasExecutionContext,
        contextIdForApi,
        sessionAccountName,
        selectedContextName,
        selectedContextKind,
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
