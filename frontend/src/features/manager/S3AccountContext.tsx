/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { S3ExecutionContextSelector } from "../../api/accountParams";
import { ExecutionContext } from "../../api/executionContexts";
import { fetchManagerContext, type ManagerAccessMode } from "../../api/managerContext";
import type { FeatureState } from "../../api/featurePolicies";
import { useExecutionContextCatalog } from "../../hooks/useExecutionContextCatalog";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";

import type { NamingValidationProfile } from "../../utils/resourceNames";

type S3AccountContextType = {
  namingValidationProfile: NamingValidationProfile | null;
  accounts: ExecutionContext[];
  contextsLoaded: boolean;
  selectedS3AccountId: string | null;
  requiresS3AccountSelection: boolean;
  hasS3AccountContext: boolean;
  accountIdForApi: S3ExecutionContextSelector;
  sessionS3AccountName: string | null;
  selectedS3AccountName: string | null;
  selectedS3AccountType: string | null;
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

const S3AccountContext = createContext<S3AccountContextType>({
  namingValidationProfile: null,
  accounts: [],
  contextsLoaded: false,
  selectedS3AccountId: null,
  requiresS3AccountSelection: true,
  hasS3AccountContext: false,
  accountIdForApi: null,
  sessionS3AccountName: null,
  selectedS3AccountName: null,
  selectedS3AccountType: null,
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

type S3AccountProviderScope = "manager" | "browser";

type S3AccountProviderProps = {
  children: ReactNode;
  scope?: S3AccountProviderScope;
};

function deriveS3AccountType(context: ExecutionContext | null | undefined): string | null {
  if (!context) return null;
  if (context.kind === "connection") {
    return "connection";
  }
  if (context.kind === "s3_user") {
    return "s3_user";
  }
  return "tenant";
}

export function S3AccountProvider({ children, scope = "manager" }: S3AccountProviderProps) {
  const executionContextStorageKey = scope === "browser"
    ? CLIENT_STORAGE_KEYS.selectedBrowserExecutionContext
    : CLIENT_STORAGE_KEYS.selectedManagerExecutionContext;
  const {
    contexts: accounts,
    contextsLoaded,
    selectedContextId: selectedS3AccountId,
    selectedContext: selectedS3Account,
    requiresSelection: requiresS3AccountSelection,
    accessError,
    sessionAccountName,
  } = useExecutionContextCatalog({
    scope,
    storageKey: executionContextStorageKey,
    selectionPolicy: "first-available",
    accessDeniedMessage:
      scope === "browser"
        ? "Access to browser contexts is denied for this user."
        : "Access to manager is denied for this user.",
    revokedSelectionMessage: "The previously selected Manager context is no longer authorized.",
  });
  const [namingProfileState, setNamingProfileState] = useState<{ accountId: S3ExecutionContextSelector; profile: NamingValidationProfile } | null>(null);
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
  const hasS3AccountContext = requiresS3AccountSelection ? selectedS3Account !== null : true;
  const accountIdForApi: S3ExecutionContextSelector = requiresS3AccountSelection ? selectedS3AccountId : null;
  const selectedS3AccountName = selectedS3Account?.display_name ?? sessionAccountName;
  const selectedS3AccountType = deriveS3AccountType(selectedS3Account);

  const namingValidationProfile = hasS3AccountContext && namingProfileState?.accountId === accountIdForApi
    ? namingProfileState.profile : null;

  useEffect(() => {
    setNamingProfileState(null);
    if (!hasS3AccountContext) {
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
    fetchManagerContext(accountIdForApi)
      .then((data) => {
        if (!isMounted) return;
        setNamingProfileState({ accountId: accountIdForApi, profile: data.naming_validation_profile ?? "standard" });
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
  }, [accountIdForApi, hasS3AccountContext]);

  return (
    <S3AccountContext.Provider
      value={{
        namingValidationProfile,
        accounts,
        contextsLoaded,
        selectedS3AccountId,
        requiresS3AccountSelection,
        hasS3AccountContext,
        accountIdForApi,
        sessionS3AccountName: sessionAccountName,
        selectedS3AccountName,
        selectedS3AccountType,
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
    </S3AccountContext.Provider>
  );
}

export function useS3AccountContext() {
  return useContext(S3AccountContext);
}
