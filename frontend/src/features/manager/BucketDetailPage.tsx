/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActionButton, ListActions, ListBadge } from "../../components/list/ListControls";
import { useEffect, useMemo, useState, useCallback, useId, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  cx,
  uiCardMutedClass,
  uiDataTableClass,
  uiInputClass,
  uiTableContainerClass,
} from "../../components/ui/styles";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageHeader from "../../components/PageHeader";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { settingsLabels } from "../../components/settings/settingsLabels";
import { useI18n } from "../../i18n";
import UiTextarea from "../../components/ui/UiTextarea";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import SplitView from "../../components/SplitView";
import { MetricsCard } from "../../components/MetricsCard";
import UsageTile from "../../components/UsageTile";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { formatCompactNumber } from "../../utils/format";
import { formatLocalDateTime } from "../../utils/dateTime";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { useS3AccountContext } from "./S3AccountContext";
import TrafficAnalytics from "./TrafficAnalytics";
import BucketUsageStatsPanel from "../shared/BucketUsageStatsPanel";
import PropertySummaryChip, { PropertySummaryTone } from "../../components/PropertySummaryChip";
import { useCephAdminEndpoint } from "../cephAdmin/CephAdminEndpointContext";
import {
  BucketFeatureSection,
  BucketFeatureJsonExample,
  BucketFeatureModeToggle,
  BucketAclFeature,
  BucketAccessLoggingFeature,
  BucketCorsFeature,
  BucketEncryptionFeature,
  EndpointFeatureDisabledNotice,
  BucketNotificationsFeature,
  BucketObjectLockFeature,
  BucketTagsFeature,
  BucketVersioningFeature,
  BucketWebsiteFeature,
  BucketPolicyFeature,
  BucketPublicAccessFeature,
  type BucketQuotaUnit,
  resolveFeatureVisualState,
  useBucketAccessLoggingController,
  useBucketAclController,
  useBucketCorsController,
  useBucketEncryptionController,
  useBucketLifecycleController,
  useBucketMetadataController,
  useBucketNotificationsController,
  useBucketObjectLockController,
  useBucketObjectsController,
  useBucketPolicyController,
  useBucketPublicAccessController,
  useBucketQuotaController,
  useBucketReplicationController,
  useBucketTagsController,
  useBucketUsageStatsController,
  useBucketVersioningController,
  useBucketWebsiteController,
} from "./bucketDetail";
import {
  describeLifecycleActions,
  lifecycleFilterLabel,
  lifecycleRuleId,
  lifecycleRulePrefix,
  lifecycleRuleStatus,
  type LifecycleRuleRecord,
} from "./bucketLifecycle";
import {
  buildBucketDetailBreadcrumbs,
  resolveBucketDetailSurface,
  resolveBucketDetailTabs,
  type BucketDetailTabId,
  type BucketDetailMode,
} from "./bucketDetail/bucketDetailSurface";
import {
  bucketConfigurationDeleteCopy,
  defaultLifecycleJsonExample,
  defaultReplicationJsonExample,
  type BucketConfigurationDeleteKind,
} from "./bucketDetail/bucketDetailConstants";
import { isApiFeatureNotImplemented } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import type { UiRole } from "../../api/users";

type LifecycleTableRow = {
  key: string;
  index: number;
  rule: LifecycleRuleRecord;
};

function getUserRole(): UiRole | null {
  return readStoredUser()?.role ?? null;
}

type PropertySummary = {
  label: string;
  state: string;
  tone: PropertySummaryTone;
};

const bucketFeatureInputClass = cx(uiInputClass, "settings-control");
const bucketFeatureLabelClass = "settings-label flex flex-col gap-1";
const bucketDetailHintClass = "settings-description";
const bucketDetailTwoColumnGridClass = "grid gap-3 md:grid-cols-2";

const bucketDetailCompactStackClass = "space-y-2";
const bucketDetailDividerClass =
  "divide-y divide-slate-200 dark:divide-slate-800";
const bucketDetailEndActionClass = "mt-2 flex justify-end";
const bucketDetailFieldStackClass = "settings-label flex flex-col gap-1";
const bucketDetailInlineActionsClass = "flex flex-wrap items-center gap-2";
const bucketDetailMutedBodyClass = "settings-description";
const bucketDetailMutedTitleClass = "settings-label";
const bucketDetailSectionStackClass = "space-y-4";
const bucketDetailStackClass = "space-y-3";

const bucketDetailTightStackClass = "space-y-1";
const bucketDetailWrapActionsClass = "flex flex-wrap gap-2";

type BucketDetailPageProps = {
  mode?: BucketDetailMode;
  bucketNameOverride?: string;
  accountIdOverride?: string | null;
  hideQuotaTab?: boolean;
  embedded?: boolean;
  hideObjectsTab?: boolean;
  bucketListPathOverride?: string;
  onBackToBuckets?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
};

type BucketDetailPageContentProps = BucketDetailPageProps & {
  activeTab: BucketDetailTabId;
  cephAdminEndpoint: ReturnType<typeof useCephAdminEndpoint>;
  onActiveTabChange: (tab: BucketDetailTabId) => void;
  routeBucketName?: string;
  s3AccountContext: ReturnType<typeof useS3AccountContext>;
};

export function BucketDetailContent(props: BucketDetailPageProps) {
  const [activeTab, setActiveTab] = useState<BucketDetailTabId>("overview");
  const params = useParams<{ bucketName: string }>();
  const s3AccountContext = useS3AccountContext();
  const cephAdminEndpoint = useCephAdminEndpoint();
  const bucketName = props.bucketNameOverride ?? params.bucketName;
  const contextKey = JSON.stringify([
    props.mode ?? "manager",
    bucketName ?? null,
    props.accountIdOverride ?? null,
    s3AccountContext.accountIdForApi ?? null,
    s3AccountContext.selectedS3AccountId ?? null,
    s3AccountContext.requiresS3AccountSelection
      ? null
      : (s3AccountContext.accounts[0]?.id ?? null),
    s3AccountContext.accessMode,
    cephAdminEndpoint.selectedEndpointId ?? null,
  ]);

  return (
    <BucketDetailPageContent
      key={contextKey}
      {...props}
      activeTab={activeTab}
      cephAdminEndpoint={cephAdminEndpoint}
      onActiveTabChange={setActiveTab}
      routeBucketName={params.bucketName}
      s3AccountContext={s3AccountContext}
    />
  );
}

export default function BucketDetailPage({ onDirtyChange, onBusyChange, ...props }: BucketDetailPageProps) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const labels = settingsLabels(t);
  const handleDirtyChange = useCallback((value: boolean) => {
    setDirty(value);
    onDirtyChange?.(value);
  }, [onDirtyChange]);
  const handleBusyChange = useCallback((value: boolean) => {
    setBusy(value);
    onBusyChange?.(value);
  }, [onBusyChange]);

  // Standalone routes own navigation; the Browser drawer owns its own guard
  // around the named BucketDetailContent export.
  return <>
    <BucketDetailContent {...props} onDirtyChange={handleDirtyChange} onBusyChange={handleBusyChange} />
    <SettingsNavigationGuard dirty={dirty || busy} discardDisabled={busy}
      title={busy ? t({ en: "Operation in progress", fr: "Opération en cours", de: "Vorgang läuft" }) : labels.discardTitle}
      description={busy ? t({
        en: "Wait for the operation to finish before leaving this page.",
        fr: "Attendez la fin de l’opération avant de quitter cette page.",
        de: "Warten Sie, bis der Vorgang abgeschlossen ist, bevor Sie diese Seite verlassen.",
      }) : labels.discardDescription}
      confirmLabel={labels.discard} cancelLabel={labels.keepEditing} closeLabel={labels.close} />
  </>;
}

