/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import { readStoredUser } from "../../utils/workspaces";
import { useBrowserContext } from "./BrowserContext";
import {
  FULL_BROWSER_CAPABILITY_FACTS,
  type BrowserCapabilityFacts,
  type BrowserFunctionalProfile,
} from "./browserActions";
import type { BrowserPageProps } from "./browserPageContract";
import { resolveBrowserWorkspaceContext } from "./browserPageContextModel";
import { readStoredBrowserRootUiState } from "./browserRootUiState";

type BrowserPageRuntimeContextOptions = Pick<
  BrowserPageProps,
  | "contextIdForApi"
  | "executionContextKind"
  | "hasContext"
  | "workspaceSurface"
  | "functionalProfile"
  | "capabilityFacts"
  | "lockedBucketName"
>;

export const useBrowserPageRuntimeContext = ({
  contextIdForApi: contextIdOverride,
  executionContextKind: executionContextKindOverride,
  hasContext: hasContextOverride,
  workspaceSurface: workspaceSurfaceOverride,
  functionalProfile: functionalProfileOverride,
  capabilityFacts: capabilityFactsOverride,
  lockedBucketName,
}: BrowserPageRuntimeContextOptions) => {
  const browserContext = useBrowserContext();
  const selectedContext = browserContext.selectedContext;
  const location = useLocation();
  const workspaceSurface =
    workspaceSurfaceOverride ??
    (selectedContext?.kind === "portal_account" ? "portal" : "browser");
  const workspaceContext = resolveBrowserWorkspaceContext({
    pathname: location.pathname,
    workspaceSurface,
    lockedBucketName,
  });
  const contextIdForApi = contextIdOverride ?? browserContext.contextIdForApi;
  const hasExecutionContext = hasContextOverride ?? browserContext.hasContext;
  const browserRequestOptions = useMemo<BrowserRequestOptions | undefined>(
    () =>
      workspaceSurface === "portal" || workspaceSurface === "manager"
        ? { workspaceSurface }
        : undefined,
    [workspaceSurface],
  );
  const browserRootContextId =
    contextIdForApi == null ? null : String(contextIdForApi);
  const bucketAccessContextKey =
    contextIdForApi == null
      ? null
      : `${workspaceSurface}:${String(contextIdForApi)}`;
  const storedUser = useMemo(() => readStoredUser(), []);
  const userBrowserAdvancedFeaturesEnabled = storedUser
    ? storedUser.authType === "s3_session" ||
      Boolean(storedUser.effective_access?.browser_advanced_features_enabled)
    : true;
  const rootBrowserAdvancedFeaturesEnabled =
    !workspaceContext.isMainBrowserPath || userBrowserAdvancedFeaturesEnabled;
  const initialStoredRootUiState = useMemo(
    () =>
      workspaceContext.isMainBrowserPath
        ? readStoredBrowserRootUiState()
        : null,
    [workspaceContext.isMainBrowserPath],
  );
  const resolvedFunctionalProfile: BrowserFunctionalProfile =
    functionalProfileOverride ??
    (workspaceContext.isPortalBrowserSurface
      ? "portal"
      : rootBrowserAdvancedFeaturesEnabled
        ? "advanced"
        : "standard");
  const resolvedCapabilityFacts = useMemo<BrowserCapabilityFacts>(
    () => capabilityFactsOverride ?? FULL_BROWSER_CAPABILITY_FACTS,
    [capabilityFactsOverride],
  );
  const executionContextKind =
    executionContextKindOverride ?? selectedContext?.kind ?? null;
  const isStorageSpaceContext = executionContextKind === "portal_account";
  const portalAccountId =
    isStorageSpaceContext && contextIdForApi != null
      ? Number(contextIdForApi)
      : null;
  const portalAccountIdForApi =
    portalAccountId != null &&
    Number.isInteger(portalAccountId) &&
    portalAccountId > 0
      ? portalAccountId
      : null;

  return {
    ...workspaceContext,
    selectedContext,
    browserContexts: browserContext.contexts,
    storedUser,
    workspaceSurface,
    contextIdForApi,
    hasExecutionContext,
    browserRequestOptions,
    browserRootContextId,
    bucketAccessContextKey,
    initialStoredRootUiState,
    resolvedFunctionalProfile,
    resolvedCapabilityFacts,
    isPortalProfile: resolvedFunctionalProfile === "portal",
    executionContextKind,
    isStorageSpaceContext,
    portalAccountIdForApi,
    isCephAdminContext: executionContextKind === "ceph_admin",
  };
};
