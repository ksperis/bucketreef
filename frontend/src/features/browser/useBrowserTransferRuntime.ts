/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { BrowserSettings } from "../../api/browserContracts";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { BrowserFunctionalProfile } from "./browserActions";
import type { BrowserExecutionContextKind } from "./browserPageContract";
import {
  CORS_DIRECT_TRANSFER_WARNING,
  buildBrowserTransferWarnings,
  resolveBrowserCorsAvailability,
  resolveBrowserTransferAccessBadge,
  resolveBrowserTransferParallelism,
  resolveDirectCredentialStsTooltip,
} from "./browserTransferPresentation";
import { useBrowserBucketCors } from "./useBrowserBucketCors";
import { useBrowserI18n } from "./browserI18n";
import { useBrowserPresignRequests } from "./useBrowserPresignRequests";
import { useBrowserSseCustomerKeys } from "./useBrowserSseCustomerKeys";
import { useBrowserStsSession } from "./useBrowserStsSession";
import {
  resolveBrowserUploadMode,
  shouldUseStsPresigner,
} from "./sseBrowserLogic";
import { formatDateTime } from "./browserUtils";

type UseBrowserTransferRuntimeOptions = {
  browserSettings: BrowserSettings | null;
  bucketName: string;
  contextIdForApi: S3ExecutionContextSelector;
  contextSwitchInFlight: boolean;
  executionContextKind: BrowserExecutionContextKind | null;
  functionalProfile: BrowserFunctionalProfile;
  hasExecutionContext: boolean;
  onManualSseKeyCopyRequired: (keyBase64: string) => void;
  requestOptions?: BrowserRequestOptions;
  setStatusMessage: (message: string | null) => void;
  storageEndpointCapabilities: Record<string, boolean> | null;
  warningMessage: string | null;
};

