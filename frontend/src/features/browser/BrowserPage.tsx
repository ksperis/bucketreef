/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";
import { readStoredUser } from "../../utils/workspaces";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import { useBrowserContext } from "./BrowserContext";
import { useBrowserSidebarSlot } from "./BrowserLayout";
import BrowserBulkAttributesModal from "./BrowserBulkAttributesModal";
import BrowserObjectExplorer from "./BrowserObjectExplorer";
import BrowserObjectSearchHeader from "./BrowserObjectSearchHeader";
import BrowserFoldersPanel from "./BrowserFoldersPanel";
import BrowserToolbar from "./BrowserToolbar";
import BrowserNoticesPanel from "./BrowserNoticesPanel";
import BrowserObjectsIssueDescription from "./BrowserObjectsIssueDescription";
import { useBrowserBulkAttributes } from "./useBrowserBulkAttributes";
import { useBrowserBulkRestore } from "./useBrowserBulkRestore";
import { useBrowserBucketPanelViewport } from "./useBrowserBucketPanelViewport";
import { useBrowserBucketCatalog } from "./useBrowserBucketCatalog";
import { useBrowserBucketInteractions } from "./useBrowserBucketInteractions";
import { useBrowserClipboard } from "./useBrowserClipboard";
import { useBrowserConfirmDialog } from "./useBrowserConfirmDialog";
import { useBrowserContextMenu } from "./useBrowserContextMenu";
import { useBrowserCopyActions } from "./useBrowserCopyActions";
import { useBrowserCopyDialog } from "./useBrowserCopyDialog";
import { useBrowserCreateBucket } from "./useBrowserCreateBucket";
import { useBrowserCreateFolder } from "./useBrowserCreateFolder";
import { useBrowserDeleteItems } from "./useBrowserDeleteItems";
import { useBrowserDensity } from "./useBrowserDensity";
import { useBrowserDownloads } from "./useBrowserDownloads";
import { useBrowserFolderTree } from "./useBrowserFolderTree";
import { useBrowserLazyColumns } from "./useBrowserLazyColumns";
import { useBrowserKeyboardShortcuts } from "./useBrowserKeyboardShortcuts";
import { useBrowserListingRefresh } from "./useBrowserListingRefresh";
import { useBrowserListingVisibility } from "./useBrowserListingVisibility";
import { useBrowserLeaveGuard } from "./useBrowserLeaveGuard";
import { useBrowserMultipartUploads } from "./useBrowserMultipartUploads";
import { useBrowserNotices } from "./useBrowserNotices";
import { useBrowserFavoritesRuntime } from "./useBrowserFavoritesRuntime";
import { useBrowserObjectColumns } from "./useBrowserObjectColumns";
import { useBrowserDetailsDrawerState } from "./useBrowserDetailsDrawerState";
import { useBrowserObjectListing } from "./useBrowserObjectListing";
import { useBrowserObjectSort } from "./useBrowserObjectSort";
import { useBrowserOperationOverview } from "./useBrowserOperationOverview";
import { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import { useBrowserPanelLayout } from "./useBrowserPanelLayout";
import { useBrowserPathRuntime } from "./useBrowserPathRuntime";
import { useBrowserPrefixVersions } from "./useBrowserPrefixVersions";
import { useBrowserQueuedUpload } from "./useBrowserQueuedUpload";
import { useBrowserRuntimeData } from "./useBrowserRuntimeData";
import { useBrowserRecursiveObjectListing } from "./useBrowserRecursiveObjectListing";
import { useBrowserSearch } from "./useBrowserSearch";
import { useBrowserSelection } from "./useBrowserSelection";
import { useBrowserObjectNavigation } from "./useBrowserObjectNavigation";
import { useBrowserTransferRuntime } from "./useBrowserTransferRuntime";
import { useBrowserUploadQueue } from "./useBrowserUploadQueue";
import { useBrowserVersionCleanup } from "./useBrowserVersionCleanup";
import { useBrowserVersionActions } from "./useBrowserVersionActions";
import { useBrowserWorkspaceAccountAction } from "./useBrowserWorkspaceAccountAction";
import { useBrowserWorkspaceSidebarBody } from "./useBrowserWorkspaceSidebarBody";
import BrowserBulkRestoreModal from "./BrowserBulkRestoreModal";
import BrowserArchivePreparationDialog from "./BrowserArchivePreparationDialog";
import BrowserCleanupModal from "./BrowserCleanupModal";
import {
  FULL_BROWSER_CAPABILITY_FACTS,
  type BrowserActionId,
  type BrowserCapabilityFacts,
  type BrowserFunctionalProfile,
  runBrowserAction,
} from "./browserActions";
import { useBrowserActionStates } from "./useBrowserActionStates";
import {
  BrowserConfirmModal,
  BrowserCopyValueModal,
} from "./BrowserDialogModals";
import {
  BrowserBucketConfigurationDrawer,
  BrowserCreateBucketModal,
  BrowserCreateFolderModal,
  BrowserSseCustomerKeyModal,
} from "./BrowserBucketDialogModals";
import BrowserContextMenu from "./BrowserContextMenu";
import BrowserObjectDetailsDrawer from "./BrowserObjectDetailsDrawer";
import { resolveStorageSpaceObjectDetailsView } from "../shared/objectDetailsContract";
import BrowserPathDetailsDrawer from "./BrowserPathDetailsDrawer";
import BrowserStorageSpaceObjectDetailsDrawer from "./BrowserStorageSpaceObjectDetailsDrawer";
import BrowserOperationsModal from "./BrowserOperationsModal";
import BrowserOperationsPanel from "./BrowserOperationsPanel";
import BrowserMultipartUploadsModal from "./BrowserMultipartUploadsModal";
import BrowserMobileSelectionActions from "./BrowserMobileSelectionActions";
import BrowserPrefixVersionsModal from "./BrowserPrefixVersionsModal";
import {
  DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  MAX_FOLDERS_PANEL_WIDTH_PX,
  MIN_FOLDERS_PANEL_WIDTH_PX,
  readStoredBrowserRootUiState,
} from "./browserRootUiState";
import { storageClassOptions } from "./browserConstants";
import type { BrowserPageProps } from "./browserPageContract";
import { getSelectionInfo, normalizePrefix } from "./browserUtils";
import {
  PANEL_LAYOUT_GAP_PX,
  PANEL_RESIZER_HITBOX_WIDTH_PX,
} from "./browserPanelLayout";
import {
  COLUMN_DEFINITIONS,
  DEFAULT_VISIBLE_COLUMN_IDS,
  SELECTION_COLUMN_WIDTH_PX,
  buildBrowserObjectTableLayout,
  buildBrowserItems,
  collectAvailableStorageClasses,
  type BrowserColumnId,
} from "./browserObjectTableModel";
import {
  buildBrowserBucketPresentation,
} from "./browserBucketModel";
import {
  resolveBrowserWorkspaceContext,
} from "./browserPageContextModel";
import type {
  BrowserItem,
  UploadQueueItem,
} from "./browserTypes";
import { useBrowserI18n } from "./browserI18n";

const MOBILE_OBJECT_LIST_MEDIA_QUERY = "(max-width: 767px)";

const DEFAULT_STREAMING_ZIP_THRESHOLD_MB = 200;

const browserShellClasses =
  "flex min-h-0 flex-1 flex-col overflow-hidden";
export default function BrowserPage({
  contextIdForApi: contextIdOverride,
  executionContextKind: executionContextKindOverride,
  hasContext: hasContextOverride,
  workspaceSurface: workspaceSurfaceOverride,
  functionalProfile: functionalProfileOverride,
  density: densityOverride,
  capabilityFacts: capabilityFactsOverride,
  lockedBucketName,
  lockedBucketLabel,
  storageEndpointCapabilities,
  allowFoldersPanel = true,
  showPanelToggles = true,
  defaultShowFolders = false,
  onSelectedBucketNameChange,
  onLoadedFilesChange,
  onOpenObjectDetails,
  deletedObjectsOptions,
  refreshToken,
  transferReporter,
}: BrowserPageProps = {}) {
  const { text, intlLocale } = useBrowserI18n();
  const browserContext = useBrowserContext();
  const { setSidebarBody } = useBrowserSidebarSlot();
  const selectedContext = browserContext.selectedContext;
  const location = useLocation();
  const workspaceSurface =
    workspaceSurfaceOverride ??
    (selectedContext?.kind === "portal_account" ? "portal" : "browser");
  const {
    normalizedPath,
    isPortalBrowserSurface,
    isMainBrowserPath,
    isEmbeddedBrowserPath,
    usePortalWorkspaceLabels,
    workspaceNoun,
    selectorWorkspaceNoun,
    selectorWorkspaceNounPlural,
    selectorWorkspaceNounTitle,
    workspaceObjectNounPlural,
    resolvedLockedBucketName,
    showWorkspaceSidebar,
  } = resolveBrowserWorkspaceContext({
    pathname: location.pathname,
    workspaceSurface,
    lockedBucketName,
  });
  const contextIdForApi = contextIdOverride ?? browserContext.contextIdForApi;
  const hasExecutionContext = hasContextOverride ?? browserContext.hasContext;
  const canOpenExternalObjectDetails = Boolean(onOpenObjectDetails);
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
    contextIdForApi == null ? null : `${workspaceSurface}:${String(contextIdForApi)}`;
  const storedUser = useMemo(() => readStoredUser(), []);
  const userBrowserAdvancedFeaturesEnabled = storedUser
    ? storedUser.authType === "s3_session" ||
      Boolean(storedUser.effective_access?.browser_advanced_features_enabled)
    : true;
  const rootBrowserAdvancedFeaturesEnabled =
    !isMainBrowserPath || userBrowserAdvancedFeaturesEnabled;
  const initialStoredRootUiState = useMemo(
    () => (isMainBrowserPath ? readStoredBrowserRootUiState() : null),
    [isMainBrowserPath],
  );
  const resolvedFunctionalProfile: BrowserFunctionalProfile =
    functionalProfileOverride ??
    (isPortalBrowserSurface
      ? "portal"
      : rootBrowserAdvancedFeaturesEnabled
        ? "advanced"
        : "standard");
  const resolvedCapabilityFacts = useMemo<BrowserCapabilityFacts>(
    () => capabilityFactsOverride ?? FULL_BROWSER_CAPABILITY_FACTS,
    [capabilityFactsOverride],
  );
  const isPortalProfile = resolvedFunctionalProfile === "portal";
  const executionContextKind =
    executionContextKindOverride ?? selectedContext?.kind ?? null;
  const isStorageSpaceContext = executionContextKind === "portal_account";
  const portalAccountId = isStorageSpaceContext && contextIdForApi != null
    ? Number(contextIdForApi)
    : null;
  const portalAccountIdForApi = portalAccountId != null && Number.isInteger(portalAccountId) && portalAccountId > 0
    ? portalAccountId
    : null;
  const isCephAdminContext = executionContextKind === "ceph_admin";
  const [showBucketMenu, setShowBucketMenu] = useState(false);
  const {
    settings: browserSettings,
    usageError: usageSummaryError,
    usageLoading: usageSummaryLoading,
    usageSummary,
  } = useBrowserRuntimeData({
    contextId: contextIdForApi,
    enabled: hasExecutionContext,
    requestOptions: browserRequestOptions,
    showUsage: showWorkspaceSidebar,
  });
  const [searchParams] = useSearchParams();
  const requestedBucket = useMemo(
    () => searchParams.get("bucket")?.trim() ?? "",
    [searchParams],
  );
  const requestedPrefix = useMemo(
    () => normalizePrefix(searchParams.get("prefix") ?? ""),
    [searchParams],
  );
  const {
    accessByName: bucketAccessByName,
    contextSwitchInFlight,
    bucketError,
    bucketFilter,
    bucketMenuItems,
    bucketMenuLoadingMore,
    bucketMenuTotal,
    bucketName,
    bucketTotalCount,
    canLoadMore: canLoadMoreBucketResults,
    getBucketAccessEntry,
    loadMore: handleBucketMenuLoadMore,
    loadingBuckets,
    prefix,
    refreshBucketList,
    scheduleBucketAccessProbe,
    selectionReady,
    selectBucket,
    setBucketFilter,
    setBucketName,
    setPrefix,
    updateBucketAccessEntry,
  } = useBrowserBucketCatalog({
    contextId: contextIdForApi,
    accessContextKey: bucketAccessContextKey,
    browserRootContextId,
    enabled: hasExecutionContext,
    isCephAdminContext,
    isMainBrowserPath,
    lockedBucketName: resolvedLockedBucketName,
    onSelectedBucketNameChange,
    requestOptions: browserRequestOptions,
    requestedBucket,
    requestedPrefix,
    searchActive: showBucketMenu || showWorkspaceSidebar,
    usePortalWorkspaceLabels,
  });
  const {
    buttonActionLabel: bucketButtonActionLabel,
    buttonLabel: bucketButtonLabel,
    currentBucket: currentBucketPanelItem,
    currentBucketAccess,
    currentBucketUnavailable,
    detailsByName: bucketDetailsByName,
    displayNameByName: bucketDisplayNameByName,
    selectorNeedsAttention: bucketSelectorNeedsAttention,
    sidebarRows: workspaceSidebarRows,
  } = useMemo(
    () =>
      buildBrowserBucketPresentation({
        accessByName: bucketAccessByName,
        activeBucketName: bucketName,
        bucketItems: bucketMenuItems,
        bucketTotalCount,
        hasExecutionContext,
        loadingBuckets,
        lockedBucketLabel,
        lockedBucketName: resolvedLockedBucketName,
        selectorWorkspaceNoun,
        selectorWorkspaceNounPlural,
        text,
        usePortalWorkspaceLabels,
      }),
    [
      bucketAccessByName,
      bucketMenuItems,
      bucketName,
      bucketTotalCount,
      hasExecutionContext,
      loadingBuckets,
      lockedBucketLabel,
      resolvedLockedBucketName,
      selectorWorkspaceNoun,
      selectorWorkspaceNounPlural,
      text,
      usePortalWorkspaceLabels,
    ],
  );
  const {
    adjustFoldersPanelWidth,
    canUseFoldersPanel,
    foldersPanelResizeActive,
    isFoldersPanelVisible,
    layoutContainerRef,
    layoutTemplateColumns,
    resolvedFoldersWidth,
    resetFoldersPanelWidth,
    showFolders,
    startFoldersPanelResize,
    toggleFoldersPanel,
  } = useBrowserPanelLayout({
    allowFoldersPanel,
    initialFoldersPanelWidthPx:
      initialStoredRootUiState?.foldersPanelWidthPx ??
      DEFAULT_FOLDERS_PANEL_WIDTH_PX,
    initialShowFolders: isMainBrowserPath
      ? (initialStoredRootUiState?.showFolders ?? defaultShowFolders)
      : defaultShowFolders,
    persistLayout: isMainBrowserPath,
  });
  const {
    activeColumnResize,
    columnWidths,
    resetColumnWidth,
    resetColumns: handleResetVisibleColumns,
    startColumnResize,
    toggleVisibleColumn: handleToggleVisibleColumn,
    visibleColumns,
  } = useBrowserObjectColumns({
    isMainBrowserPath,
  });
  const effectiveVisibleColumns = isPortalProfile
    ? DEFAULT_VISIBLE_COLUMN_IDS
    : visibleColumns;
  const visibleColumnSet = useMemo(
    () => new Set(effectiveVisibleColumns),
    [effectiveVisibleColumns],
  );
  const {
    backendSortBy,
    sortDirection,
    sortId,
    sortKey,
    toggleSort: handleSortToggle,
  } = useBrowserObjectSort({ visibleColumns: visibleColumnSet });
  const isMobileViewport = useMediaQuery(MOBILE_OBJECT_LIST_MEDIA_QUERY);
  const {
    canConfigure: canConfigureRootBrowserDensity,
    compactMode,
    setCompactMode,
  } = useBrowserDensity({
    densityOverride,
    initialStoredDensity: initialStoredRootUiState?.density,
    isMainBrowserPath,
  });
  const canConfigureRootBrowserColumns =
    isMainBrowserPath && resolvedFunctionalProfile === "advanced";
  const maximumDirectItemActionCount =
    1 +
    Number(resolvedCapabilityFacts.canDeleteObjects) +
    Number(
      isPortalProfile &&
        resolvedCapabilityFacts.canCreatePublicLinks &&
        canOpenExternalObjectDetails,
    );
  const {
    setStatusMessage,
    setWarningMessage,
    statusMessage,
    warningMessage,
  } = useBrowserNotices({
    scopeKey: JSON.stringify([contextIdForApi, bucketName, prefix]),
  });
  const {
    close: closeCopyDialog,
    dialog: copyDialog,
    notifyCopySuccess,
    open: openCopyDialog,
    openSseCustomerKey: openSseCustomerKeyCopyDialog,
  } = useBrowserCopyDialog({ onStatus: setStatusMessage });
  const {
    activeSearchStatusChips,
    changeSearchScope,
    clearSearchFilters,
    closeSearchOptionsMenu,
    filter,
    hasActiveSearchFilters,
    hasAdvancedSearchOptionsActive,
    hasSearchQuery,
    isSearchingInWholeBucket,
    searchCaseSensitive,
    searchControlRef,
    searchExactMatch,
    searchOptionsButtonRef,
    searchOptionsMenuRef,
    searchRecursive,
    searchScope,
    setFilter,
    setSearchCaseSensitive,
    setSearchExactMatch,
    setSearchRecursive,
    setStorageFilter,
    setTypeFilter,
    showSearchOptionsMenu,
    storageFilter,
    toggleSearchOptionsMenu,
    typeFilter,
  } = useBrowserSearch({
    isPortalProfile,
    scopeKey: JSON.stringify([bucketName, prefix]),
  });
  const {
    hideDeletedObjects,
    showDeletedObjects,
    showFolderItems,
    toggleDeletedObjects,
    toggleFolderItems,
  } = useBrowserListingVisibility({
    deletedObjectsOptions,
  });
  const {
    canLoadMore: canLoadMoreObjectResults,
    deletedObjects,
    deletedObjectsIsTruncated,
    deletedPrefixes,
    isVersioningEnabled,
    loadMore: handleLoadMoreObjectResults,
    loadObjects,
    objects,
    objectsIsTruncated,
    objectsIssue,
    objectsLoading,
    objectsLoadingMore,
    prefixes,
    setShowObjectsIssueTechnicalDetails,
    showObjectsIssueTechnicalDetails,
  } = useBrowserObjectListing({
    contextId: contextIdForApi,
    contextSwitchInFlight,
    bucketName,
    caseSensitive: searchCaseSensitive,
    enabled: hasExecutionContext,
    exactMatch: searchExactMatch,
    filter,
    getBucketAccessEntry,
    onWarning: setWarningMessage,
    prefix,
    recursive: searchRecursive,
    requestOptions: browserRequestOptions,
    searchScope,
    showDeletedObjects,
    sortBy: backendSortBy,
    sortDirection,
    sortId,
    storageFilter,
    typeFilter,
    updateBucketAccessEntry,
  });
  const {
    close: closeConfirmDialog,
    dialog: confirmDialog,
    loading: confirmDialogLoading,
    open: openConfirmDialog,
    submit: submitConfirmDialog,
  } = useBrowserConfirmDialog();
  const requestDiscardDrawerChanges = useCallback(
    (onConfirm: () => void) => {
      openConfirmDialog({
        title: text("Discard changes?"),
        message:
          text("You have unapplied changes in the open details drawer. Continuing will discard them."),
        confirmLabel: text("Discard changes"),
        tone: "danger",
        onConfirm,
      });
    },
    [openConfirmDialog, text],
  );
  const {
    bucketName: configBucketName,
    closeBucket: closeBucketConfigurationDrawer,
    closeObject: closeObjectDetailsDrawer,
    hasUnsavedChanges: hasUnsavedDrawerChanges,
    objectTarget: objectDetailsTarget,
    openBucket: openBucketConfigurationTarget,
    openObject: openObjectDetailsTarget,
    requestTransition: requestDetailsDrawerTransition,
    setBucketDirty: setBucketConfigurationDirty,
    setObjectDirty: setObjectDetailsDirty,
  } = useBrowserDetailsDrawerState({
    onRequestDiscardChanges: requestDiscardDrawerChanges,
    scopeKey: JSON.stringify([contextIdForApi, bucketName, prefix]),
    versioningEnabled: isStorageSpaceContext || isVersioningEnabled,
  });
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const {
    cancelCopyDetails,
    cancelDeleteDetails,
    cancelDownloadDetails,
    cancelOperation,
    cancelOperationController,
    clearOperationController,
    completeOperation,
    copyDetails,
    createOperationController,
    deleteDetails,
    downloadDetails,
    isOperationAborted,
    operations,
    recordCompletedActivity: recordRegisteredActivity,
    setCopyDetails,
    setDeleteDetails,
    setDownloadDetails,
    setOperations,
    startOperation: startRegisteredOperation,
    updateOperation,
  } = useBrowserOperationRegistry();
  const {
    activeOperationsCount,
    allOtherOperations,
    clearFinishedOperations,
    closeOperationsDetailsModal,
    completedOperationsCount,
    copyGroups,
    deleteGroups,
    dismissOperationsPanel,
    downloadGroups,
    downloadOperationDetails,
    failedOperationsCount,
    filtersAllInactive,
    getSectionVisibleCount,
    hasFinishedOperations,
    hasOperationsPanelContent,
    hasPendingOperations,
    isGroupExpanded,
    openOperationsDetailsModal,
    operationsPanelOpen,
    operationsPanelTotalCount,
    operationSortFallback,
    operationSortIndexById,
    queuedOperationsCount,
    recordCompletedActivity,
    showActiveOperations,
    showCompletedOperations,
    showFailedOperations,
    showMoreSection,
    showOperationsBar,
    showOperationsDetailsModal,
    showOperationsPanel,
    showQueuedOperations,
    startOperation,
    toggleGroupExpanded,
    toggleOperationFilter,
    toggleOperationsPanel,
    uploadGroups,
    uploadGroupSortIndexById,
    visibleCopyGroups,
    visibleDeleteGroups,
    visibleDownloadGroups,
    visibleOtherOperations,
    visibleUploadGroups,
  } = useBrowserOperationOverview({
    operations,
    setOperations,
    uploadQueue,
    downloadDetails,
    setDownloadDetails,
    deleteDetails,
    setDeleteDetails,
    copyDetails,
    setCopyDetails,
    startOperation: startRegisteredOperation,
    recordCompletedActivity: recordRegisteredActivity,
    setStatusMessage,
  });
  const bucketMenuRef = useRef<HTMLDivElement | null>(null);
  const objectsListViewportRef = useRef<HTMLDivElement | null>(null);
  const bucketMenuFilterRef = useRef<HTMLInputElement | null>(null);
  const contextIdForApiRef = useRef(contextIdForApi);
  const effectiveCaps =
    storageEndpointCapabilities === undefined
      ? (selectedContext?.storage_endpoint_capabilities ?? null)
      : storageEndpointCapabilities;
  const bucketManagementEnabled =
    normalizedPath.endsWith("/browser") &&
    !isEmbeddedBrowserPath &&
    resolvedFunctionalProfile === "advanced";
  const bucketConfigurationEnabled =
    resolvedFunctionalProfile === "advanced";
  const {
    accessBadge,
    activateSseCustomerKey,
    canGenerateSseCustomerKey,
    clearSseCustomerKey,
    closeSseCustomerModal,
    corsActionPopoverRef,
    corsActionTriggerRef,
    corsFixing,
    corsInformation,
    downloadParallelism,
    generateSseCustomerKey,
    getSseCustomerKeyForScope,
    handleEnsureCors,
    hasCorsAction,
    openSseCustomerModal,
    otherOperationsParallelism,
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
    uploadParallelism,
    useProxyTransfers,
    warnings,
  } = useBrowserTransferRuntime({
    browserSettings,
    bucketName,
    contextIdForApi,
    contextSwitchInFlight,
    executionContextKind,
    functionalProfile: resolvedFunctionalProfile,
    hasExecutionContext,
    onManualSseKeyCopyRequired: openSseCustomerKeyCopyDialog,
    requestOptions: browserRequestOptions,
    setStatusMessage,
    storageEndpointCapabilities: effectiveCaps,
    warningMessage,
  });
  const normalizedPrefix = useMemo(() => normalizePrefix(prefix), [prefix]);
  const { copyPath: handleCopyPath, copyUrl: handleCopyUrl } =
    useBrowserCopyActions({
      bucketName,
      enabled: hasExecutionContext,
      onFallback: openCopyDialog,
      onStatus: setStatusMessage,
      onWarning: setWarningMessage,
      presignObject: presignObjectRequest,
      sseActive,
    });
  useDismissibleLayer({
    open: showBucketMenu,
    insideRefs: [bucketMenuRef],
    onDismiss: () => setShowBucketMenu(false),
  });

  useEffect(() => {
    if (showBucketMenu) {
      bucketMenuFilterRef.current?.focus();
    }
  }, [showBucketMenu]);

  useEffect(() => {
    if (isVersioningEnabled) return;
    hideDeletedObjects();
  }, [bucketName, hideDeletedObjects, isVersioningEnabled]);

  const {
    loadTreeChildren,
    toggleTreeNode: handleToggleTreeNode,
    treeRootNode,
  } = useBrowserFolderTree({
    contextId: contextIdForApi,
    contextSwitchInFlight,
    bucketName,
    currentBucketUnavailable,
    enabled: hasExecutionContext && isFoldersPanelVisible,
    onWarning: setWarningMessage,
    prefix,
    requestOptions: browserRequestOptions,
  });
  const displayPrefixForItems = useMemo(() => {
    if (searchScope !== "bucket") {
      return normalizedPrefix;
    }
    return "";
  }, [normalizedPrefix, searchScope]);

  const items = useMemo(
    () =>
      buildBrowserItems(
        prefixes,
        deletedPrefixes,
        objects,
        deletedObjects,
        displayPrefixForItems,
      ),
    [
      deletedObjects,
      deletedPrefixes,
      displayPrefixForItems,
      objects,
      prefixes,
    ],
  );
  const listItems = useMemo(
    () =>
      showFolderItems
        ? items
        : items.filter((item) => item.type !== "folder"),
    [items, showFolderItems],
  );
  const {
    activateItem,
    allSelected,
    clearActiveItem,
    handleItemCheckboxClick,
    handleListBackgroundClick,
    handleListKeyDown: handleSelectionKeyDown,
    prepareItemActionsMenu,
    prepareItemContextMenu,
    removeItemsFromSelection,
    selectAllItems,
    selectableListItems,
    selectedCount,
    selectedIds,
    selectedItems,
    selectedSet,
    toggleAllSelection,
  } = useBrowserSelection({
    items,
    listItems,
    scopeKey: JSON.stringify([contextIdForApi, bucketName, prefix]),
  });
  const {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    handleHeaderContextMenu,
    handleItemActionsButtonClick,
    handleItemContextMenu,
    handlePathContextMenu,
  } = useBrowserContextMenu({
    headerConfigurationEnabled: isMainBrowserPath,
    prepareItemActionsMenu,
    prepareItemContextMenu,
  });

  const {
    breadcrumbs,
    canGoUp,
    currentPath,
    editor: {
      activeSuggestionIndex: pathSuggestionIndex,
      applySuggestion: applyPathSuggestion,
      commit: commitPathDraft,
      editing: isEditingPath,
      handleKeyDown: handlePathKeyDown,
      inputRef: pathInputRef,
      setActiveSuggestionIndex: setPathSuggestionIndex,
      setValue: setPathDraft,
      startEditing: startEditingPath,
      suggestions: pathSuggestions,
      suggestionsLoading: pathSuggestionsLoading,
      value: pathDraft,
    },
    goUp: handleGoUp,
    selectPrefix: handleSelectPrefix,
  } = useBrowserPathRuntime({
    contextId: contextIdForApi,
    bucketName,
    prefix,
    localPrefixes: prefixes,
    enabled: hasExecutionContext,
    requestOptions: browserRequestOptions,
    requestTransition: requestDetailsDrawerTransition,
    setPrefix,
    clearActiveItem,
    selectionReady,
    contextSwitchInFlight,
    normalizedPath,
    accessContextKey: bucketAccessContextKey,
    lockedBucketName: resolvedLockedBucketName,
  });
  const {
    createPublicLinkForItem,
    openItemDetails,
    openItemPrimaryAction,
    openObjectDetails,
    openPropertiesForItem,
    previewItem: handlePreviewItem,
    previewNavigation,
  } = useBrowserObjectNavigation({
    bucketName,
    functionalProfile: resolvedFunctionalProfile,
    isStorageSpaceContext,
    listItems,
    objectDetailsTarget,
    onActivateItem: activateItem,
    onLoadedFilesChange,
    onOpenFolder: handleSelectPrefix,
    onOpenObjectDetails,
    openObjectDetailsTarget,
    requestDetailsDrawerTransition,
    setWarningMessage,
    versioningEnabled: isVersioningEnabled,
  });

  useLayoutEffect(() => {
    if (!contextSwitchInFlight) return;
    clearActiveItem();
  }, [contextSwitchInFlight, clearActiveItem]);

  const tableLayout = useMemo(
    () =>
      buildBrowserObjectTableLayout({
        visibleColumns: visibleColumnSet,
        columnWidths,
        compactMode,
        directItemActionCount: maximumDirectItemActionCount,
      }),
    [
      columnWidths,
      compactMode,
      maximumDirectItemActionCount,
      visibleColumnSet,
    ],
  );
  const lazyColumnCache = useBrowserLazyColumns({
    contextId: contextIdForApi,
    bucketName,
    enabled: hasExecutionContext,
    items: listItems,
    metadataColumnsVisible: tableLayout.lazyMetadataColumnsVisible,
    prefix,
    requestOptions: browserRequestOptions,
    sseCustomerKeyBase64,
    tagsColumnVisible: tableLayout.lazyTagsColumnsVisible,
    viewportRef: objectsListViewportRef,
  });
  const {
    loadMoreSentinelRef: bucketPanelLoadMoreSentinelRef,
    panelViewportRef: bucketPanelViewportRef,
  } = useBrowserBucketPanelViewport({
    activeBucketName: bucketName,
    canLoadMore: canLoadMoreBucketResults,
    enabled: showWorkspaceSidebar,
    onLoadMore: handleBucketMenuLoadMore,
    rows: workspaceSidebarRows,
    scheduleAccessProbe: scheduleBucketAccessProbe,
  });
  const workspaceAccountAction = useBrowserWorkspaceAccountAction({
    selectedContext,
    contextIdForApi,
    isPortalBrowserSurface,
  });

  const availableStorageClasses = useMemo(
    () => collectAvailableStorageClasses(items),
    [items],
  );
  const searchableStorageClasses = useMemo(() => {
    const ordered = storageClassOptions.map((option) => option.value);
    const known = new Set(ordered);
    const unknown = availableStorageClasses
      .filter((value) => !known.has(value))
      .sort((a, b) => a.localeCompare(b));
    return [...ordered, ...unknown];
  }, [availableStorageClasses]);

  const {
    canLoadMore: canLoadMorePrefixVersions,
    close: closePrefixVersions,
    error: prefixVersionsError,
    loadMore: loadMorePrefixVersions,
    loading: prefixVersionsLoading,
    open: openPrefixVersions,
    refresh: refreshPrefixVersions,
    refreshIfVisible: refreshPrefixVersionsIfVisible,
    rows: prefixVersionRows,
    visible: showPrefixVersions,
  } = useBrowserPrefixVersions({
    contextId: contextIdForApi,
    bucketName,
    contextEnabled: hasExecutionContext,
    onWarning: setWarningMessage,
    prefix: normalizedPrefix,
    requestOptions: browserRequestOptions,
    versioningEnabled: isVersioningEnabled,
  });
  const selectionItems = selectedItems;
  const selectionInfo = getSelectionInfo(selectionItems);
  const selectionFiles = selectionInfo.files;
  const selectionPrimary = selectionInfo.primary;
  const canSelectionActions = selectionInfo.items.length > 0;

  const rowPadding = compactMode ? "!py-0.5" : "py-2.5";
  const rowHeightClasses = compactMode ? "h-9" : "h-16";
  const rowCellClasses = rowPadding;
  const headerPadding = compactMode ? "!py-1" : "py-3";
  const iconBoxClasses = compactMode ? "h-6 w-6" : "h-9 w-9";
  const nameGapClasses = compactMode ? "gap-1.5" : "gap-3";
  const primaryItemButtonHeightClasses = compactMode ? "" : "min-h-11";
  const {
    refreshAfterUpload: refreshUploadedListing,
    refreshCurrentListing,
    refreshNow: refreshObjectsNow,
    reload: reloadObjects,
    requestRefresh: requestObjectsRefresh,
  } = useBrowserListingRefresh({
    bucketName,
    contextKey: bucketAccessContextKey,
    enabled: hasExecutionContext,
    loadObjects,
    loadTreeChildren,
    prefix,
    refreshVisibleVersions: refreshPrefixVersionsIfVisible,
    refreshToken,
  });

  const listAllObjectsForPrefix = useBrowserRecursiveObjectListing({
    contextId: contextIdForApi,
    bucketName,
    enabled: hasExecutionContext,
    requestOptions: browserRequestOptions,
  });



  const {
    canPaste: canPasteInFunctionalProfile,
    clipboard,
    copy: handleCopyItems,
    cut: handleCutItems,
    paste: handlePasteItems,
  } = useBrowserClipboard({
    contextId: contextIdForApi,
    bucketName,
    cancelCopyDetails,
    clearOperationController,
    completeOperation,
    createOperationController,
    enabled: hasExecutionContext,
    functionalProfile: resolvedFunctionalProfile,
    getSseCustomerKeyForScope,
    listAllObjectsForPrefix,
    normalizedPrefix,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    parallelism: otherOperationsParallelism,
    proxyAllowed,
    requestOptions: browserRequestOptions,
    setCopyDetails,
    showOperations: showOperationsBar,
    startOperation,
    uiOrigin,
    updateOperation,
  });

  const copyUrlDisabledReason = "Copy URL is disabled in SSE-C mode.";
  const {
    pathActionStates,
    selectionActionStates,
    resolveItemActionStates,
    toolbarMorePathActions,
    toolbarMoreSelectionFullActions,
    toolbarMoreSelectionOverflowActions,
  } = useBrowserActionStates({
    bucketName,
    hasExecutionContext,
    versioningEnabled: isVersioningEnabled,
    canPaste: canPasteInFunctionalProfile,
    clipboardMode: clipboard?.mode ?? null,
    currentPath,
    showFolderItems,
    showDeletedObjects,
    restorePrefixAvailable: Boolean(deletedObjectsOptions?.onRestorePrefix),
    refreshPending: objectsLoading,
    functionalProfile: resolvedFunctionalProfile,
    capabilityFacts: resolvedCapabilityFacts,
    bucketConfigurationAvailable: bucketConfigurationEnabled,
    bucketConfigurationReadOnly: workspaceSurface === "browser",
    selectionItems,
    copyUrlDisabled: sseActive,
    copyUrlDisabledReason,
    publicLinkAvailable:
      isPortalProfile &&
      resolvedCapabilityFacts.canCreatePublicLinks &&
      canOpenExternalObjectDetails,
    restoreObjectAvailable: Boolean(deletedObjectsOptions?.onRestoreObject),
    uploadAvailable: uploadMode !== "unavailable",
    uploadDisabledReason:
      "Uploads are unavailable with the current Browser transfer settings.",
    showDeletedToggle: Boolean(
      isPortalProfile && deletedObjectsOptions?.showToggle,
    ),
  });
  const restoreDeletedItem = (item: BrowserItem) => {
    if (!item.isDeleted || !deletedObjectsOptions?.onRestoreObject) return;
    deletedObjectsOptions.onRestoreObject({
      bucketName,
      key: item.key,
      name: item.name || item.key,
      deletedAt:
        item.modifiedAt != null ? new Date(item.modifiedAt).toISOString() : null,
      deleteMarkerVersionId: item.deleteMarkerVersionId,
    });
  };

  const handleOpenItem = (item: BrowserItem) => {
    if (item.type !== "folder") return;
    handleSelectPrefix(item.key);
  };
  useEffect(() => {
    contextIdForApiRef.current = contextIdForApi;
  }, [contextIdForApi]);

  useEffect(() => {
    if (
      storageFilter !== "all" &&
      !searchableStorageClasses.includes(storageFilter)
    ) {
      setStorageFilter("all");
    }
  }, [searchableStorageClasses, setStorageFilter, storageFilter]);

  const handleItemNameClick = (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => {
    if (event.detail > 1) return;
    openItemPrimaryAction(item);
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    handleSelectionKeyDown(event, openItemPrimaryAction);
  };

  const {
    showModal: showCreateBucketModal,
    name: createBucketNameValue,
    versioning: createBucketVersioning,
    loading: createBucketLoading,
    error: createBucketError,
    isNameValid: isCreateBucketNameValid,
    invalidNameMessage: invalidBucketNameMessage,
    open: openCreateBucketForm,
    updateName: updateCreateBucketName,
    setVersioning: setCreateBucketVersioning,
    submit: submitCreateBucket,
    close: closeCreateBucket,
  } = useBrowserCreateBucket({
    contextIdForApi,
    currentBucketName: bucketName,
    enabled: bucketManagementEnabled,
    hasContext: hasExecutionContext,
    requestOptions: browserRequestOptions,
    uiOrigin,
    onCreated: async (createdBucketName) => {
      await refreshBucketList({ preferredBucket: createdBucketName });
    },
    setCorsError: setCorsFixError,
    setCorsStatus,
    setStatusMessage,
  });
  const {
    openBucketConfiguration: openBucketConfigurationDrawer,
    openCreateBucket: openCreateBucketDialog,
    selectBucketFromMenu: handleBucketChange,
  } = useBrowserBucketInteractions({
    bucketConfigurationEnabled,
    bucketManagementEnabled,
    clearActiveItem,
    openBucketConfigurationTarget,
    openCreateBucketForm,
    requestDetailsDrawerTransition,
    selectBucket,
    setBucketFilter,
    setShowBucketMenu,
  });

  const {
    accountUser,
    apply: applyBrowserFavorite,
    busy: browserFavoritesBusy,
    canToggleCurrent: canToggleCurrentFavorite,
    contextLabels: favoriteContextLabels,
    current: currentFavorite,
    error: browserFavoritesError,
    favorites: browserFavoriteItems,
    isCurrentFavorite,
    removeLocation: removeBrowserFavoriteLocation,
    toggleCurrent: toggleCurrentFavorite,
    unavailable: unavailableBrowserFavorites,
  } = useBrowserFavoritesRuntime({
    storedUser,
    contexts: browserContext.contexts,
    bucketName,
    bucketLabel: isStorageSpaceContext
      ? bucketDisplayNameByName.get(bucketName)
      : undefined,
    prefix: normalizedPrefix,
    isMainBrowserPath,
    workspaceSurface,
    contextId: contextIdForApi,
    lockedBucket: resolvedLockedBucketName,
    requestTransition: requestDetailsDrawerTransition,
    setBucketName,
    setPrefix,
    clearActiveItem,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
  });

  const renderWorkspaceSidebarBody = useBrowserWorkspaceSidebarBody({
    favorites: {
      accountUser,
      bucketDetailsByName: isStorageSpaceContext ? bucketDetailsByName : undefined,
      bucketLabels: isStorageSpaceContext ? bucketDisplayNameByName : undefined,
      busy: browserFavoritesBusy,
      contextLabels: favoriteContextLabels,
      current: currentFavorite,
      error: browserFavoritesError,
      favorites: browserFavoriteItems,
      onApply: applyBrowserFavorite,
      onRemove: removeBrowserFavoriteLocation,
      unavailable: unavailableBrowserFavorites,
    },
    sidebar: {
      isPortalContext: isPortalBrowserSurface,
      rows: workspaceSidebarRows,
      activeBucketName: bucketName,
      bucketFilter,
      loadingBuckets,
      bucketError,
      bucketManagementEnabled,
      canLoadMore: canLoadMoreBucketResults,
      bucketMenuLoadingMore,
      bucketMenuTotal,
      bucketTotalCount,
      usageSummary,
      usageLoading: usageSummaryLoading,
      usageError: usageSummaryError,
      onBucketFilterChange: setBucketFilter,
      onRetryBuckets: refreshBucketList,
      onCreateBucket: openCreateBucketDialog,
      onSelectBucket: handleBucketChange,
      onLoadMore: handleBucketMenuLoadMore,
      workspaceAccountAction,
    },
    panelViewportRef: bucketPanelViewportRef,
    loadMoreSentinelRef: bucketPanelLoadMoreSentinelRef,
  });

  useLayoutEffect(() => {
    if (!showWorkspaceSidebar) {
      setSidebarBody(null);
      return;
    }
    setSidebarBody(renderWorkspaceSidebarBody);
    return () => {
      setSidebarBody(null);
    };
  }, [renderWorkspaceSidebarBody, setSidebarBody, showWorkspaceSidebar]);

  const handleRefresh = () => {
    if (!hasExecutionContext) return;
    if (!bucketName) {
      void refreshBucketList();
      return;
    }
    void refreshCurrentListing();
  };

  const handleBrowserFolderCreated = async ({
    name,
    prefix: createdFolderPrefix,
  }: {
    name: string;
    prefix: string;
  }) => {
    recordCompletedActivity("Created", `${bucketName}/${createdFolderPrefix}`);
    setStatusMessage(text("Folder {name} created", { name }));
    await loadObjects({ prefixOverride: prefix });
    loadTreeChildren(prefix);
  };
  const {
    showModal: showNewFolderModal,
    name: newFolderName,
    loading: newFolderLoading,
    error: newFolderError,
    open: handleNewFolder,
    setName: setNewFolderName,
    submit: submitNewFolder,
    close: closeNewFolder,
  } = useBrowserCreateFolder({
    contextIdForApi,
    bucketName,
    hasContext: hasExecutionContext,
    parentPrefix: normalizedPrefix,
    requestOptions: browserRequestOptions,
    onCreated: handleBrowserFolderCreated,
  });

  const openObjectVersionsModal = (item: BrowserItem) => {
    openObjectDetails(item, "versions");
  };

  const startQueuedUpload = useBrowserQueuedUpload({
    clearOperationController,
    completeOperation,
    createOperationController,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    presignObject: presignObjectRequest,
    presignPart: presignPartRequest,
    requestOptions: browserRequestOptions,
    sseCustomerKeyBase64,
    startOperation,
    transferReporter,
    updateOperation,
    uploadMode,
  });

  const {
    cancelUploadGroup,
    dragging,
    fileInputRef,
    folderInputRef,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileInputChange,
    handleFolderInputChange,
    removeQueuedUpload,
  } = useBrowserUploadQueue({
    contextId: contextIdForApi,
    bucketName,
    cancelOperationController,
    enabled: hasExecutionContext && uploadMode !== "unavailable",
    normalizedPrefix,
    onRefreshListing: refreshUploadedListing,
    onShowOperations: showOperationsBar,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    operations,
    parallelism: uploadParallelism,
    prefix,
    setUploadQueue,
    startUpload: startQueuedUpload,
    workspaceNoun,
  });

  const {
    showModal: showMultipartUploadsModal,
    uploads: multipartUploads,
    loading: multipartUploadsLoading,
    loadingMore: multipartUploadsLoadingMore,
    error: multipartUploadsError,
    canLoadMore: canLoadMoreMultipartUploads,
    abortingUploadIds: abortingMultipartUploadIds,
    open: openMultipartUploadsModal,
    refresh: refreshMultipartUploads,
    loadMore: loadMoreMultipartUploads,
    close: closeMultipartUploadsModal,
    requestAbort: requestAbortMultipartUpload,
  } = useBrowserMultipartUploads({
    contextIdForApi,
    bucketName,
    hasContext: hasExecutionContext,
    requestOptions: browserRequestOptions,
    requestConfirmation: openConfirmDialog,
    setStatusMessage,
    setWarningMessage,
  });

  const {
    apply: handleBulkAttributesApply,
    close: closeBulkAttributesModal,
    draft: bulkAttributesDraft,
    error: bulkAttributesError,
    fileCount: bulkAttributesFileCount,
    folderCount: bulkAttributesFolderCount,
    loading: bulkAttributesLoading,
    open: showBulkAttributesModal,
    setDraft: setBulkAttributesDraft,
    show: openBulkAttributesModal,
    summary: bulkAttributesSummary,
  } = useBrowserBulkAttributes({
    contextId: contextIdForApi,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    enabled: hasExecutionContext,
    listAllObjectsForPrefix,
    onRefresh: requestObjectsRefresh,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    parallelism: otherOperationsParallelism,
    prefix,
    requestOptions: browserRequestOptions,
    showOperations: showOperationsBar,
    startOperation,
    updateOperation,
  });

  const {
    deleteObjectsInBatches,
    remove: handleDeleteItems,
  } = useBrowserDeleteItems({
    contextId: contextIdForApi,
    bucketName,
    cancelDeleteDetails,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    enabled: hasExecutionContext,
    isOperationAborted,
    listAllObjectsForPrefix,
    onConfirm: openConfirmDialog,
    onProcessed: removeItemsFromSelection,
    onRefresh: reloadObjects,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    parallelism: otherOperationsParallelism,
    prefix,
    requestOptions: browserRequestOptions,
    setDeleteDetails,
    showOperations: showOperationsBar,
    startOperation,
    updateOperation,
  });

  const {
    apply: handleBulkRestoreApply,
    close: closeBulkRestoreModal,
    draft: bulkRestoreDraft,
    error: bulkRestoreError,
    fileCount: bulkRestoreFileCount,
    folderCount: bulkRestoreFolderCount,
    loading: bulkRestoreLoading,
    open: showBulkRestoreModal,
    preview: bulkRestorePreview,
    setDraft: setBulkRestoreDraft,
    show: openBulkRestoreModal,
    summary: bulkRestoreSummary,
    targetPath: bulkRestoreTargetPath,
  } = useBrowserBulkRestore({
    contextId: contextIdForApi,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    deleteObjectsInBatches,
    enabled: hasExecutionContext,
    isOperationAborted,
    listAllObjectsForPrefix,
    normalizedPrefix,
    onRefresh: requestObjectsRefresh,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    parallelism: otherOperationsParallelism,
    prefix,
    requestOptions: browserRequestOptions,
    showOperations: showOperationsBar,
    startOperation,
    updateOperation,
    versioningEnabled: isVersioningEnabled,
  });

  const {
    apply: handleCleanupApply,
    close: closeCleanupModal,
    draft: cleanupDraft,
    error: cleanupError,
    loading: cleanupLoading,
    open: showCleanupModal,
    setDraft: setCleanupDraft,
    show: openCleanupModal,
    summary: cleanupSummary,
  } = useBrowserVersionCleanup({
    contextId: contextIdForApi,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    enabled: hasExecutionContext,
    isOperationAborted,
    normalizedPrefix,
    onRefresh: requestObjectsRefresh,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    prefix,
    requestOptions: browserRequestOptions,
    showOperations: showOperationsBar,
    startOperation,
    versioningEnabled: isVersioningEnabled,
  });

  const {
    archivePreparation,
    cancelArchivePreparation,
    downloadFolder: handleDownloadFolder,
    downloadArchive,
    downloadItems: handleDownloadItems,
    downloadTarget: handleDownloadTarget,
    downloadVersion: handleDownloadVersion,
    savePreparedArchive,
  } = useBrowserDownloads({
    contextId: contextIdForApi,
    bucketName,
    cancelDownloadDetails,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    enabled: hasExecutionContext,
    listAllObjectsForPrefix,
    onOpenDeletedItemVersions: (item) => openObjectDetails(item, "versions"),
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    parallelism: downloadParallelism,
    presignDownload: presignObjectRequest,
    requestOptions: browserRequestOptions,
    setDownloadDetails,
    showOperations: showOperationsBar,
    sseActive,
    sseCustomerKeyBase64,
    startOperation,
    streamingZipThresholdMb:
      browserSettings?.streaming_zip_threshold_mb ??
      DEFAULT_STREAMING_ZIP_THRESHOLD_MB,
    transferReporter,
    updateOperation,
    useProxyTransfers,
    versioningEnabled: isVersioningEnabled,
  });

  const keyboardShortcutsBlocked =
    Boolean(objectDetailsTarget) ||
    Boolean(archivePreparation) ||
    showNewFolderModal ||
    showBulkAttributesModal ||
    showBulkRestoreModal ||
    showOperationsDetailsModal ||
    showSseCustomerModal ||
    showCleanupModal ||
    showPrefixVersions ||
    showMultipartUploadsModal ||
    Boolean(confirmDialog) ||
    Boolean(copyDialog);
  useBrowserKeyboardShortcuts({
    blocked: keyboardShortcutsBlocked,
    canCopyAndCut:
      resolvedFunctionalProfile !== "portal" &&
      resolvedCapabilityFacts.canWriteObjects,
    canPaste: canPasteInFunctionalProfile,
    enabled: hasExecutionContext && Boolean(bucketName),
    hasSelectableItems: selectableListItems.length > 0,
    onCopy: handleCopyItems,
    onCut: handleCutItems,
    onEditPath: startEditingPath,
    onPaste: handlePasteItems,
    onSelectAll: selectAllItems,
    selectedItems,
  });

  const {
    remove: handleDeleteVersion,
    restore: handleRestoreVersion,
  } = useBrowserVersionActions({
    contextId: contextIdForApi,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    enabled: hasExecutionContext,
    isOperationAborted,
    onConfirm: openConfirmDialog,
    onRefreshListing: refreshCurrentListing,
    onRefreshVersions: async () => undefined,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    requestOptions: browserRequestOptions,
    startOperation,
    versioningEnabled: isVersioningEnabled,
  });

  const runPathAction = (actionId: BrowserActionId) => {
    runBrowserAction(pathActionStates[actionId], {
      uploadFiles: () => fileInputRef.current?.click(),
      uploadFolder: () => folderInputRef.current?.click(),
      newFolder: handleNewFolder,
      paste: handlePasteItems,
      versions: openPrefixVersions,
      restoreToDate: () => openBulkRestoreModal([]),
      cleanOldVersions: openCleanupModal,
      multipartUploads: openMultipartUploadsModal,
      configureBucket: () => openBucketConfigurationDrawer(bucketName),
      details: () => {
        if (resolvedFunctionalProfile !== "advanced" || !bucketName) return;
        const pathItem: BrowserItem = {
          id: `path:${bucketName}:${normalizedPrefix}`,
          key: normalizedPrefix,
          name: breadcrumbs.at(-1)?.label ?? "Bucket root",
          type: "folder",
          size: "-",
          modified: "-",
          owner: "-",
        };
        requestDetailsDrawerTransition(() => {
          openObjectDetailsTarget(pathItem, "details");
        });
      },
      copyPath: () => handleCopyPath(currentPath),
      refresh: handleRefresh,
      restore: () =>
        deletedObjectsOptions?.onRestorePrefix?.({
          bucketName,
          key: normalizedPrefix,
          name: breadcrumbs.at(-1)?.label ?? normalizedPrefix,
        }),
      toggleShowFolders: toggleFolderItems,
      toggleShowDeleted: toggleDeletedObjects,
    });
  };

  const runSelectionAction = (actionId: BrowserActionId) => {
    runBrowserAction(selectionActionStates[actionId], {
      downloadZip: () => downloadArchive(selectionItems, isSearchingInWholeBucket ? "" : normalizedPrefix),
      details: () => {
        if (selectionPrimary) openItemDetails(selectionPrimary);
      },
      download: () => {
        if (
          selectionActionStates.download.label === "Download folder" &&
          selectionPrimary
        ) {
          handleDownloadFolder(selectionPrimary);
          return;
        }
        return handleDownloadItems(selectionFiles);
      },
      open: () => {
        if (selectionPrimary) {
          openItemPrimaryAction(selectionPrimary);
        }
      },
      copyUrl: () => handleCopyUrl(selectionPrimary),
      copy: () => handleCopyItems(selectionItems),
      cut: () => handleCutItems(selectionItems),
      bulkAttributes: () => openBulkAttributesModal(selectionItems),
      advanced: () => {
        if (selectionPrimary) {
          openPropertiesForItem(selectionPrimary);
        }
      },
      restoreToDate: () => openBulkRestoreModal(selectionItems),
      delete: () => handleDeleteItems(selectionItems),
    });
  };

  const runItemAction = (item: BrowserItem, actionId: BrowserActionId) => {
    const itemActions = resolveItemActionStates(item);
    const result = runBrowserAction(itemActions[actionId], {
      downloadZip: () => downloadArchive([item], isSearchingInWholeBucket ? "" : normalizedPrefix),
      details: () => openItemDetails(item),
      versions: () => openObjectVersionsModal(item),
      properties: () => openPropertiesForItem(item),
      open: () => handleOpenItem(item),
      preview: () => handlePreviewItem(item),
      download: () => handleDownloadTarget(item),
      createPublicLink: () => createPublicLinkForItem(item),
      restore: () => restoreDeletedItem(item),
      copyUrl: () => handleCopyUrl(item),
      copy: () => handleCopyItems([item]),
      cut: () => handleCutItems([item]),
      bulkAttributes: () => openBulkAttributesModal([item]),
      restoreToDate: () => openBulkRestoreModal([item]),
      advanced: () => openPropertiesForItem(item),
      delete: () => handleDeleteItems([item]),
    });
    if (!result.executed) {
      setWarningMessage(text(result.reason));
    }
  };

  useBrowserLeaveGuard({
    hasPendingOperations,
    hasUnsavedChanges: hasUnsavedDrawerChanges,
    archiveInventoryActive: archivePreparation?.phase === "inventorying",
  });
  const showFolderToggle = showPanelToggles && canUseFoldersPanel;
  const isActionBarVisible = selectedCount > 0;
  const showContextToolbarActions = !isActionBarVisible;
  const browserChromeShellClasses =
    "relative z-20 shrink-0 pb-2";
  const browserContentShellClasses =
    "relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-3";
  const toolbarSelectionSummary = text("{count} selected", { count: selectedCount.toLocaleString(intlLocale) });
  const toolbarCanUploadFiles = pathActionStates.uploadFiles.enabled;
  const toolbarCanUploadFolder = pathActionStates.uploadFolder.enabled;
  const toolbarCanCreateFolder = pathActionStates.newFolder.enabled;
  const toolbarCanDownload =
    selectionActionStates.download.visible &&
    selectionActionStates.download.enabled;
  const toolbarCanOpen =
    selectionActionStates.open.visible && selectionActionStates.open.enabled;
  const toolbarCanCopy =
    selectionActionStates.copy.visible && selectionActionStates.copy.enabled;
  const toolbarCanDelete =
    selectionActionStates.delete.visible &&
    selectionActionStates.delete.enabled;
  const toolbarPathActions = toolbarMorePathActions;
  const toolbarSelectionActions = (
    isActionBarVisible
      ? toolbarMoreSelectionOverflowActions
      : toolbarMoreSelectionFullActions
  ).filter(
    (selectionAction) =>
      isActionBarVisible ||
      !toolbarPathActions.some((pathAction) => pathAction.id === selectionAction.id),
  );
  const hasToolbarSelectionActions =
    canSelectionActions && toolbarSelectionActions.length > 0;
  const hasToolbarOperationsAction = hasOperationsPanelContent;
  const hasToolbarStatusSection = Boolean(accessBadge) || hasToolbarOperationsAction;
  const hasToolbarColumnsSection =
    resolvedFunctionalProfile === "advanced";
  const toolbarColumnsSummary = text("{count}/{total} visible", { count: effectiveVisibleColumns.length, total: COLUMN_DEFINITIONS.length });
  const handleToolbarDownload = () => {
    runSelectionAction("download");
  };
  const handleToolbarOpen = () => {
    runSelectionAction("open");
  };

  const renderNameHeaderContent = () => (
    <BrowserObjectSearchHeader
      rootRef={searchControlRef}
      optionsButtonRef={searchOptionsButtonRef}
      optionsMenuRef={searchOptionsMenuRef}
      advancedOptionsEnabled={resolvedFunctionalProfile === "advanced"}
      optionsOpen={showSearchOptionsMenu}
      filter={filter}
      objectNounPlural={workspaceObjectNounPlural}
      nameSortActive={sortKey === "name"}
      sortDirection={sortDirection}
      advancedOptionsActive={hasAdvancedSearchOptionsActive}
      hasSearchQuery={hasSearchQuery}
      searchScope={searchScope}
      recursive={searchRecursive}
      exactMatch={searchExactMatch}
      caseSensitive={searchCaseSensitive}
      typeFilter={typeFilter}
      storageFilter={storageFilter}
      storageClasses={searchableStorageClasses}
      canReset={hasActiveSearchFilters}
      onSortName={() => handleSortToggle("name")}
      onFilterChange={setFilter}
      onToggleOptions={toggleSearchOptionsMenu}
      onScopeChange={changeSearchScope}
      onRecursiveChange={setSearchRecursive}
      onExactMatchChange={setSearchExactMatch}
      onCaseSensitiveChange={setSearchCaseSensitive}
      onTypeFilterChange={setTypeFilter}
      onStorageFilterChange={setStorageFilter}
      onClear={clearSearchFilters}
      onClose={closeSearchOptionsMenu}
    />
  );


  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {isEmbeddedBrowserPath ? (
        <h2 className="sr-only">{isPortalBrowserSurface ? text("Portal browser") : text("Browser")}</h2>
      ) : (
        <h1 className="sr-only">{isPortalBrowserSurface ? text("Portal browser") : text("Browser")}</h1>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <div className={browserShellClasses}>
        <div className={browserChromeShellClasses}>
          <BrowserToolbar
            compactMode={compactMode}
            bucketSelector={{
              rootRef: bucketMenuRef,
              filterInputRef: bucketMenuFilterRef,
              lockedBucketName: resolvedLockedBucketName,
              hasContext: hasExecutionContext,
              open: showBucketMenu,
              buttonLabel: bucketButtonLabel,
              buttonActionLabel: bucketButtonActionLabel,
              needsAttention: bucketSelectorNeedsAttention,
              workspaceNoun: selectorWorkspaceNoun,
              workspaceNounPlural: selectorWorkspaceNounPlural,
              workspaceNounTitle: selectorWorkspaceNounTitle,
              bucketManagementEnabled,
              filter: bucketFilter,
              loading: loadingBuckets,
              hasError: Boolean(bucketError),
              totalCount: bucketTotalCount,
              total: bucketMenuTotal,
              items: bucketMenuItems,
              activeBucketName: bucketName,
              displayNameByBucket: bucketDisplayNameByName,
              canLoadMore: canLoadMoreBucketResults,
              loadingMore: bucketMenuLoadingMore,
              onToggle: () => setShowBucketMenu((current) => !current),
              onCreateBucket: openCreateBucketDialog,
              onFilterChange: setBucketFilter,
              onRetry: () => void refreshBucketList(),
              onSelectBucket: handleBucketChange,
              onLoadMore: handleBucketMenuLoadMore,
            }}
            pathNavigator={{
              inputRef: pathInputRef,
              editing: isEditingPath,
              value: pathDraft,
              disabled: !bucketName,
              suggestions: pathSuggestions,
              suggestionsLoading: pathSuggestionsLoading,
              activeSuggestionIndex: pathSuggestionIndex,
              breadcrumbs,
              canGoUp,
              favorite:
                isMainBrowserPath && accountUser
                  ? {
                      active: isCurrentFavorite,
                      busy: browserFavoritesBusy,
                      disabled: !canToggleCurrentFavorite,
                      onToggle: () => {
                        void toggleCurrentFavorite();
                      },
                    }
                  : undefined,
              onStartEditing: startEditingPath,
              onChange: setPathDraft,
              onBlur: commitPathDraft,
              onKeyDown: handlePathKeyDown,
              onHoverSuggestion: setPathSuggestionIndex,
              onSelectSuggestion: (suggestion) =>
                applyPathSuggestion(suggestion, { commit: true }),
              onGoUp: handleGoUp,
              onSelectPrefix: handleSelectPrefix,
            }}
            deletedObjects={{
              showToggle: Boolean(
                !isPortalProfile &&
                  deletedObjectsOptions?.showToggle &&
                  isVersioningEnabled &&
                  bucketName,
              ),
              showDeleted: showDeletedObjects,
              showRestore: Boolean(
                deletedObjectsOptions?.onRestorePrefix &&
                  pathActionStates.restore.visible &&
                  showDeletedObjects &&
                  isVersioningEnabled &&
                  bucketName &&
                  normalizedPrefix,
              ),
              restoreEnabled: pathActionStates.restore.enabled,
            }}
            contextActions={{
              visible: showContextToolbarActions,
              canUploadFiles: toolbarCanUploadFiles,
              canUploadFolder: toolbarCanUploadFolder,
              canCreateFolder: toolbarCanCreateFolder,
              canRefresh: pathActionStates.refresh.enabled,
            }}
            selectionActions={{
              visible: isActionBarVisible,
              mobileViewport: isMobileViewport,
              summary: toolbarSelectionSummary,
              canOpen: toolbarCanOpen,
              canCopy: toolbarCanCopy,
              canDownload: toolbarCanDownload,
              canDelete: toolbarCanDelete,
            }}
            menuResetKey={JSON.stringify([
              bucketName,
              prefix,
              Array.from(selectedIds),
            ])}
            moreMenu={{
              view: canConfigureRootBrowserDensity
                ? {
                    compactMode,
                    onSetCompactMode: setCompactMode,
                  }
                : undefined,
              status: {
                visible: hasToolbarStatusSection,
                accessBadge,
                operationsCount: hasToolbarOperationsAction
                  ? operationsPanelTotalCount
                  : undefined,
                onOpenOperations: openOperationsDetailsModal,
              },
              layout: {
                folders: showFolderToggle
                  ? { checked: showFolders, onToggle: toggleFoldersPanel }
                  : undefined,
              },
              columns: hasToolbarColumnsSection
                ? {
                    summary: toolbarColumnsSummary,
                    columns: COLUMN_DEFINITIONS,
                    visibleColumnIds: visibleColumnSet,
                    onToggleColumn: handleToggleVisibleColumn,
                    onReset: handleResetVisibleColumns,
                  }
                : undefined,
              pathActions: toolbarPathActions,
              selectionActions: hasToolbarSelectionActions
                ? toolbarSelectionActions
                : [],
              selectionOverflow: isActionBarVisible,
              sse: showSseControls
                ? {
                    enabled: true,
                    active: sseActive,
                    onOpen: openSseCustomerModal,
                  }
                : undefined,
            }}
            fileInputRef={fileInputRef}
            folderInputRef={folderInputRef}
            onFileInputChange={handleFileInputChange}
            onFolderInputChange={handleFolderInputChange}
            onRunPathAction={runPathAction}
            onRunSelectionAction={runSelectionAction}
          />
        </div>

        <BrowserNoticesPanel
          bucketError={bucketError}
          statusMessage={statusMessage}
          corsInformation={corsInformation}
          warnings={warnings}
          hasCorsAction={hasCorsAction}
          corsActionTriggerRef={corsActionTriggerRef}
          corsActionPopoverRef={corsActionPopoverRef}
          showCorsActionPopover={showCorsActionPopover}
          toggleCorsActionPopover={toggleCorsActionPopover}
          uiOrigin={uiOrigin}
          corsFixing={corsFixing}
          onEnsureCors={handleEnsureCors}
        />

        <div className={browserContentShellClasses}>
          <div
            ref={layoutContainerRef}
            data-testid="browser-layout"
            className="relative grid min-h-0 flex-1 grid-rows-1 gap-3"
            style={{ gridTemplateColumns: layoutTemplateColumns }}
          >
            {isFoldersPanelVisible && (
              <BrowserFoldersPanel
                currentBucket={currentBucketPanelItem}
                activePrefix={normalizedPrefix}
                currentBucketAccess={currentBucketAccess}
                treeRootNode={treeRootNode}
                workspaceNoun={workspaceNoun}
                onClose={toggleFoldersPanel}
                onRefresh={handleRefresh}
                onSelectPrefix={handleSelectPrefix}
                onToggleTreeNode={handleToggleTreeNode}
              />
            )}
            <div className="flex min-h-0 h-full min-w-0 flex-1 flex-col gap-3">
              <BrowserObjectExplorer
                viewportRef={objectsListViewportRef}
                dragging={dragging}
                mobile={isMobileViewport}
                bucketName={bucketName}
                normalizedPrefix={normalizedPrefix}
                workspaceNoun={workspaceNoun}
                workspaceObjectNounPlural={workspaceObjectNounPlural}
                items={listItems}
                selectedIds={selectedSet}
                loading={objectsLoading}
                loadingMore={objectsLoadingMore}
                canLoadMore={canLoadMoreObjectResults}
                objectsIsTruncated={objectsIsTruncated}
                deletedObjectsIsTruncated={deletedObjectsIsTruncated}
                showDeletedObjects={showDeletedObjects}
                showParentFolder={Boolean(
                  canGoUp &&
                    bucketName &&
                    showFolderItems &&
                    !isSearchingInWholeBucket,
                )}
                hasActiveSearchFilters={hasActiveSearchFilters}
                searchStatusChips={activeSearchStatusChips}
                issue={
                  objectsIssue
                    ? {
                        title: objectsIssue.title,
                        description: (
                          <BrowserObjectsIssueDescription
                            description={objectsIssue.description}
                            technicalDetail={objectsIssue.technicalDetail}
                            expanded={showObjectsIssueTechnicalDetails}
                            onExpandedChange={setShowObjectsIssueTechnicalDetails}
                          />
                        ),
                      }
                    : null
                }
                lazyColumnCache={lazyColumnCache}
                isPortalProfile={isPortalProfile}
                table={{
                  scaffold: {
                    minWidthPx: tableLayout.minWidthPx,
                    selectionColumnWidthPx: SELECTION_COLUMN_WIDTH_PX,
                    nameColumnWidthPx: tableLayout.nameColumnWidthPx,
                    actionsColumnWidthPx: tableLayout.actionsColumnWidthPx,
                    columns: tableLayout.visibleColumnDefinitions,
                    columnWidthsPx: tableLayout.columnWidthsPx,
                    headerPaddingClasses: headerPadding,
                    allSelected,
                    selectionDisabled: selectableListItems.length === 0,
                    nameHeader: renderNameHeaderContent(),
                    sortKey,
                    sortDirection,
                    activeResizeColumnId:
                      activeColumnResize?.columnId ?? null,
                    onToggleAll: toggleAllSelection,
                    onSort: handleSortToggle,
                    onStartResize: startColumnResize,
                    onResetColumnWidth: resetColumnWidth,
                    onHeaderContextMenu: handleHeaderContextMenu,
                  },
                  row: {
                    compactMode,
                    rowHeightClasses,
                    rowCellClasses,
                    iconBoxClasses,
                    nameGapClasses,
                    primaryItemButtonHeightClasses,
                  },
                }}
                resolveItemActions={resolveItemActionStates}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onPathContextMenu={handlePathContextMenu}
                onListBackgroundClick={handleListBackgroundClick}
                onListKeyDown={handleListKeyDown}
                onGoUp={handleGoUp}
                onItemContextMenu={handleItemContextMenu}
                onToggleSelection={(item, extendRange) =>
                  handleItemCheckboxClick(item.id, extendRange)
                }
                onItemNameClick={handleItemNameClick}
                onRunItemAction={runItemAction}
                onOpenActions={handleItemActionsButtonClick}
                onLoadMore={handleLoadMoreObjectResults}
              />
            </div>

            {isFoldersPanelVisible && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={text("Resize folders panel")}
                aria-valuemin={MIN_FOLDERS_PANEL_WIDTH_PX}
                aria-valuemax={MAX_FOLDERS_PANEL_WIDTH_PX}
                aria-valuenow={resolvedFoldersWidth}
                title={text("Resize folders panel")}
                tabIndex={0}
                className="absolute inset-y-0 z-20 -translate-x-1/2 cursor-col-resize touch-none select-none"
                style={{
                  left: `calc(${resolvedFoldersWidth}px + ${PANEL_LAYOUT_GAP_PX / 2}px)`,
                  width: `${PANEL_RESIZER_HITBOX_WIDTH_PX}px`,
                }}
                onPointerDown={startFoldersPanelResize}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    adjustFoldersPanelWidth(-16);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    adjustFoldersPanelWidth(16);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    resetFoldersPanelWidth();
                  }
                }}
                onDoubleClick={resetFoldersPanelWidth}
              >
                <div
                  className={`mx-auto h-full w-0.5 rounded-full bg-slate-200 transition dark:bg-slate-700 ${
                    foldersPanelResizeActive
                      ? "bg-primary dark:bg-primary-300"
                      : "hover:bg-slate-300 dark:hover:bg-slate-500"
                  }`}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
      {isMobileViewport && selectedCount > 0 && (
        <BrowserMobileSelectionActions
          actions={toolbarMoreSelectionFullActions}
          canDownload={toolbarCanDownload}
          canOpen={toolbarCanOpen}
          onDownload={handleToolbarDownload}
          onOpen={handleToolbarOpen}
          onRunAction={runSelectionAction}
          summary={toolbarSelectionSummary}
        />
      )}
      <BrowserContextMenu
        contextMenu={contextMenu}
        contextMenuRef={contextMenuRef}
        bucketName={bucketName}
        currentPath={currentPath}
        hasExecutionContext={hasExecutionContext}
        versioningEnabled={isVersioningEnabled}
        showFolderItems={showFolderItems}
        showDeletedObjects={showDeletedObjects}
        canPaste={canPasteInFunctionalProfile}
        copyUrlDisabled={sseActive}
        copyUrlDisabledReason={copyUrlDisabledReason}
        multipartUploadsAvailable={resolvedFunctionalProfile === "advanced"}
        bucketConfigurationAvailable={bucketConfigurationEnabled}
        bucketConfigurationReadOnly={workspaceSurface === "browser"}
        functionalProfile={resolvedFunctionalProfile}
        capabilityFacts={resolvedCapabilityFacts}
        clipboard={clipboard}
        fileInputRef={fileInputRef}
        folderInputRef={folderInputRef}
        onClose={closeContextMenu}
        onNewFolder={handleNewFolder}
        onPasteItems={handlePasteItems}
        onOpenPrefixVersions={openPrefixVersions}
        onOpenCleanupVersions={openCleanupModal}
        onOpenMultipartUploads={openMultipartUploadsModal}
        onConfigureBucket={() => openBucketConfigurationDrawer(bucketName)}
        onOpenPathDetails={() => runPathAction("details")}
        onResolveItemActions={resolveItemActionStates}
        onRunItemAction={runItemAction}
        onCopyUrl={handleCopyUrl}
        onCopyPath={(path) => {
          void handleCopyPath(path);
        }}
        onCopyItems={handleCopyItems}
        onCutItems={handleCutItems}
        onOpenBulkAttributes={openBulkAttributesModal}
        onOpenBulkRestore={openBulkRestoreModal}
        onOpenAdvanced={openPropertiesForItem}
        onDeleteItems={handleDeleteItems}
        onDownloadFolder={handleDownloadFolder}
        onDownloadItems={handleDownloadItems}
        onDownloadZip={items => void downloadArchive(items, isSearchingInWholeBucket ? "" : normalizedPrefix)}
        onOpenItem={handleOpenItem}
        onToggleShowFolders={toggleFolderItems}
        onToggleShowDeleted={toggleDeletedObjects}
        canConfigureDensity={canConfigureRootBrowserDensity}
        canConfigureColumns={canConfigureRootBrowserColumns}
        compactMode={compactMode}
        onSetCompactMode={setCompactMode}
        columnOptions={COLUMN_DEFINITIONS.map((column) => ({
          id: column.id,
          label: column.label,
        }))}
        visibleColumns={visibleColumnSet}
        onToggleVisibleColumn={(columnId) => {
          handleToggleVisibleColumn(columnId as BrowserColumnId);
        }}
        onResetVisibleColumns={() => {
          handleResetVisibleColumns();
        }}
      />
      {objectDetailsTarget &&
      objectDetailsTarget.item.type === "file" &&
      isStorageSpaceContext ? (
        <BrowserStorageSpaceObjectDetailsDrawer
          navigation={previewNavigation}
          key={`${bucketName}:${objectDetailsTarget.item.id}`}
          portalAccountId={portalAccountIdForApi}
          bucket={currentBucketPanelItem}
          bucketName={bucketName}
          canModifyObjects={
            resolvedCapabilityFacts.canDeleteObjects &&
            resolvedCapabilityFacts.canRestoreObjects
          }
          createPublicLinkOnOpen={
            objectDetailsTarget.intent === "create-public-link"
          }
          initialView={resolveStorageSpaceObjectDetailsView({
            initialTab: objectDetailsTarget.initialTab,
            intent: objectDetailsTarget.intent,
            isDeleted: objectDetailsTarget.item.isDeleted,
          })}
          item={objectDetailsTarget.item}
          onClose={closeObjectDetailsDrawer}
          onMessage={setStatusMessage}
          onRefreshObjects={refreshCurrentListing}
        />
      ) : objectDetailsTarget && objectDetailsTarget.item.type === "file" ? (
        <BrowserObjectDetailsDrawer
          navigation={previewNavigation}
          key={`${bucketName}:${objectDetailsTarget.item.id}`}
          contextId={contextIdForApi}
          bucketName={bucketName}
          item={objectDetailsTarget.item}
          initialTab={objectDetailsTarget.initialTab}
          versioningEnabled={isVersioningEnabled}
          sseCustomerKeyBase64={sseCustomerKeyBase64}
          useProxyTransfers={useProxyTransfers}
          sseActive={sseActive}
          copyUrlDisabled={sseActive}
          copyUrlDisabledReason={copyUrlDisabledReason}
          canDelete={resolvedCapabilityFacts.canDeleteObjects}
          presignObjectRequest={presignObjectRequest}
          onClose={closeObjectDetailsDrawer}
          onDownload={handleDownloadTarget}
          onCopyUrl={(item) => handleCopyUrl(item)}
          onDelete={(item) => handleDeleteItems([item])}
          onRefreshBrowserObjects={refreshCurrentListing}
          onDownloadVersion={handleDownloadVersion}
          onRestoreVersion={handleRestoreVersion}
          onDeleteVersion={handleDeleteVersion}
          profile={
            resolvedFunctionalProfile === "advanced" ? "advanced" : "standard"
          }
          onDirtyChange={setObjectDetailsDirty}
          requestOptions={browserRequestOptions}
        />
      ) : objectDetailsTarget &&
        objectDetailsTarget.item.type === "folder" &&
        resolvedFunctionalProfile === "advanced" ? (
        <BrowserPathDetailsDrawer
          key={`${bucketName}:${objectDetailsTarget.item.id}`}
          contextId={contextIdForApi}
          bucketName={bucketName}
          listAllObjectsForPrefix={listAllObjectsForPrefix}
          prefix={objectDetailsTarget.item.key}
          requestOptions={browserRequestOptions}
          versioningEnabled={isVersioningEnabled}
          onClose={closeObjectDetailsDrawer}
          onCopyPath={(path) => void handleCopyPath(path)}
        />
      ) : null}
      {configBucketName && bucketConfigurationEnabled && (
        <BrowserBucketConfigurationDrawer
          contextId={contextIdForApi}
          bucketName={configBucketName}
          includeStaticWebsite={effectiveCaps?.static_website ?? true}
          includeUsage={effectiveCaps ? effectiveCaps.metrics !== false : true}
          workspaceSurface={workspaceSurface}
          onClose={closeBucketConfigurationDrawer}
          onDirtyChange={setBucketConfigurationDirty}
        />
      )}
      {showCreateBucketModal && (
        <BrowserCreateBucketModal
          name={createBucketNameValue}
          versioning={createBucketVersioning}
          loading={createBucketLoading}
          error={createBucketError}
          isNameValid={isCreateBucketNameValid}
          invalidNameMessage={invalidBucketNameMessage}
          hasExecutionContext={hasExecutionContext}
          onNameChange={updateCreateBucketName}
          onVersioningChange={setCreateBucketVersioning}
          onSubmit={submitCreateBucket}
          onClose={closeCreateBucket}
        />
      )}
      {showSseCustomerModal && (
        <BrowserSseCustomerKeyModal
          value={sseCustomerKeyInput}
          visible={sseCustomerKeyVisible}
          error={sseCustomerKeyError}
          notice={sseCustomerKeyNotice}
          active={sseActive}
          canGenerate={canGenerateSseCustomerKey}
          dirty={sseCustomerDraftDirty}
          onValueChange={updateSseCustomerKeyInput}
          onToggleVisibility={toggleSseCustomerKeyVisibility}
          onGenerate={generateSseCustomerKey}
          onClear={clearSseCustomerKey}
          onActivate={activateSseCustomerKey}
          onClose={closeSseCustomerModal}
        />
      )}
      {showMultipartUploadsModal && bucketName && hasExecutionContext && (
        <BrowserMultipartUploadsModal
          bucketName={bucketName}
          uploads={multipartUploads}
          loading={multipartUploadsLoading}
          loadingMore={multipartUploadsLoadingMore}
          error={multipartUploadsError}
          canLoadMore={canLoadMoreMultipartUploads}
          abortingUploadIds={abortingMultipartUploadIds}
          onRefresh={refreshMultipartUploads}
          onLoadMore={loadMoreMultipartUploads}
          onAbort={requestAbortMultipartUpload}
          onClose={closeMultipartUploadsModal}
        />
      )}
      {showPrefixVersions && isVersioningEnabled && (
        <BrowserPrefixVersionsModal
          bucketName={bucketName}
          normalizedPrefix={normalizedPrefix}
          prefixVersionsLoading={prefixVersionsLoading}
          prefixVersionsError={prefixVersionsError}
          prefixVersionRows={prefixVersionRows}
          canLoadMore={canLoadMorePrefixVersions}
          onClose={closePrefixVersions}
          onRefresh={refreshPrefixVersions}
          onLoadMore={loadMorePrefixVersions}
          onDownloadVersion={handleDownloadVersion}
          onRestoreVersion={handleRestoreVersion}
          onDeleteVersion={handleDeleteVersion}
        />
      )}
      {showBulkAttributesModal && (
        <BrowserBulkAttributesModal
          draft={bulkAttributesDraft}
          error={bulkAttributesError}
          fileCount={bulkAttributesFileCount}
          folderCount={bulkAttributesFolderCount}
          loading={bulkAttributesLoading}
          onApply={handleBulkAttributesApply}
          onClose={closeBulkAttributesModal}
          setDraft={setBulkAttributesDraft}
          summary={bulkAttributesSummary}
        />
      )}
      {showBulkRestoreModal && (
        <BrowserBulkRestoreModal
          draft={bulkRestoreDraft}
          error={bulkRestoreError}
          fileCount={bulkRestoreFileCount}
          folderCount={bulkRestoreFolderCount}
          loading={bulkRestoreLoading}
          onApply={handleBulkRestoreApply}
          onClose={closeBulkRestoreModal}
          preview={bulkRestorePreview}
          setDraft={setBulkRestoreDraft}
          summary={bulkRestoreSummary}
          targetPath={bulkRestoreTargetPath}
        />
      )}
      {showCleanupModal && (
        <BrowserCleanupModal
          currentPath={currentPath}
          draft={cleanupDraft}
          error={cleanupError}
          loading={cleanupLoading}
          onApply={handleCleanupApply}
          onClose={closeCleanupModal}
          setDraft={setCleanupDraft}
          summary={cleanupSummary}
        />
      )}
      {showNewFolderModal && (
        <BrowserCreateFolderModal
          name={newFolderName}
          loading={newFolderLoading}
          error={newFolderError}
          currentPath={currentPath}
          bucketName={bucketName}
          hasExecutionContext={hasExecutionContext}
          onNameChange={setNewFolderName}
          onSubmit={submitNewFolder}
          onClose={closeNewFolder}
        />
      )}
      {archivePreparation && (
        <BrowserArchivePreparationDialog
          preparation={archivePreparation}
          onCancel={cancelArchivePreparation}
          onConfirm={() => {
            void savePreparedArchive();
          }}
        />
      )}
      {confirmDialog && (
        <BrowserConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          tone={confirmDialog.tone}
          loading={confirmDialogLoading}
          onCancel={closeConfirmDialog}
          onConfirm={() => void submitConfirmDialog()}
        />
      )}
      {copyDialog && (
        <BrowserCopyValueModal
          title={copyDialog.title}
          label={copyDialog.label}
          value={copyDialog.value}
          onCopySuccess={notifyCopySuccess}
          onClose={closeCopyDialog}
        />
      )}
      {showOperationsPanel && (
        <BrowserOperationsPanel
          open={operationsPanelOpen}
          totalOperationsCount={operationsPanelTotalCount}
          activeOperationsCount={activeOperationsCount}
          queuedOperationsCount={queuedOperationsCount}
          completedOperationsCount={completedOperationsCount}
          failedOperationsCount={failedOperationsCount}
          downloadGroups={downloadGroups}
          deleteGroups={deleteGroups}
          copyGroups={copyGroups}
          uploadGroups={uploadGroups}
          otherOperations={allOtherOperations}
          operationSortIndexById={operationSortIndexById}
          uploadGroupSortIndexById={uploadGroupSortIndexById}
          operationSortFallback={operationSortFallback}
          cancelOperation={cancelOperation}
          cancelUploadGroup={cancelUploadGroup}
          hasFinishedOperations={hasFinishedOperations}
          canDismiss={!hasPendingOperations}
          onClearFinishedOperations={clearFinishedOperations}
          onDismiss={dismissOperationsPanel}
          onOpenDetails={openOperationsDetailsModal}
          onToggleOpen={toggleOperationsPanel}
        />
      )}
      {showOperationsDetailsModal && hasOperationsPanelContent && (
        <BrowserOperationsModal
          totalOperationsCount={operationsPanelTotalCount}
          activeOperationsCount={activeOperationsCount}
          queuedOperationsCount={queuedOperationsCount}
          completedOperationsCount={completedOperationsCount}
          failedOperationsCount={failedOperationsCount}
          showActiveOperations={showActiveOperations}
          showQueuedOperations={showQueuedOperations}
          showCompletedOperations={showCompletedOperations}
          showFailedOperations={showFailedOperations}
          filtersAllInactive={filtersAllInactive}
          onToggleActive={() => toggleOperationFilter("active")}
          onToggleQueued={() => toggleOperationFilter("queued")}
          onToggleCompleted={() => toggleOperationFilter("completed")}
          onToggleFailed={() => toggleOperationFilter("failed")}
          visibleDownloadGroups={visibleDownloadGroups}
          visibleDeleteGroups={visibleDeleteGroups}
          visibleCopyGroups={visibleCopyGroups}
          visibleUploadGroups={visibleUploadGroups}
          visibleOtherOperations={visibleOtherOperations}
          operationSortIndexById={operationSortIndexById}
          uploadGroupSortIndexById={uploadGroupSortIndexById}
          operationSortFallback={operationSortFallback}
          isGroupExpanded={isGroupExpanded}
          toggleGroupExpanded={toggleGroupExpanded}
          getSectionVisibleCount={getSectionVisibleCount}
          showMoreSection={showMoreSection}
          cancelOperation={cancelOperation}
          cancelUploadGroup={cancelUploadGroup}
          cancelUploadOperation={cancelOperationController}
          removeQueuedUpload={removeQueuedUpload}
          onDownloadOperationDetails={downloadOperationDetails}
          hasFinishedOperations={hasFinishedOperations}
          onClearFinishedOperations={clearFinishedOperations}
          onClose={closeOperationsDetailsModal}
        />
      )}
    </div>
  );
}