function BucketDetailPageContent({
  mode = "manager",
  bucketNameOverride,
  accountIdOverride = null,
  hideQuotaTab = false,
  embedded = false,
  hideObjectsTab = false,
  bucketListPathOverride,
  onBackToBuckets,
  onDirtyChange,
  onBusyChange,
  activeTab,
  cephAdminEndpoint,
  onActiveTabChange,
  routeBucketName,
  s3AccountContext,
}: BucketDetailPageContentProps) {
  const tabsId = useId();
  const bucketName = bucketNameOverride ?? routeBucketName;
  const isCephAdmin = mode === "ceph-admin";
  const {
    accounts,
    selectedS3AccountId,
    accountIdForApi,
    requiresS3AccountSelection,
    managerBucketQuotaEnabled,
  } = s3AccountContext;
  const { selectedEndpointId, selectedEndpoint } = cephAdminEndpoint;
  const [showLifecycleJsonExample, setShowLifecycleJsonExample] = useState(false);
  const [showReplicationExample, setShowReplicationExample] = useState(false);
  const [pendingConfigurationDelete, setPendingConfigurationDelete] = useState<BucketConfigurationDeleteKind | null>(null);

  const selectedS3Account = useMemo(() => {
    if (isCephAdmin) return null;
    if (accountIdOverride) {
      return accounts.find((account) => account.id === accountIdOverride) ?? null;
    }
    if (selectedS3AccountId) {
      return accounts.find((account) => account.id === selectedS3AccountId) ?? null;
    }
    if (!requiresS3AccountSelection && accounts.length > 0) {
      return accounts[0];
    }
    return null;
  }, [accountIdOverride, accounts, isCephAdmin, requiresS3AccountSelection, selectedS3AccountId]);
  const isCephEndpoint = isCephAdmin || selectedS3Account?.endpoint_provider === "ceph";
  const accountId = accountIdOverride ?? accountIdForApi ?? null;
  const hasAccountContext = !requiresS3AccountSelection || accountId !== null;
  const endpointId = selectedEndpointId ?? null;
  const hasCephContext = Boolean(endpointId);
  const hasContext = isCephAdmin ? hasCephContext : hasAccountContext;
  const versioningController = useBucketVersioningController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    dirty: versioningDirty,
    isEnabled: versioningIsEnabled,
    load: loadVersioning,
    loadError: versioningLoadError,
    loading: versioningLoading,
    markEnabled: markVersioningEnabled,
    status: versioningStatus,
    updateDraft: updateVersioningDraft,
  } = versioningController;
  const policyController = useBucketPolicyController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    configured: policyConfigured,
    dirty: policyDirty,
    error: policyError,
    load: loadPolicy,
    loading: policyLoading,
  } = policyController;
  const corsController = useBucketCorsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    configured: corsConfigured,
    dirty: corsDirty,
    error: corsError,
    load: loadCors,
    loading: corsLoading,
  } = corsController;
  const accessLoggingController = useBucketAccessLoggingController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    configured: accessLoggingConfigured,
    dirty: accessLoggingDirty,
    error: accessLoggingError,
    load: loadAccessLogging,
    loading: accessLoggingLoading,
  } = accessLoggingController;
  const notificationsController = useBucketNotificationsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    configured: notificationsConfigured,
    dirty: notificationsDirty,
    error: notificationsError,
    load: loadNotifications,
    loading: notificationsLoading,
  } = notificationsController;
  const publicAccessController = useBucketPublicAccessController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    dirty: publicAccessDirty,
    error: publicAccessError,
    fullyEnabled: publicAccessBlockEnabled,
    load: loadPublicAccessBlock,
    loading: publicAccessLoading,
    partiallyEnabled: publicAccessBlockPartial,
  } = publicAccessController;
  const bucketAclController = useBucketAclController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    acl: bucketAcl,
    dirty: aclDirty,
    load: loadBucketAcl,
    loading: bucketAclLoading,
  } = bucketAclController;
  const objectLockController = useBucketObjectLockController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
    onVersioningEnabled: markVersioningEnabled,
    versioningEnabled: versioningIsEnabled,
  });
  const {
    active: objectLockActive,
    dirty: objectLockDirty,
    load: loadObjectLock,
    loadError: objectLockLoadError,
    loading: objectLockLoading,
    persistentlyEnabled: objectLockPersistentlyEnabled,
  } = objectLockController;
  const bucketTagsController = useBucketTagsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    dirty: tagsDirty,
    load: loadBucketTags,
    loading: bucketTagsLoading,
  } = bucketTagsController;
  const quotaFeatureEnabled = isCephAdmin ? isCephEndpoint : Boolean(isCephEndpoint && managerBucketQuotaEnabled);
  const showQuotaTab = !hideQuotaTab && (isCephAdmin || Boolean(quotaFeatureEnabled && hasAccountContext));
  const showObjectsTab = !hideObjectsTab;
  const availableTabs = useMemo(() => {
    return resolveBucketDetailTabs({ mode, showObjectsTab, showQuotaTab });
  }, [mode, showObjectsTab, showQuotaTab]);

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      onActiveTabChange(availableTabs[0] ?? "overview");
    }
  }, [activeTab, availableTabs, onActiveTabChange]);
  const staticWebsiteEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.static_website === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.static_website === true;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const websiteController = useBucketWebsiteController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext && staticWebsiteEnabled,
    endpointId,
  });
  const {
    configured: websiteConfigured,
    dirty: websiteDirty,
    error: websiteError,
    load: loadWebsite,
    loading: websiteLoading,
  } = websiteController;
  const sseFeatureEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.sse === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.sse === true;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const encryptionController = useBucketEncryptionController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext && sseFeatureEnabled,
    endpointId,
  });
  const {
    configured: encryptionConfigured,
    dirty: encryptionDirty,
    error: encryptionError,
    load: loadEncryption,
    loading: encryptionLoading,
  } = encryptionController;
  const {
    addCleanupExample: addLifecycleCleanupExample,
    addExpirationExample: addLifecycleExpirationExample,
    addTransitionExample: addLifecycleTransitionExample,
    deleteRule: deleteLifecycleRule,
    dirty: lifecycleDirty,
    editorVisible: showLifecycleEditor,
    error: lifecycleError,
    expirationDraft: lifecycleExpirationDraft,
    hasRules: hasLifecycleRules,
    load: loadLifecycle,
    loading: lifecycleLoading,
    mode: lifecycleMode,
    ruleCount: lifecycleRuleCount,
    rules: lifecycleRules,
    save: saveLifecycle,
    saving: savingLifecycle,
    status: lifecycleStatus,
    text: lifecycleText,
    toggleEditor: toggleLifecycleEditor,
    toggleRuleStatus: toggleLifecycleRuleStatus,
    transitionDraft: lifecycleTransitionDraft,
    updateExpirationDraft: updateLifecycleExpirationDraft,
    updateMode: updateLifecycleMode,
    updateText: updateLifecycleText,
    updateTransitionDraft: updateLifecycleTransitionDraft,
    warning: simpleLifecycleWarning,
  } = useBucketLifecycleController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    error: usageStatsError,
    load: loadUsageStats,
    loading: usageStatsLoading,
    recalculate: recalculateUsageStats,
    recalculating: usageStatsRecalculating,
    snapshot: usageStatsSnapshot,
  } = useBucketUsageStatsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    currentPrefix,
    error: objectsError,
    loading: objectsLoading,
    openPrefix: openObjectsPrefix,
    parentPrefix,
    prefixes,
    refresh: refreshObjects,
    rows: objectRows,
  } = useBucketObjectsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const snsFeatureEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.sns === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.sns !== false;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const replicationFeatureEnabled = useMemo(() => {
    if (!isCephEndpoint) return false;
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.replication === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.replication === true;
  }, [isCephAdmin, isCephEndpoint, selectedEndpoint, selectedS3Account]);
  const {
    addRule: addReplicationRule,
    busy: replicationBusy,
    clear: clearReplication,
    clearing: clearingReplication,
    configured: replicationConfigured,
    dirty: replicationDirty,
    error: replicationError,
    hasUnsupportedZone: replicationHasUnsupportedZone,
    load: loadReplication,
    loading: replicationLoading,
    mode: replicationMode,
    removeRule: removeReplicationRule,
    role: replicationRole,
    rules: replicationRules,
    save: saveReplication,
    saving: savingReplication,
    status: replicationStatus,
    text: replicationText,
    updateMode: updateReplicationMode,
    updateRole: updateReplicationRole,
    updateRule: updateReplicationRule,
    updateText: updateReplicationText,
    warning: replicationWarning,
  } = useBucketReplicationController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext && isCephEndpoint && replicationFeatureEnabled,
    endpointId,
  });
  const usageFeatureEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.metrics ?? true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.metrics ?? true;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const canViewBucketMetrics = hasContext;
  const canViewLiveBucketMetrics = Boolean(isCephEndpoint && usageFeatureEnabled);
  const exampleS3AccountId = selectedS3Account?.rgw_account_id || "ACCOUNT00000000000000001";

  useEffect(() => {
    if (activeTab === "metrics" && !canViewBucketMetrics) {
      onActiveTabChange("overview");
    }
  }, [activeTab, canViewBucketMetrics, onActiveTabChange]);
  const userRole = getUserRole();
  const isAdmin = isAdminLikeRole(userRole);
  const canEditQuota =
    quotaFeatureEnabled &&
    ((isCephAdmin && isAdmin && hasCephContext) || (!isCephAdmin && hasAccountContext));
  const quotaSectionRestricted = quotaFeatureEnabled && !canEditQuota;
  const versioningDisableBlocked = objectLockActive && versioningIsEnabled;
  const quotaFormId = "bucket-quota-form";

  const {
    bucket,
    error: bucketError,
    loading: loadingBucket,
    refresh: refreshBucketMeta,
  } = useBucketMetadataController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
    withStats: usageFeatureEnabled,
  });

  const {
    configured: quotaConfigured,
    dirty: quotaDirty,
    error: quotaError,
    maxObjects: quotaObjects,
    maxSize: quotaSizeGb,
    save: saveQuota,
    saving: updatingQuota,
    status: quotaStatus,
    unit: quotaSizeUnit,
    updateMaxObjects: updateQuotaObjects,
    updateMaxSize: updateQuotaSize,
    updateUnit: updateQuotaSizeUnit,
  } = useBucketQuotaController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    editable: canEditQuota,
    enabled: quotaFeatureEnabled,
    endpointId,
    maxObjects: bucket?.quota_max_objects,
    maxSizeBytes: bucket?.quota_max_size_bytes,
    onSaved: refreshBucketMeta,
  });

  const mutations = {
    versioning: versioningController.saving,
    objectLock: objectLockController.saving,
    lifecycle: savingLifecycle,
    policy: policyController.saving || policyController.deleting,
    acl: bucketAclController.saving,
    cors: corsController.saving || corsController.deleting,
    replication: savingReplication || clearingReplication,
    encryption: encryptionController.saving || encryptionController.deleting,
    publicAccess: publicAccessController.saving,
    website: websiteController.saving || websiteController.clearing,
    accessLogging: accessLoggingController.saving || accessLoggingController.clearing,
    notifications: notificationsController.saving || notificationsController.clearing,
    tags: bucketTagsController.saving || bucketTagsController.clearing,
    quota: updatingQuota,
  };
  const drafts = {
    versioning: versioningDirty,
    objectLock: objectLockDirty,
    lifecycle: lifecycleDirty,
    policy: policyDirty,
    acl: aclDirty,
    cors: corsDirty,
    replication: replicationDirty,
    encryption: encryptionDirty,
    publicAccess: publicAccessDirty,
    website: websiteDirty,
    accessLogging: accessLoggingDirty,
    notifications: notificationsDirty,
    tags: tagsDirty,
    quota: quotaDirty,
  };
  // Tab changes and Refresh may reload clean sections only. Reading the latest
  // flags through a ref avoids triggering the load effect on every draft edit.
  const protectedFeatures = useRef({ drafts, mutations });
  protectedFeatures.current = { drafts, mutations };

  const refreshActiveTab = useCallback(async () => {
    const loadClean = (feature: keyof typeof protectedFeatures.current.drafts, load: () => Promise<void>) => {
      const current = protectedFeatures.current;
      return current.drafts[feature] || current.mutations[feature] ? Promise.resolve() : load();
    };
    if (activeTab === "overview") {
      await Promise.all([
        loadClean("quota", refreshBucketMeta),
        loadClean("versioning", loadVersioning),
        loadClean("objectLock", loadObjectLock),
        loadClean("lifecycle", loadLifecycle),
        loadClean("policy", loadPolicy),
        loadClean("acl", loadBucketAcl),
        loadClean("cors", loadCors),
        loadClean("replication", loadReplication),
        loadClean("encryption", loadEncryption),
        loadClean("publicAccess", loadPublicAccessBlock),
        loadClean("website", loadWebsite),
        loadClean("accessLogging", loadAccessLogging),
        loadClean("notifications", loadNotifications),
      ]);
      return;
    }
    if (activeTab === "metrics") {
      if (!canViewBucketMetrics) return;
      await loadClean("quota", refreshBucketMeta);
      return;
    }
    if (activeTab === "objects") {
      await refreshObjects();
      return;
    }
    if (activeTab === "usage-stats") {
      await loadUsageStats();
      return;
    }
    if (activeTab === "properties") {
      await Promise.all([
        loadClean("versioning", loadVersioning), loadClean("objectLock", loadObjectLock),
        loadClean("lifecycle", loadLifecycle), loadClean("tags", loadBucketTags), loadClean("encryption", loadEncryption),
      ]);
      return;
    }
    if (activeTab === "permissions") {
      await Promise.all([
        loadClean("publicAccess", loadPublicAccessBlock), loadClean("acl", loadBucketAcl),
        loadClean("policy", loadPolicy), loadClean("cors", loadCors),
      ]);
      return;
    }
    if (activeTab === "advanced") {
      await Promise.all([
        loadClean("website", loadWebsite), loadClean("replication", loadReplication),
        loadClean("accessLogging", loadAccessLogging), loadClean("notifications", loadNotifications),
      ]);
      return;
    }
    if (activeTab === "ceph") {
      await Promise.all([
        loadClean("quota", refreshBucketMeta), loadClean("versioning", loadVersioning), loadClean("objectLock", loadObjectLock),
      ]);
    }
  }, [
    activeTab,
    canViewBucketMetrics,
    loadAccessLogging,
    loadBucketAcl,
    loadBucketTags,
    loadCors,
    loadEncryption,
    loadLifecycle,
    loadUsageStats,
    loadNotifications,
    loadObjectLock,
    loadPolicy,
    loadPublicAccessBlock,
    loadReplication,
    loadVersioning,
    loadWebsite,
    refreshObjects,
    refreshBucketMeta,
  ]);

  useEffect(() => {
    if (!hasContext) return;
    void refreshActiveTab();
  }, [hasContext, refreshActiveTab]);

  const activeTabLoading = useMemo(() => {
    if (activeTab === "overview") {
      return (
        loadingBucket ||
        versioningLoading ||
        objectLockLoading ||
        lifecycleLoading ||
        policyLoading ||
        bucketAclLoading ||
        corsLoading ||
        replicationLoading ||
        encryptionLoading ||
        publicAccessLoading
      );
    }
    if (activeTab === "metrics") {
      return loadingBucket;
    }
    if (activeTab === "objects") {
      return objectsLoading;
    }
    if (activeTab === "usage-stats") {
      return usageStatsLoading || usageStatsRecalculating;
    }
    if (activeTab === "properties") {
      return versioningLoading || objectLockLoading || lifecycleLoading || bucketTagsLoading || encryptionLoading;
    }
    if (activeTab === "permissions") {
      return publicAccessLoading || bucketAclLoading || policyLoading || corsLoading;
    }
    if (activeTab === "advanced") {
      return websiteLoading || replicationLoading || accessLoggingLoading || notificationsLoading;
    }
    if (activeTab === "ceph") {
      return loadingBucket || versioningLoading || objectLockLoading;
    }
    return false;
  }, [
    accessLoggingLoading,
    activeTab,
    bucketAclLoading,
    bucketTagsLoading,
    corsLoading,
    encryptionLoading,
    lifecycleLoading,
    loadingBucket,
    notificationsLoading,
    objectLockLoading,
    objectsLoading,
    policyLoading,
    publicAccessLoading,
    replicationLoading,
    usageStatsLoading,
    usageStatsRecalculating,
    versioningLoading,
    websiteLoading,
  ]);

  const canRefreshActiveTab = useMemo(() => {
    if (activeTab === "metrics") {
      return hasContext && canViewBucketMetrics;
    }
    if (activeTab === "objects") {
      return hasContext;
    }
    return hasContext;
  }, [activeTab, canViewBucketMetrics, hasContext]);

  const storageUsage = useMemo(
    () => ({
      used: bucket?.used_bytes ?? null,
      quota: bucket?.quota_max_size_bytes ?? null,
    }),
    [bucket]
  );

  const objectUsage = useMemo(
    () => ({
      used: bucket?.object_count ?? null,
      quota: bucket?.quota_max_objects ?? null,
    }),
    [bucket]
  );
  const bucketOwner = useMemo(() => {
    const ownerFromBucket = (bucket?.owner ?? "").trim();
    if (ownerFromBucket) return ownerFromBucket;
    const ownerFromAcl = (bucketAcl?.owner ?? "").trim();
    if (ownerFromAcl) return ownerFromAcl;
    return null;
  }, [bucket?.owner, bucketAcl?.owner]);

  const replicationBlocked = !replicationFeatureEnabled;
  const lifecycleNotImplemented = isApiFeatureNotImplemented(lifecycleError);
  const replicationNotImplemented = isApiFeatureNotImplemented(replicationError);
  const lifecycleCardState = resolveFeatureVisualState({
    disabled: lifecycleNotImplemented,
    configured: hasLifecycleRules,
    unsaved: lifecycleDirty,
  });
  const replicationCardState = resolveFeatureVisualState({
    disabled: replicationBlocked || replicationNotImplemented,
    configured: replicationConfigured,
    unsaved: replicationDirty,
  });
  const lifecycleTableRows = useMemo<LifecycleTableRow[]>(
    () =>
      lifecycleRules.map((rawRule, index) => {
        const rule = rawRule as LifecycleRuleRecord;
        const ruleId = lifecycleRuleId(rule);
        return {
          key: `${ruleId ?? lifecycleRulePrefix(rule) ?? "rule"}-${index}`,
          index,
          rule,
        };
      }),
    [lifecycleRules],
  );
  const lifecycleTableColumns: Array<DataTableColumn<LifecycleTableRow>> = [
    {
      id: "id",
      label: "ID",
      primary: true,
      headerClassName: "min-w-48",
      cellClassName: "min-w-48",
      render: ({ rule }) => lifecycleRuleId(rule) ?? "(no ID)",
    },
    {
      id: "status",
      label: "Status",
      headerClassName: "w-px whitespace-nowrap",
      cellClassName: "w-px whitespace-nowrap",
      render: ({ index, rule }) => {
        const status = lifecycleRuleStatus(rule);
        return (
          <ListActionButton
            type="button"
            onClick={() => toggleLifecycleRuleStatus(index)}
            variant={status === "Disabled" ? "secondary" : "success"}
            disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
          >
            {status}
          </ListActionButton>
        );
      },
    },
    {
      id: "filter",
      label: "Filter",
      headerClassName: "min-w-32 whitespace-nowrap",
      cellClassName: "min-w-32",
      render: ({ rule }) => lifecycleFilterLabel(rule.Filter),
    },
    {
      id: "actions",
      label: "Rule actions",
      mobileLabel: "Rule actions",
      headerClassName: "min-w-72",
      cellClassName: "min-w-72",
      render: ({ rule }) => describeLifecycleActions(rule),
    },
    {
      id: "manage",
      label: "Manage",
      mobileRole: "actions",
      render: ({ index }) => (
        <ListActions>
          <ListActionButton
            variant="danger"
            type="button"
            onClick={() => deleteLifecycleRule(index)}
            disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
          >
            Delete
          </ListActionButton>
        </ListActions>
      ),
    },
  ];
  const quotaCardState = resolveFeatureVisualState({
    disabled: !quotaFeatureEnabled || quotaSectionRestricted,
    configured: quotaConfigured,
    unsaved: quotaDirty,
  });
  const hasUnsavedChanges = Object.values(drafts).some(Boolean);
  const configurationBusy = Object.values(mutations).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
    return () => onDirtyChange?.(false);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(configurationBusy);
    return () => onBusyChange?.(false);
  }, [configurationBusy, onBusyChange]);

  const propertySummary = useMemo<PropertySummary[]>(() => {
    const versioningState = versioningLoading
      ? "Loading..."
      : versioningLoadError
        ? "Unavailable"
        : versioningStatus ?? "Disabled";
    const versioningNormalized = String(versioningState || "").trim().toLowerCase();
    const versioningTone: PropertySummary["tone"] =
      versioningLoading || versioningLoadError
        ? "unknown"
        : versioningIsEnabled
          ? "active"
          : versioningNormalized === "suspended"
            ? "unknown"
            : "inactive";

    const hasObjectLockData = !(objectLockLoading || objectLockLoadError);
    let objectLockState = "Disabled";
    let objectLockTone: PropertySummary["tone"] = "inactive";
    if (!hasObjectLockData) {
      objectLockState = objectLockLoading ? "Loading..." : "Unavailable";
      objectLockTone = "unknown";
    } else if (objectLockPersistentlyEnabled) {
      objectLockState = "Enabled";
      objectLockTone = "active";
    } else {
      objectLockState = "Disabled";
      objectLockTone = "inactive";
    }

    const lifecycleState = lifecycleLoading
      ? "Loading..."
      : lifecycleError
        ? "Unavailable"
        : hasLifecycleRules
          ? "Enabled"
          : "Disabled";
    const lifecycleTone: PropertySummary["tone"] = lifecycleLoading
      ? "unknown"
      : hasLifecycleRules
        ? "active"
        : lifecycleError
          ? "unknown"
          : "inactive";

    const quotaState = bucket ? (quotaConfigured ? "Configured" : "Not set") : "Unknown";
    const quotaTone: PropertySummary["tone"] =
      !bucket || quotaState === "Unknown" ? "unknown" : quotaConfigured ? "active" : "inactive";

    const policyState = policyLoading
      ? "Loading..."
      : policyError
        ? "Unavailable"
        : policyConfigured
          ? "Configured"
          : "Not set";
    const policyTone: PropertySummary["tone"] =
      policyLoading || policyError ? "unknown" : policyConfigured ? "active" : "inactive";

    const corsState = corsLoading
      ? "Loading..."
      : corsError
        ? "Unavailable"
        : corsConfigured
          ? "Configured"
          : "Not set";
    const corsTone: PropertySummary["tone"] = corsLoading || corsError ? "unknown" : corsConfigured ? "active" : "inactive";

    const encryptionState = !sseFeatureEnabled
      ? "Unavailable"
      : encryptionLoading
        ? "Loading..."
        : encryptionError
          ? "Unavailable"
          : encryptionConfigured
            ? "Enabled"
            : "Disabled";
    const encryptionTone: PropertySummary["tone"] = !sseFeatureEnabled
      ? "unknown"
      : encryptionLoading || encryptionError
        ? "unknown"
        : encryptionConfigured
          ? "active"
          : "inactive";

    const accessLoggingState = accessLoggingLoading
      ? "Loading..."
      : accessLoggingError
        ? "Unavailable"
        : accessLoggingConfigured
          ? "Enabled"
          : "Disabled";
    const accessLoggingTone: PropertySummary["tone"] =
      accessLoggingLoading || accessLoggingError ? "unknown" : accessLoggingConfigured ? "active" : "inactive";

    const notificationsState = notificationsLoading
      ? "Loading..."
      : notificationsError
        ? "Unavailable"
        : notificationsConfigured
          ? "Configured"
          : "Not set";
    const notificationsTone: PropertySummary["tone"] =
      notificationsLoading || notificationsError ? "unknown" : notificationsConfigured ? "active" : "inactive";

    const replicationState = !isCephEndpoint || !replicationFeatureEnabled
      ? "Unavailable"
      : replicationLoading
        ? "Loading..."
        : replicationError
          ? "Unavailable"
          : replicationConfigured
            ? "Configured"
            : "Not set";
    const replicationTone: PropertySummary["tone"] = !isCephEndpoint || !replicationFeatureEnabled
      ? "unknown"
      : replicationLoading || replicationError
        ? "unknown"
        : replicationConfigured
          ? "active"
          : "inactive";

    const websiteState = !staticWebsiteEnabled
      ? "Unavailable"
      : websiteLoading
        ? "Loading..."
        : websiteError
          ? "Unavailable"
          : websiteConfigured
            ? "Enabled"
            : "Disabled";
    const websiteTone: PropertySummary["tone"] = !staticWebsiteEnabled
      ? "unknown"
      : websiteLoading || websiteError
        ? "unknown"
        : websiteConfigured
          ? "active"
          : "inactive";

    const publicAccessState = publicAccessLoading
      ? "Loading..."
      : publicAccessError
        ? "Unavailable"
        : publicAccessBlockEnabled
          ? "Enabled"
          : publicAccessBlockPartial
            ? "Partial"
            : "Disabled";
    const publicAccessTone: PropertySummary["tone"] =
      publicAccessLoading || publicAccessError ? "unknown" : publicAccessBlockEnabled || publicAccessBlockPartial ? "active" : "inactive";

    const summary: PropertySummary[] = [
      { label: "Versioning", state: versioningState, tone: versioningTone },
      { label: "Object Lock", state: objectLockState, tone: objectLockTone },
      { label: "Block public access", state: publicAccessState, tone: publicAccessTone },
      { label: "Lifecycle rules", state: lifecycleState, tone: lifecycleTone },
    ];
    if (staticWebsiteEnabled) {
      summary.push({ label: "Static website", state: websiteState, tone: websiteTone });
    }
    if (quotaFeatureEnabled) {
      summary.push({ label: "Quota", state: quotaState, tone: quotaTone });
    }
    summary.push({ label: "Bucket policy", state: policyState, tone: policyTone });
    summary.push({ label: "CORS", state: corsState, tone: corsTone });
    if (sseFeatureEnabled) {
      summary.push({ label: "Server-side encryption", state: encryptionState, tone: encryptionTone });
    }
    summary.push({ label: "Access logging", state: accessLoggingState, tone: accessLoggingTone });
    if (snsFeatureEnabled) {
      summary.push({ label: "Notifications", state: notificationsState, tone: notificationsTone });
    }
    if (replicationFeatureEnabled) {
      summary.push({ label: "Replication", state: replicationState, tone: replicationTone });
    }

    return summary;
  }, [
    bucket,
    accessLoggingConfigured,
    accessLoggingError,
    accessLoggingLoading,
    encryptionConfigured,
    encryptionError,
    encryptionLoading,
    hasLifecycleRules,
    corsConfigured,
    corsError,
    corsLoading,
    lifecycleError,
    lifecycleLoading,
    notificationsConfigured,
    notificationsError,
    notificationsLoading,
    objectLockLoadError,
    objectLockLoading,
    objectLockPersistentlyEnabled,
    policyConfigured,
    policyError,
    policyLoading,
    quotaConfigured,
    quotaFeatureEnabled,
    publicAccessBlockEnabled,
    publicAccessBlockPartial,
    publicAccessError,
    publicAccessLoading,
    sseFeatureEnabled,
    versioningLoadError,
    versioningIsEnabled,
    versioningLoading,
    versioningStatus,
    isCephEndpoint,
    replicationConfigured,
    replicationError,
    replicationFeatureEnabled,
    replicationLoading,
    snsFeatureEnabled,
    staticWebsiteEnabled,
    websiteConfigured,
    websiteError,
    websiteLoading,
  ]);

  const basePath = useMemo(
    () => bucketListPathOverride ?? resolveBucketDetailSurface(mode).bucketListPath,
    [bucketListPathOverride, mode]
  );
  const breadcrumbs = useMemo(() => {
    const items = buildBucketDetailBreadcrumbs(mode, bucketName);
    return items.map((item, index) => (index === 1 ? { ...item, to: basePath } : item));
  }, [basePath, bucketName, mode]);

  const confirmPendingConfigurationDelete = async () => {
    if (!pendingConfigurationDelete) return;
    try {
      if (pendingConfigurationDelete === "cors") await corsController.remove();
      if (pendingConfigurationDelete === "encryption") await encryptionController.remove();
      if (pendingConfigurationDelete === "tags") await bucketTagsController.clear();
      if (pendingConfigurationDelete === "notifications") await notificationsController.clear();
      if (pendingConfigurationDelete === "replication") await clearReplication();
      if (pendingConfigurationDelete === "website") await websiteController.clear();
      if (pendingConfigurationDelete === "policy") await policyController.remove();
      if (pendingConfigurationDelete === "access-logging") await accessLoggingController.clear();
    } finally {
      setPendingConfigurationDelete(null);
    }
  };

  const handleUpdateQuota = (e: React.FormEvent) => {
    e.preventDefault();
    void saveQuota();
  };

  const configurationDeleteLoading =
    pendingConfigurationDelete === "cors"
      ? corsController.deleting
      : pendingConfigurationDelete === "encryption"
        ? encryptionController.deleting
        : pendingConfigurationDelete === "tags"
          ? bucketTagsController.clearing
          : pendingConfigurationDelete === "notifications"
            ? notificationsController.clearing
            : pendingConfigurationDelete === "replication"
              ? clearingReplication
              : pendingConfigurationDelete === "website"
                ? websiteController.clearing
                : pendingConfigurationDelete === "policy"
                  ? policyController.deleting
                  : pendingConfigurationDelete === "access-logging"
                    ? accessLoggingController.clearing
                    : false;

  return (
    <div className={bucketDetailSectionStackClass}>
      {!embedded && (
        <PageHeader
          title={bucketName ?? "Bucket"}
          description={
            bucketError ||
            (isCephAdmin
              ? "Bucket configuration and permissions (Admin Ops + S3)."
              : "Bucket overview, objects, properties, permissions, metrics.")
          }
          breadcrumbs={breadcrumbs}
          actions={[
            onBackToBuckets
              ? { label: "← Back to buckets", onClick: onBackToBuckets, variant: "ghost" }
              : { label: "← Back to buckets", to: basePath, variant: "ghost" },
          ]}
        />
      )}

      {isCephAdmin && !endpointId && (
        <PageBanner tone="warning">Select a Ceph endpoint before managing this bucket.</PageBanner>
      )}

      {bucketError && <PageBanner tone="error">{bucketError}</PageBanner>}

      <PageTabs
        variant="line"
        ariaLabel="Bucket sections"
        idPrefix={tabsId}
        activeTab={activeTab}
        onChange={(id) => onActiveTabChange(id as BucketDetailTabId)}
        headerActions={
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={refreshActiveTab}
            disabled={!canRefreshActiveTab || activeTabLoading}
          >
            {activeTabLoading ? "Loading..." : "Refresh"}
          </SettingsButton>
        }
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <section className="space-y-4 px-1 py-2">
                <header className={bucketDetailTightStackClass}>
                  <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">
                    {bucketName ? `Bucket ${bucketName}` : "Bucket overview"}
                  </h3>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1">
                    <div className={bucketDetailHintClass}>
                      <dt className="inline">Owner: </dt>
                      <dd className="inline font-semibold text-slate-700 dark:text-slate-200">{bucketOwner ?? (loadingBucket || bucketAclLoading ? "Loading..." : "Unknown")}</dd>
                    </div>
                    <div className={bucketDetailHintClass}>
                      <dt className="inline">Created: </dt>
                      <dd className="inline font-semibold text-slate-700 dark:text-slate-200">{loadingBucket ? "Loading..." : formatLocalDateTime(bucket?.creation_date)}</dd>
                    </div>
                  </dl>
                </header>
                <div className={bucketDetailTwoColumnGridClass}>
                  <UsageTile
                    label="Storage"
                    used={storageUsage.used}
                    quota={storageUsage.quota}
                    formatter={formatBytes}
                    quotaFormatter={formatBytes}
                    loading={loadingBucket}
                    emptyHint="No storage quota configured."
                  />
                  <UsageTile
                    label="Objects"
                    used={objectUsage.used}
                    quota={objectUsage.quota}
                    formatter={formatCompactNumber}
                    quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
                    loading={loadingBucket}
                    unitHint="objects"
                    emptyHint="No object quota configured."
                  />
                </div>
                <div className="border-t border-[color:var(--ui-border-soft)] pt-4">
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Bucket properties</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {propertySummary.map((item) => (
                      <PropertySummaryChip key={item.label} label={item.label} state={item.state} tone={item.tone} />
                    ))}
                  </div>
                </div>
              </section>
            ),
          },
          ...(showObjectsTab
            ? [
                {
                  id: "objects",
                  label: "Objects / S3 Console",
                  content: (
                    <SplitView
                      left={
                  <div className="p-3 space-y-2">
                    <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">Prefixes</p>
                    <div className={bucketDetailTightStackClass}>
                      <button
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ui-caption ${
                          currentPrefix === ""
                            ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                        }`}
                        onClick={() => openObjectsPrefix("")}
                      >
                        <span>(root)</span>
                      </button>
                      {parentPrefix !== "" && (
                        <button
                          className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ui-caption text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                          onClick={() => openObjectsPrefix(parentPrefix)}
                        >
                          <span>⬆️ Up</span>
                          <span className={bucketDetailHintClass}>{parentPrefix || "/"}</span>
                        </button>
                      )}
                      {prefixes.map((prefix) => {
                        const isActive = prefix === currentPrefix;
                        const displayName = prefix.replace(currentPrefix, "") || prefix;
                        return (
                          <button
                            key={prefix}
                            className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ui-caption ${
                              isActive
                                ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                            }`}
                            onClick={() => openObjectsPrefix(prefix)}
                          >
                            <span>{displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                }
                right={
                  <div className="space-y-3 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className={bucketDetailTightStackClass}>
                        <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">Path</p>
                        <div className="ui-caption text-slate-500 dark:text-slate-300">
                          {bucketName}/{currentPrefix || "(root)"}
                        </div>
                        <div className={bucketDetailHintClass}>
                          {isCephAdmin
                            ? "Read-only preview using the selected endpoint's Ceph Admin credentials."
                            : "Read-only preview. Use the main Browser page for object operations."}
                        </div>
                      </div>
                      <div className={bucketDetailWrapActionsClass}>
                        <button
                          type="button"
                          onClick={() => void refreshObjects()}
                          disabled={objectsLoading}
                          className="rounded-md border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>
                    {objectsError && (
                      <UiInlineMessage tone="error">{objectsError}</UiInlineMessage>
                    )}

                    <div className={uiTableContainerClass}>
                      <table className={uiDataTableClass}>
                        <thead>
                          <tr>
                            <th className="text-left">
                              Name
                            </th>
                            <th className="text-left">
                              Size
                            </th>
                            <th className="text-left">
                              Last modified
                            </th>
                            <th className="text-left">
                              Storage class
                            </th>
                          </tr>
                        </thead>
                        <tbody className={bucketDetailDividerClass}>
                          {objectsLoading && (
                            <tr>
                              <td colSpan={4} className="ui-table-secondary">
                                Loading objects...
                              </td>
                            </tr>
                          )}
                          {!objectsLoading && objectRows.length === 0 && (
                            <tr>
                              <td colSpan={4} className="ui-table-secondary">
                                No objects in this prefix.
                              </td>
                            </tr>
                          )}
                          {!objectsLoading &&
                            objectRows.map((row) => {
                              if (row.type === "prefix") {
                                return (
                                  <tr
                                    key={row.key}
                                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    onClick={() => openObjectsPrefix(row.key)}
                                  >
                                    <td className="ui-table-primary">
                                      📁 {row.name}
                                    </td>
                                    <td className="ui-table-secondary">—</td>
                                    <td className="ui-table-secondary">—</td>
                                    <td className="ui-table-secondary">—</td>
                                  </tr>
                                );
                              }
                              return (
                                <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                  <td className="ui-table-primary">{row.name}</td>
                                  <td className="ui-table-secondary">{formatBytes(row.object.size)}</td>
                                  <td className="ui-table-secondary">
                                    {row.object.last_modified ? new Date(row.object.last_modified).toLocaleString() : "-"}
                                  </td>
                                  <td className="ui-table-secondary">{row.object.storage_class ?? "-"}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                }
              />
            ),
          },
        ]
      : []),
          {
            id: "properties",
            label: "Properties",
            content: (
              <div className="settings-compact">
                <div>
                  <BucketVersioningFeature
                    controller={versioningController}
                    disableBlocked={versioningDisableBlocked}
                  />
                  <BucketEncryptionFeature
                    controller={encryptionController}
                    enabled={sseFeatureEnabled}
                    onRequestDelete={() => setPendingConfigurationDelete("encryption")}
                  />
                  <BucketObjectLockFeature
                    controller={objectLockController}
                    onEnableVersioningDraft={() => updateVersioningDraft(true)}
                  />
                  <BucketFeatureSection
                      title="Lifecycle rules"
                      description="S3-side expiration/clean-up."
                      mode="hybrid"
                      visualState={lifecycleCardState}
                      presentation="workbench"
                      successMessage={lifecycleStatus}
                      busy={savingLifecycle || lifecycleLoading}
                      testId="bucket-feature-lifecycle"
                      actions={
                        <div className={bucketDetailWrapActionsClass}>
                          <span className={bucketDetailHintClass}>
                            {lifecycleRuleCount === 1 ? "1 rule" : `${lifecycleRuleCount} rules`}
                          </span>
                          <SettingsButton
                            type="button"
                            onClick={toggleLifecycleEditor}
                            variant="secondary"
                            disabled={lifecycleNotImplemented}
                          >
                            {showLifecycleEditor ? "Hide editor" : "Show editor"}
                          </SettingsButton>
                          <SettingsButton
                            type="button"
                            onClick={saveLifecycle}
                            disabled={
                              lifecycleNotImplemented ||
                              savingLifecycle ||
                              lifecycleLoading ||
                              !lifecycleDirty ||
                              lifecycleMode !== "json"
                            }
                            title={
                              lifecycleMode === "simple"
                                ? "Quick add actions save immediately."
                                : undefined
                            }
                            variant="primary"
                          >
                            {savingLifecycle ? "Saving..." : "Save"}
                          </SettingsButton>
                        </div>
                      }
                    >
                      {lifecycleError && (
                        <UiInlineMessage tone="error" className="mt-2">{lifecycleError}</UiInlineMessage>
                      )}
                      <DataTableShell
                        columns={lifecycleTableColumns}
                        rows={lifecycleTableRows}
                        rowKey={(row) => row.key}
                        status={
                          lifecycleLoading && lifecycleTableRows.length === 0
                            ? "loading"
                            : lifecycleTableRows.length === 0
                              ? "empty"
                              : "ready"
                        }
                        loadingMessage="Loading lifecycle rules..."
                        errorMessage="Unable to load lifecycle rules."
                        emptyMessage="No rules configured on this bucket."
                        primaryColumnId="id"
                        responsiveCards
                      />

                      {showLifecycleEditor && (
                        <>
                          <div className="mt-3">
                            <BucketFeatureModeToggle
                              value={lifecycleMode}
                              options={[
                                { value: "json", label: "JSON mode" },
                                { value: "simple", label: "Quick add" },
                              ]}
                              onChange={updateLifecycleMode}
                              disabled={lifecycleNotImplemented}
                            />
                          </div>
                          {lifecycleMode === "simple" ? (
                            <div className="mt-3 space-y-3">
                              {simpleLifecycleWarning && (
                                <UiInlineMessage tone="warning">{simpleLifecycleWarning}</UiInlineMessage>
                              )}
                              <p className={bucketDetailMutedBodyClass}>
                                Quickly add one of the preconfigured rules below (appended to the existing configuration).
                              </p>
                              <div className={bucketDetailStackClass}>
                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className={bucketDetailMutedTitleClass}>
                                    Rule 1: noncurrent 90d + multipart 30d + delete markers (explicit)
                                  </p>
                                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                    Cleans noncurrent versions after 90d, removes incomplete multipart uploads after 30d, and deletes expired delete markers.
                                  </p>
                                  <div className={bucketDetailEndActionClass}>
                                    <SettingsButton
                                      type="button"
                                      onClick={() => void addLifecycleCleanupExample()}
                                      variant="secondary"
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </SettingsButton>
                                  </div>
                                </div>

                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className={bucketDetailMutedTitleClass}>Rule 2: current/noncurrent transitions</p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                                    <label className={bucketDetailFieldStackClass}>
                                      Current versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={lifecycleTransitionDraft.currentDays}
                                        onChange={(e) =>
                                          updateLifecycleTransitionDraft({
                                            currentDays: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-28")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Noncurrent versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={lifecycleTransitionDraft.noncurrentDays}
                                        onChange={(e) =>
                                          updateLifecycleTransitionDraft({
                                            noncurrentDays: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-28")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Storage class
                                      <input
                                        type="text"
                                        value={lifecycleTransitionDraft.storageClass}
                                        onChange={(e) =>
                                          updateLifecycleTransitionDraft({
                                            storageClass: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="GLACIER"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Prefix (optional)
                                      <input
                                        type="text"
                                        value={lifecycleTransitionDraft.prefix}
                                        onChange={(e) =>
                                          updateLifecycleTransitionDraft({
                                            prefix: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="logs/"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                  </div>
                                  <div className={bucketDetailEndActionClass}>
                                    <SettingsButton
                                      type="button"
                                      onClick={() => void addLifecycleTransitionExample()}
                                      variant="secondary"
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </SettingsButton>
                                  </div>
                                </div>

                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className={bucketDetailMutedTitleClass}>Rule 3: current/noncurrent expiration</p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                                    <label className={bucketDetailFieldStackClass}>
                                      Current versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={lifecycleExpirationDraft.currentDays}
                                        onChange={(e) =>
                                          updateLifecycleExpirationDraft({
                                            currentDays: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Noncurrent versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={lifecycleExpirationDraft.noncurrentDays}
                                        onChange={(e) =>
                                          updateLifecycleExpirationDraft({
                                            noncurrentDays: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Prefix (optional)
                                      <input
                                        type="text"
                                        value={lifecycleExpirationDraft.prefix}
                                        onChange={(e) =>
                                          updateLifecycleExpirationDraft({
                                            prefix: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="archive/"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                  </div>
                                  <div className={bucketDetailEndActionClass}>
                                    <SettingsButton
                                      type="button"
                                      onClick={() => void addLifecycleExpirationExample()}
                                      variant="secondary"
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </SettingsButton>
                                  </div>
                                </div>
                              </div>
                              <p className={bucketDetailHintClass}>
                                Use JSON mode to customize or edit rules.
                              </p>
                            </div>
                          ) : (
                            <div className="mt-3 space-y-2">
                              <p className={bucketDetailHintClass}>
                                Paste a JSON array that matches the S3 API (<code>Rules</code>). Existing rules are listed above.
                              </p>
                              <UiTextarea label="Lifecycle rules (JSON)"
                                value={lifecycleText}
                                onChange={(e) => updateLifecycleText(e.target.value)}
                                rows={10}
                                className="settings-control font-mono"
                                disabled={lifecycleNotImplemented}
                              />
                              <BucketFeatureJsonExample
                                show={showLifecycleJsonExample}
                                onToggle={() => setShowLifecycleJsonExample((prev) => !prev)}
                                example={defaultLifecycleJsonExample}
                                onUseExample={() => updateLifecycleText(defaultLifecycleJsonExample)}
                                disabled={lifecycleNotImplemented}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </BucketFeatureSection>
                    <BucketTagsFeature
                      controller={bucketTagsController}
                      onRequestClear={() => setPendingConfigurationDelete("tags")}
                    />
                </div>
              </div>
            ),
          },
          {
            id: "permissions",
            label: "Permissions",
            content: (
              <div className="settings-compact">
                <BucketPublicAccessFeature controller={publicAccessController} />

                <BucketAclFeature controller={bucketAclController} />

                <BucketPolicyFeature
                  bucketName={bucketName}
                  controller={policyController}
                  onRequestDelete={() => setPendingConfigurationDelete("policy")}
                />

                <BucketCorsFeature
                  controller={corsController}
                  onRequestDelete={() => setPendingConfigurationDelete("cors")}
                />

              </div>
            ),
          },
          {
            id: "advanced",
            label: "Advanced",
            content: (
              <div className="settings-compact">
                <BucketWebsiteFeature
                  blocked={!staticWebsiteEnabled}
                  bucketName={bucketName}
                  controller={websiteController}
                  onRequestDelete={() => setPendingConfigurationDelete("website")}
                />
                {isCephEndpoint && (
                  <BucketFeatureSection
                    title="Replication / multisite"
                    description="Configure Ceph RGW multisite bucket replication across zones within this bucket's zonegroup."
                    mode="hybrid"
                    visualState={replicationCardState}
                    presentation="workbench"
                    successMessage={replicationStatus}
                    busy={replicationBusy}
                    testId="bucket-feature-replication"
                    actions={
                      <div className={bucketDetailWrapActionsClass}>
                        <SettingsButton
                          type="button"
                          onClick={() => setPendingConfigurationDelete("replication")}
                          disabled={replicationBlocked || replicationNotImplemented || replicationBusy || !replicationConfigured}
                          variant="danger"
                        >
                          {clearingReplication ? "Clearing..." : "Clear"}
                        </SettingsButton>
                        <SettingsButton
                          type="button"
                          onClick={saveReplication}
                          disabled={replicationBlocked || replicationNotImplemented || replicationBusy || !replicationDirty}
                          variant="primary"
                        >
                          {savingReplication ? "Saving..." : "Save"}
                        </SettingsButton>
                      </div>
                    }
                  >
                    <BucketFeatureModeToggle
                      value={replicationMode}
                      options={[
                        { value: "graphical", label: "Graphical mode" },
                        { value: "json", label: "JSON mode" },
                      ]}
                      onChange={updateReplicationMode}
                      disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                    />
                    {replicationBlocked && <EndpointFeatureDisabledNotice featureLabel="Bucket replication" />}
                    {replicationError && (
                      <UiInlineMessage tone="error">{replicationError}</UiInlineMessage>
                    )}
                    {replicationWarning && (
                      <UiInlineMessage tone="warning">{replicationWarning}</UiInlineMessage>
                    )}
                    {replicationLoading ? (
                      <UiInlineMessage>Loading replication configuration...</UiInlineMessage>
                    ) : replicationMode === "graphical" ? (
                      <div className={bucketDetailStackClass}>
                        <label className={bucketFeatureLabelClass}>
                          Role ARN
                          <input
                            type="text"
                            value={replicationRole}
                            onChange={(e) => updateReplicationRole(e.target.value)}
                            className={bucketFeatureInputClass}
                            placeholder="arn:aws:iam::123456789012:role/replication-role"
                            disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                          />
                        </label>
                        <div className={bucketDetailStackClass}>
                          {replicationRules.map((rule, index) => (
                            <div
                              key={rule.uiId}
                              className={cx(uiCardMutedClass, "space-y-3 p-3")}
                            >
                              <div className="flex items-center justify-between">
                                <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Rule {index + 1}</p>
                                <SettingsButton
                                  type="button"
                                  onClick={() => removeReplicationRule(rule.uiId)}
                                  disabled={replicationBlocked || replicationNotImplemented || replicationBusy || replicationRules.length <= 1}
                                  variant="danger"
                                >
                                  Remove
                                </SettingsButton>
                              </div>
                              <div className={bucketDetailTwoColumnGridClass}>
                                <label className={bucketFeatureLabelClass}>
                                  ID
                                  <input
                                    type="text"
                                    value={rule.id}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { id: e.target.value })}
                                    className={bucketFeatureInputClass}
                                    placeholder={`rule-${index + 1}`}
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  />
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Status
                                  <select
                                    value={rule.status}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { status: e.target.value as "Enabled" | "Disabled" })}
                                    className={bucketFeatureInputClass}
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  >
                                    <option value="Enabled">Enabled</option>
                                    <option value="Disabled">Disabled</option>
                                  </select>
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Priority
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={rule.priority}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { priority: e.target.value })}
                                    className={bucketFeatureInputClass}
                                    placeholder="1"
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  />
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Prefix (optional)
                                  <input
                                    type="text"
                                    value={rule.prefix}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { prefix: e.target.value })}
                                    className={bucketFeatureInputClass}
                                    placeholder="logs/"
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  />
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Destination bucket ARN
                                  <input
                                    type="text"
                                    value={rule.destinationBucket}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { destinationBucket: e.target.value })}
                                    className={bucketFeatureInputClass}
                                    placeholder="arn:aws:s3:::target-bucket"
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  />
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Delete marker replication
                                  <select
                                    value={rule.deleteMarkerStatus}
                                    onChange={(e) =>
                                      updateReplicationRule(rule.uiId, {
                                        deleteMarkerStatus: e.target.value as "Enabled" | "Disabled",
                                      })
                                    }
                                    className={bucketFeatureInputClass}
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  >
                                    <option value="Disabled">Disabled</option>
                                    <option value="Enabled">Enabled</option>
                                  </select>
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div>
                          <SettingsButton
                            type="button"
                            onClick={addReplicationRule}
                            disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                            variant="secondary"
                          >
                            Add rule
                          </SettingsButton>
                        </div>
                      </div>
                    ) : (
                      <div className={bucketDetailCompactStackClass}>
                        <UiTextarea label="Replication configuration (JSON)"
                          value={replicationText}
                          onChange={(e) => updateReplicationText(e.target.value)}
                          rows={14}
                          className="settings-control font-mono"
                          spellCheck={false}
                          disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                        />
                        {replicationHasUnsupportedZone && (
                          <p className="ui-caption text-rose-700 dark:text-rose-200">
                            Destination.Zone is not supported in V1 and must be removed before saving.
                          </p>
                        )}
                        <BucketFeatureJsonExample
                          show={showReplicationExample}
                          onToggle={() => setShowReplicationExample((prev) => !prev)}
                          example={defaultReplicationJsonExample}
                          onUseExample={() => updateReplicationText(defaultReplicationJsonExample)}
                          disabled={replicationBlocked || replicationNotImplemented}
                        />
                      </div>
                    )}
                  </BucketFeatureSection>
                )}
                <BucketAccessLoggingFeature
                  controller={accessLoggingController}
                  onRequestDisable={() => setPendingConfigurationDelete("access-logging")}
                />
                <BucketNotificationsFeature
                  controller={notificationsController}
                  exampleAccountId={exampleS3AccountId}
                  onRequestClear={() => setPendingConfigurationDelete("notifications")}
                />
              </div>
            ),
          },
          {
            id: "usage-stats",
            label: "Usage stats",
            content: (
              <BucketUsageStatsPanel
                snapshot={usageStatsSnapshot}
                loading={usageStatsLoading}
                error={usageStatsError}
                recalculating={usageStatsRecalculating}
                onRefresh={loadUsageStats}
                onRecalculate={recalculateUsageStats}
              />
            ),
          },
          {
            id: "metrics",
            label: "Metrics",
            disabled: !canViewBucketMetrics,
            content: (
              <div className={bucketDetailSectionStackClass}>
                <MetricsCard
                  title="Current usage and quota"
                  description="Live usage, quotas, and traffic sourced from backend metrics."
                >
                  <div className={bucketDetailTwoColumnGridClass}>
                    <UsageTile
                      label="Storage"
                      used={storageUsage.used}
                      quota={storageUsage.quota}
                      formatter={formatBytes}
                      quotaFormatter={formatBytes}
                      loading={loadingBucket}
                      emptyHint="No storage quota defined."
                    />
                    <UsageTile
                      label="Objects"
                      used={objectUsage.used}
                      quota={objectUsage.quota}
                      formatter={formatCompactNumber}
                      quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
                      loading={loadingBucket}
                      unitHint="objects"
                      emptyHint="No object quota defined."
                    />
                  </div>
                </MetricsCard>
                {!canViewLiveBucketMetrics && (
                  <PageBanner>
                    Live endpoint metrics are unavailable. BucketReef usage stats calculated from bucket listings remain
                    available in the Usage stats tab.
                  </PageBanner>
                )}
                {canViewLiveBucketMetrics &&
                  (isCephAdmin ? (
                    endpointId && bucketName ? (
                      <TrafficAnalytics scope="ceph-admin" endpointId={endpointId} bucketName={bucketName} enabled={hasCephContext} />
                    ) : (
                      <PageBanner tone="warning">Select an endpoint and a bucket to view detailed metrics.</PageBanner>
                    )
                  ) : hasAccountContext && bucketName ? (
                    <TrafficAnalytics accountId={accountIdForApi} bucketName={bucketName} enabled={hasAccountContext} />
                  ) : (
                    <PageBanner tone="warning">Select an account and a bucket to view detailed metrics.</PageBanner>
                  ))}
              </div>
            ),
          },
          ...(showQuotaTab
            ? [
                {
                  id: "ceph",
                  label: isCephAdmin ? "Ceph Admin" : "Privileged Ceph",
                  content: (
                    <div className="settings-compact">
                      <BucketFeatureSection
                        title="Quota"
                        description="Allowed bucket size and object count."
                        mode="graphical"
                        visualState={quotaCardState}
                        successMessage={quotaStatus}
                        busy={updatingQuota || loadingBucket}
                        testId="bucket-feature-quota"
                        actions={
                          quotaSectionRestricted ? (
                            <ListBadge tone="neutral">
                              Restricted
                            </ListBadge>
                          ) : canEditQuota ? (
                            <SettingsButton
                              type="submit"
                              form={quotaFormId}
                              disabled={updatingQuota || !canEditQuota || !quotaDirty}
                              variant="primary"
                              title={
                                !quotaFeatureEnabled
                                  ? "Unavailable on this endpoint"
                                  : !canEditQuota
                                    ? "Privileged Ceph access required"
                                    : undefined
                              }
                            >
                              {updatingQuota ? "Saving..." : "Save"}
                            </SettingsButton>
                          ) : null
                        }
                      >
                  {!quotaFeatureEnabled && <EndpointFeatureDisabledNotice featureLabel="Quota" />}
                  <form
                    id={quotaFormId}
                    className={`mt-2 space-y-2 ${quotaSectionRestricted ? "pointer-events-none" : ""}`}
                    onSubmit={handleUpdateQuota}
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className={bucketFeatureLabelClass}>
                        Size
                        <div className={bucketDetailInlineActionsClass}>
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            value={quotaSizeGb}
                            onChange={(e) => updateQuotaSize(e.target.value)}
                            className={cx(bucketFeatureInputClass, "flex-1")}
                            placeholder="e.g. 100"
                            disabled={!canEditQuota}
                          />
                          <select
                            value={quotaSizeUnit}
                            aria-label="Quota size unit"
                            onChange={(e) => updateQuotaSizeUnit(e.target.value as BucketQuotaUnit)}
                            className={cx(bucketFeatureInputClass, "w-20")}
                            disabled={!canEditQuota}
                          >
                            <option value="MiB">MiB</option>
                            <option value="GiB">GiB</option>
                            <option value="TiB">TiB</option>
                          </select>
                        </div>
                      </label>
                      <label className={bucketFeatureLabelClass}>
                        Object count
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={quotaObjects}
                          onChange={(e) => updateQuotaObjects(e.target.value)}
                          className={bucketFeatureInputClass}
                          placeholder="e.g. 1000000"
                          disabled={!canEditQuota}
                        />
                      </label>
                    </div>
                    {quotaError && (
                      <UiInlineMessage tone="error">{quotaError}</UiInlineMessage>
                    )}
                  </form>
                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                    {quotaFeatureEnabled
                      ? `Leave empty to remove the quota. ${canEditQuota ? "" : "(Privileged Ceph access required.)"}`
                      : "Quota management is unavailable on this endpoint."}
                  </p>
                      </BucketFeatureSection>
                    </div>
                  ),
                },
              ]
            : []),
        ].sort((a, b) => availableTabs.indexOf(a.id as BucketDetailTabId) - availableTabs.indexOf(b.id as BucketDetailTabId))}
      />

      {pendingConfigurationDelete && (
        <ConfirmActionDialog
          title={bucketConfigurationDeleteCopy[pendingConfigurationDelete].title}
          description={bucketConfigurationDeleteCopy[pendingConfigurationDelete].description}
          confirmLabel={bucketConfigurationDeleteCopy[pendingConfigurationDelete].confirmLabel}
          details={[{ label: "Bucket", value: bucketName ?? "Unknown", mono: true }]}
          impacts={bucketConfigurationDeleteCopy[pendingConfigurationDelete].impacts}
          loading={configurationDeleteLoading}
          onCancel={() => setPendingConfigurationDelete(null)}
          onConfirm={() => void confirmPendingConfigurationDelete()}
        />
      )}

    </div>
  );
}