export function useBrowserTransferRuntime({
  browserSettings,
  bucketName,
  contextIdForApi,
  contextSwitchInFlight,
  executionContextKind,
  functionalProfile,
  hasExecutionContext,
  onManualSseKeyCopyRequired,
  requestOptions,
  setStatusMessage,
  storageEndpointCapabilities,
  warningMessage,
}: UseBrowserTransferRuntimeOptions) {
  const { intlLocale, text } = useBrowserI18n();
  const isPortalProfile = functionalProfile === "portal";
  const directCredentialContextKind =
    executionContextKind === "connection"
      ? "connection"
      : executionContextKind === "s3_user"
        ? "s3_user"
        : null;
  const stsEnabled =
    Boolean(storageEndpointCapabilities?.sts) &&
    directCredentialContextKind === null &&
    !isPortalProfile;
  const {
    available: stsAvailable,
    credentials: stsCredentials,
    credentialsError: stsCredentialsError,
    ensureCredentials: ensureStsCredentials,
  } = useBrowserStsSession({
    contextIdForApi,
    enabled: stsEnabled,
    hasContext: hasExecutionContext,
    requestOptions,
  });
  const sseFeatureEnabled =
    Boolean(storageEndpointCapabilities?.sse) && functionalProfile === "advanced";
  const {
    keyBase64: sseCustomerKeyBase64,
    active: sseActive,
    getKeyForScope: getSseCustomerKeyForScope,
    showModal: showSseCustomerModal,
    input: sseCustomerKeyInput,
    visible: sseCustomerKeyVisible,
    error: sseCustomerKeyError,
    notice: sseCustomerKeyNotice,
    canGenerate: canGenerateSseCustomerKey,
    open: openSseCustomerModal,
    updateInput: updateSseCustomerKeyInput,
    toggleVisibility: toggleSseCustomerKeyVisibility,
    generate: generateSseCustomerKey,
    clear: clearSseCustomerKey,
    activate: activateSseCustomerKey,
    close: closeSseCustomerModal,
    dirty: sseCustomerDraftDirty,
  } = useBrowserSseCustomerKeys({
    contextIdForApi,
    bucketName,
    enabled: sseFeatureEnabled,
    onManualCopyRequired: onManualSseKeyCopyRequired,
    setStatusMessage,
  });
  const showSseControls = Boolean(
    sseFeatureEnabled && hasExecutionContext && bucketName,
  );
  const uiOrigin = useMemo(
    () => (typeof window === "undefined" ? undefined : window.location.origin),
    [],
  );
  const {
    status: corsStatus,
    error: corsFixError,
    fixing: corsFixing,
    actionAvailable: hasCorsAction,
    popoverOpen: showCorsActionPopover,
    triggerRef: corsActionTriggerRef,
    popoverRef: corsActionPopoverRef,
    togglePopover: toggleCorsActionPopover,
    ensureCors: handleEnsureCors,
    setStatus: setCorsStatus,
    setError: setCorsFixError,
  } = useBrowserBucketCors({
    contextIdForApi,
    allowAction: !isPortalProfile,
    bucketName,
    enabled:
      !contextSwitchInFlight && Boolean(bucketName) && hasExecutionContext,
    origin: uiOrigin,
    requestOptions,
    setStatusMessage,
  });
  const directUploadAllowed = browserSettings?.allow_direct_uploads ?? false;
  const stsUploadAllowed = browserSettings?.allow_sts_uploads ?? false;
  const proxyAllowed = browserSettings?.allow_proxy_transfers ?? false;
  const corsAvailability = resolveBrowserCorsAvailability(corsStatus);
  const corsEnabled =
    corsAvailability === "unknown" ? null : corsAvailability === "enabled";
  const corsInformation =
    corsEnabled === false ? text(CORS_DIRECT_TRANSFER_WARNING) : null;
  const uploadMode = resolveBrowserUploadMode({
    settingsLoaded: browserSettings !== null,
    hasContext: hasExecutionContext,
    hasBucket: Boolean(bucketName),
    corsEnabled,
    directAllowed: directUploadAllowed,
    stsAllowed: stsUploadAllowed,
    stsAvailable,
    sseActive,
    proxyAllowed,
  });
  const useProxyTransfers = Boolean(
    bucketName &&
      hasExecutionContext &&
      proxyAllowed &&
      corsAvailability === "disabled",
  );
  const uploadTransferParallelism = useMemo(
    () =>
      resolveBrowserTransferParallelism(
        browserSettings,
        uploadMode === "proxy",
      ),
    [browserSettings, uploadMode],
  );
  const downloadTransferParallelism = useMemo(
    () => resolveBrowserTransferParallelism(browserSettings, useProxyTransfers),
    [browserSettings, useProxyTransfers],
  );
  const useStsPresigner = shouldUseStsPresigner({ stsAvailable, sseActive });
  const { presignObjectRequest, presignPartRequest } =
    useBrowserPresignRequests({
      contextId: contextIdForApi,
      ensureStsCredentials,
      requestOptions,
      sseCustomerKeyBase64,
      uploadMode,
      useStsPresigner,
    });
  const warnings = useMemo(
    () =>
      buildBrowserTransferWarnings(
        {
          warningMessage,
          corsFixError,
          stsCredentialsError,
          corsEnabled,
          proxyAllowed,
          uploadUnavailable: Boolean(
            browserSettings &&
              bucketName &&
              hasExecutionContext &&
              uploadMode === "unavailable",
          ),
        },
        text,
      ),
    [
      browserSettings,
      bucketName,
      corsEnabled,
      corsFixError,
      hasExecutionContext,
      proxyAllowed,
      stsCredentialsError,
      text,
      uploadMode,
      warningMessage,
    ],
  );
  const stsExpirationLabel = useMemo(() => {
    if (!stsCredentials?.expiration) return "";
    const formatted = formatDateTime(stsCredentials.expiration, intlLocale);
    return formatted === "-" ? "" : formatted;
  }, [intlLocale, stsCredentials?.expiration]);
  const directCredentialStsTooltip = useMemo(
    () => resolveDirectCredentialStsTooltip(directCredentialContextKind, text),
    [directCredentialContextKind, text],
  );
  const accessBadge = useMemo(
    () =>
      resolveBrowserTransferAccessBadge({
        hasContext: hasExecutionContext && Boolean(bucketName),
        uploadMode,
        sseActive,
        hasStsCredentials: Boolean(stsCredentials),
        stsExpirationLabel,
        directCredentialStsTooltip,
        text,
      }),
    [
      bucketName,
      directCredentialStsTooltip,
      hasExecutionContext,
      sseActive,
      stsCredentials,
      stsExpirationLabel,
      text,
      uploadMode,
    ],
  );

  return {
    accessBadge,
    activateSseCustomerKey,
    canGenerateSseCustomerKey,
    clearSseCustomerKey,
    closeSseCustomerModal,
    corsActionPopoverRef,
    corsActionTriggerRef,
    corsFixing,
    corsInformation,
    downloadParallelism: downloadTransferParallelism.download,
    generateSseCustomerKey,
    getSseCustomerKeyForScope,
    handleEnsureCors,
    hasCorsAction,
    openSseCustomerModal,
    otherOperationsParallelism: downloadTransferParallelism.otherOperations,
    presignObjectRequest,
    presignPartRequest,
    proxyAllowed,
    setCorsFixError,
    setCorsStatus,
    showCorsActionPopover,
    showSseControls,
    showSseCustomerModal,
    sseActive,
    sseCustomerDraftDirty,
    sseCustomerKeyBase64,
    sseCustomerKeyError,
    sseCustomerKeyInput,
    sseCustomerKeyNotice,
    sseCustomerKeyVisible,
    toggleCorsActionPopover,
    toggleSseCustomerKeyVisibility,
    uiOrigin,
    updateSseCustomerKeyInput,
    uploadMode,
    uploadParallelism: uploadTransferParallelism.upload,
    useProxyTransfers,
    warnings,
  };
}
