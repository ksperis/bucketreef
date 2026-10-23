/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo } from "react";
import {
  getVisibleBrowserActions,
  isBrowserItemPreviewAvailable,
  resolveBrowserActions,
  TOOLBAR_MORE_PATH_ACTION_IDS,
  TOOLBAR_MORE_SELECTION_FULL_ACTION_IDS,
  TOOLBAR_MORE_SELECTION_OVERFLOW_ACTION_IDS,
  type BrowserCapabilityFacts,
  type BrowserFunctionalProfile,
} from "./browserActions";
import type { BrowserItem, ClipboardState } from "./browserTypes";

type UseBrowserActionStatesOptions = {
  bucketName: string;
  hasExecutionContext: boolean;
  versioningEnabled: boolean;
  canPaste: boolean;
  clipboardMode: ClipboardState["mode"] | null;
  currentPath: string;
  showFolderItems: boolean;
  showDeletedObjects: boolean;
  restorePrefixAvailable: boolean;
  refreshPending: boolean;
  functionalProfile: BrowserFunctionalProfile;
  capabilityFacts: BrowserCapabilityFacts;
  bucketConfigurationAvailable: boolean;
  bucketConfigurationReadOnly: boolean;
  selectionItems: BrowserItem[];
  copyUrlDisabled: boolean;
  copyUrlDisabledReason: string;
  publicLinkAvailable: boolean;
  restoreObjectAvailable: boolean;
  uploadAvailable: boolean;
  uploadDisabledReason: string;
};

export function useBrowserActionStates({
  bucketName,
  hasExecutionContext,
  versioningEnabled,
  canPaste,
  clipboardMode,
  currentPath,
  showFolderItems,
  showDeletedObjects,
  restorePrefixAvailable,
  refreshPending,
  functionalProfile,
  capabilityFacts,
  bucketConfigurationAvailable,
  bucketConfigurationReadOnly,
  selectionItems,
  copyUrlDisabled,
  copyUrlDisabledReason,
  publicLinkAvailable,
  restoreObjectAvailable,
  uploadAvailable,
  uploadDisabledReason,
}: UseBrowserActionStatesOptions) {
  const pathActionStates = useMemo(
    () =>
      resolveBrowserActions({
        scope: "path",
        bucketName,
        hasExecutionContext,
        versioningEnabled,
        canPaste,
        clipboardMode,
        currentPath,
        showFolderItems,
        showDeletedObjects,
        restoreAvailable: restorePrefixAvailable,
        refreshPending,
        uploadAvailable,
        uploadDisabledReason,
        functionalProfile,
        capabilityFacts,
        multipartUploadsAvailable: functionalProfile === "advanced",
        bucketConfigurationAvailable,
        bucketConfigurationReadOnly,
      }),
    [
      bucketName,
      bucketConfigurationAvailable,
      bucketConfigurationReadOnly,
      canPaste,
      capabilityFacts,
      clipboardMode,
      currentPath,
      functionalProfile,
      hasExecutionContext,
      refreshPending,
      restorePrefixAvailable,
      showDeletedObjects,
      showFolderItems,
      uploadAvailable,
      uploadDisabledReason,
      versioningEnabled,
    ],
  );

  const selectionActionStates = useMemo(
    () =>
      resolveBrowserActions({
        scope: "selection",
        items: selectionItems,
        bucketName,
        hasExecutionContext,
        versioningEnabled,
        canPaste,
        clipboardMode,
        copyUrlDisabled,
        copyUrlDisabledReason,
        functionalProfile,
        capabilityFacts,
      }),
    [
      bucketName,
      canPaste,
      capabilityFacts,
      clipboardMode,
      copyUrlDisabled,
      copyUrlDisabledReason,
      functionalProfile,
      hasExecutionContext,
      selectionItems,
      versioningEnabled,
    ],
  );

  const resolveItemActionStates = useCallback(
    (item: BrowserItem) =>
      resolveBrowserActions({
        scope: "item",
        items: [item],
        bucketName,
        hasExecutionContext,
        versioningEnabled,
        canPaste,
        clipboardMode,
        copyUrlDisabled,
        copyUrlDisabledReason,
        publicLinkAvailable,
        restoreAvailable: restoreObjectAvailable,
        detailsAvailable: item.type === "file" || functionalProfile === "advanced",
        functionalProfile,
        capabilityFacts,
        previewAvailable: isBrowserItemPreviewAvailable(item),
      }),
    [
      bucketName,
      canPaste,
      capabilityFacts,
      clipboardMode,
      copyUrlDisabled,
      copyUrlDisabledReason,
      functionalProfile,
      hasExecutionContext,
      publicLinkAvailable,
      restoreObjectAvailable,
      versioningEnabled,
    ],
  );

  const toolbarMorePathActions = useMemo(
    () =>
      getVisibleBrowserActions(
        pathActionStates,
        TOOLBAR_MORE_PATH_ACTION_IDS,
      ),
    [pathActionStates],
  );

  const toolbarMoreSelectionFullActions = useMemo(
    () =>
      getVisibleBrowserActions(
        selectionActionStates,
        TOOLBAR_MORE_SELECTION_FULL_ACTION_IDS,
      ),
    [selectionActionStates],
  );

  const toolbarMoreSelectionOverflowActions = useMemo(
    () =>
      getVisibleBrowserActions(
        selectionActionStates,
        TOOLBAR_MORE_SELECTION_OVERFLOW_ACTION_IDS,
      ),
    [selectionActionStates],
  );

  return {
    pathActionStates,
    selectionActionStates,
    resolveItemActionStates,
    toolbarMorePathActions,
    toolbarMoreSelectionFullActions,
    toolbarMoreSelectionOverflowActions,
  };
}
