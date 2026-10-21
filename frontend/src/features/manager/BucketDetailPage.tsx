/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState, useCallback, useId, useRef } from "react";
import { useParams } from "react-router-dom";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { uiDataTableClass, uiTableContainerClass } from "../../components/ui/styles";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageHeader from "../../components/PageHeader";
import { ListActionButton } from "../../components/list/ListControls";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { settingsLabels } from "../../components/settings/settingsLabels";
import { useI18n } from "../../i18n";
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
  BucketAclFeature,
  BucketAccessLoggingFeature,
  BucketCorsFeature,
  BucketEncryptionFeature,
  BucketLifecycleFeature,
  BucketNotificationsFeature,
  BucketObjectLockFeature,
  BucketTagsFeature,
  BucketVersioningFeature,
  BucketWebsiteFeature,
  BucketPolicyFeature,
  BucketPublicAccessFeature,
  BucketQuotaFeature,
  BucketReplicationFeature,
  BucketFeatureSuggestionsProvider,
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
  buildBucketDetailBreadcrumbs,
  resolveBucketDetailSurface,
  resolveBucketDetailTabs,
  type BucketDetailTabId,
  type BucketDetailMode,
} from "./bucketDetail/bucketDetailSurface";
import {
  bucketConfigurationDeleteCopy,
  type BucketConfigurationDeleteKind,
} from "./bucketDetail/bucketDetailConstants";
import { formatBytes } from "../../utils/format";
import type { UiRole } from "../../api/users";
import BucketFeatureGrid from "./bucketDetail/BucketFeatureGrid";
import { useManagerI18n } from "./managerI18n";

function getUserRole(): UiRole | null {
  return readStoredUser()?.role ?? null;
}

type PropertySummary = {
  label: string;
  state: string;
  tone: PropertySummaryTone;
};

const bucketDetailHintClass = "settings-description";
const bucketDetailTwoColumnGridClass = "grid gap-3 md:grid-cols-2";

const bucketDetailDividerClass =
  "divide-y divide-slate-200 dark:divide-slate-800";
const bucketDetailSectionStackClass = "space-y-4";

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
    s3AccountContext.contextIdForApi,
    s3AccountContext.selectedContextId ?? null,
    s3AccountContext.requiresContextSelection
      ? null
      : (s3AccountContext.contexts[0]?.id ?? null),
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
      title={busy ? t({ en: "Operation in progress", fr: "Opération en cours", de: "Vorgang läuft", zh: "操作正在进行" }) : labels.discardTitle}
      description={busy ? t({
        en: "Wait for the operation to finish before leaving this page.",
        fr: "Attendez la fin de l’opération avant de quitter cette page.",
        de: "Warten Sie, bis der Vorgang abgeschlossen ist, bevor Sie diese Seite verlassen.",
        zh: "请等待操作完成后再离开此页面。",
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
  const { text, intlLocale } = useManagerI18n();
  const { generalSettings } = useGeneralSettings();
  const tabsId = useId();
  const bucketName = bucketNameOverride ?? routeBucketName;
  const isCephAdmin = mode === "ceph-admin";
  const {
    contexts,
    selectedContextId,
    contextIdForApi,
    requiresContextSelection,
    managerBucketQuotaEnabled,
    managerStatsEnabled,
    managerStatsMessage,
    managerBrowserEnabled,
  } = s3AccountContext;
  const { selectedEndpointId, selectedEndpoint } = cephAdminEndpoint;
  const [pendingConfigurationDelete, setPendingConfigurationDelete] = useState<BucketConfigurationDeleteKind | null>(null);

  const selectedS3Account = useMemo(() => {
    if (isCephAdmin) return null;
    if (accountIdOverride) {
      return contexts.find((account) => account.id === accountIdOverride) ?? null;
    }
    if (selectedContextId) {
      return contexts.find((account) => account.id === selectedContextId) ?? null;
    }
    if (!requiresContextSelection && contexts.length > 0) {
      return contexts[0];
    }
    return null;
  }, [accountIdOverride, contexts, isCephAdmin, requiresContextSelection, selectedContextId]);
  const isCephEndpoint = isCephAdmin || selectedS3Account?.endpoint_provider === "ceph";
  const accountId = accountIdOverride ?? contextIdForApi;
  const hasAccountContext = !requiresContextSelection || accountId !== null;
  const endpointId = selectedEndpointId ?? null;
  const hasCephContext = Boolean(endpointId);
  const hasContext = isCephAdmin ? hasCephContext : hasAccountContext;
  const managerBrowserAvailable =
    generalSettings.browser_enabled &&
    generalSettings.browser_manager_enabled &&
    managerBrowserEnabled === true;
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
    return resolveBucketDetailTabs({ showObjectsTab });
  }, [showObjectsTab]);

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
  const lifecycleController = useBucketLifecycleController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    dirty: lifecycleDirty,
    error: lifecycleError,
    hasRules: hasLifecycleRules,
    load: loadLifecycle,
    loading: lifecycleLoading,
  } = lifecycleController;
  const {
    cancelRecalculation: cancelUsageStatsRecalculation,
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
  const replicationController = useBucketReplicationController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext && isCephEndpoint && replicationFeatureEnabled,
    endpointId,
  });
  const {
    configured: replicationConfigured,
    dirty: replicationDirty,
    error: replicationError,
    load: loadReplication,
    loading: replicationLoading,
  } = replicationController;
  const usageFeatureEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.metrics ?? true;
    }
    return Boolean(managerStatsEnabled) && (selectedS3Account?.storage_endpoint_capabilities?.metrics ?? true);
  }, [isCephAdmin, managerStatsEnabled, selectedEndpoint, selectedS3Account]);
  const canViewLiveBucketMetrics = Boolean(isCephEndpoint && usageFeatureEnabled);
  const userRole = getUserRole();
  const isAdmin = isAdminLikeRole(userRole);
  const canEditQuota =
    quotaFeatureEnabled &&
    ((isCephAdmin && isAdmin && hasCephContext) || (!isCephAdmin && hasAccountContext));
  const versioningDisableBlocked = objectLockActive && versioningIsEnabled;

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

  const quotaController = useBucketQuotaController({
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
  const {
    configured: quotaConfigured,
    dirty: quotaDirty,
  } = quotaController;

  const mutations = {
    versioning: versioningController.saving,
    objectLock: objectLockController.saving,
    lifecycle: lifecycleController.saving,
    policy: policyController.saving || policyController.deleting,
    acl: bucketAclController.saving,
    replication: replicationController.saving,
    encryption: encryptionController.saving,
    publicAccess: publicAccessController.saving,
    website: websiteController.saving || websiteController.clearing,
    accessLogging: accessLoggingController.saving || accessLoggingController.clearing,
    notifications: notificationsController.saving,
    tags: bucketTagsController.saving || bucketTagsController.clearing,
    quota: quotaController.saving,
  };
  const drafts = {
    versioning: versioningDirty,
    objectLock: objectLockDirty,
    policy: policyDirty,
    acl: aclDirty,
    publicAccess: publicAccessDirty,
    website: websiteDirty,
    accessLogging: accessLoggingDirty,
    tags: tagsDirty,
    quota: quotaDirty,
  };
  // Modal feature editors own their unsaved-changes prompt inside
  // SettingsFormDialog. Keep their drafts protected from reloads without
  // registering a second page-level prompt through onDirtyChange.
  const protectedDrafts = {
    ...drafts,
    lifecycle: lifecycleDirty,
    cors: corsDirty,
    encryption: encryptionDirty,
    notifications: notificationsDirty,
    replication: replicationDirty,
  };
  // Tab changes and Refresh may reload clean sections only. Reading the latest
  // flags through a ref avoids triggering the load effect on every draft edit.
  const protectedMutations = {
    ...mutations,
    cors: corsController.saving,
  };
  const protectedFeatures = useRef({ drafts: protectedDrafts, mutations: protectedMutations });
  protectedFeatures.current = { drafts: protectedDrafts, mutations: protectedMutations };

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
    if (activeTab === "objects") {
      await refreshObjects();
      return;
    }
    if (activeTab === "properties") {
      await Promise.all([
        loadClean("versioning", loadVersioning), loadClean("objectLock", loadObjectLock), loadClean("tags", loadBucketTags),
        loadClean("encryption", loadEncryption), loadClean("website", loadWebsite), loadClean("accessLogging", loadAccessLogging),
        loadClean("notifications", loadNotifications),
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
    if (activeTab === "data-management") {
      await Promise.all([
        loadClean("lifecycle", loadLifecycle), loadClean("replication", loadReplication),
      ]);
      return;
    }
    if (activeTab === "usage-metrics") {
      await Promise.all([
        loadClean("quota", refreshBucketMeta), loadUsageStats(),
      ]);
    }
  }, [
    activeTab,
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
    if (activeTab === "objects") {
      return objectsLoading;
    }
    if (activeTab === "properties") {
      return versioningLoading || objectLockLoading || bucketTagsLoading || encryptionLoading || websiteLoading || accessLoggingLoading || notificationsLoading;
    }
    if (activeTab === "permissions") {
      return publicAccessLoading || bucketAclLoading || policyLoading || corsLoading;
    }
    if (activeTab === "data-management") {
      return lifecycleLoading || replicationLoading;
    }
    if (activeTab === "usage-metrics") {
      return loadingBucket || usageStatsLoading || usageStatsRecalculating;
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

  const canRefreshActiveTab = hasContext;

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
      { label: text("Versioning"), state: text(versioningState), tone: versioningTone },
      { label: text("Object Lock"), state: text(objectLockState), tone: objectLockTone },
      { label: text("Block public access"), state: text(publicAccessState), tone: publicAccessTone },
      { label: text("Lifecycle rules"), state: text(lifecycleState), tone: lifecycleTone },
    ];
    if (staticWebsiteEnabled) {
      summary.push({ label: text("Static website"), state: text(websiteState), tone: websiteTone });
    }
    if (quotaFeatureEnabled) {
      summary.push({ label: text("Quota"), state: text(quotaState), tone: quotaTone });
    }
    summary.push({ label: text("Bucket policy"), state: text(policyState), tone: policyTone });
    summary.push({ label: text("CORS"), state: text(corsState), tone: corsTone });
    if (sseFeatureEnabled) {
      summary.push({ label: text("Server-side encryption"), state: text(encryptionState), tone: encryptionTone });
    }
    summary.push({ label: text("Access logging"), state: text(accessLoggingState), tone: accessLoggingTone });
    if (snsFeatureEnabled) {
      summary.push({ label: text("Notifications"), state: text(notificationsState), tone: notificationsTone });
    }
    if (replicationFeatureEnabled) {
      summary.push({ label: text("Replication"), state: text(replicationState), tone: replicationTone });
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
    text,
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
      if (pendingConfigurationDelete === "tags") await bucketTagsController.clear();
      if (pendingConfigurationDelete === "website") await websiteController.clear();
      if (pendingConfigurationDelete === "policy") await policyController.remove();
      if (pendingConfigurationDelete === "access-logging") await accessLoggingController.clear();
    } finally {
      setPendingConfigurationDelete(null);
    }
  };

  const configurationDeleteLoading =
    pendingConfigurationDelete === "tags"
          ? bucketTagsController.clearing
          : pendingConfigurationDelete === "website"
                ? websiteController.clearing
                : pendingConfigurationDelete === "policy"
                  ? policyController.deleting
                  : pendingConfigurationDelete === "access-logging"
                    ? accessLoggingController.clearing
                    : false;

  return (
    <BucketFeatureSuggestionsProvider
      accountId={accountId}
      bucketName={bucketName}
      cephAdmin={isCephAdmin}
      enabled={hasContext}
      endpointId={endpointId}
      topicsEnabled={snsFeatureEnabled}
    >
      <div className={bucketDetailSectionStackClass}>
      {!embedded && (
        <PageHeader
          title={bucketName ?? text("Bucket")}
          description={
            bucketError ||
            (isCephAdmin
              ? text("Bucket configuration and permissions (Admin Ops + S3).")
              : text("Bucket overview, objects, configuration, data management, usage and metrics."))
          }
          breadcrumbs={breadcrumbs}
          actions={[
            onBackToBuckets
              ? { label: text("← Back to buckets"), onClick: onBackToBuckets, variant: "ghost" }
              : { label: text("← Back to buckets"), to: basePath, variant: "ghost" },
          ]}
        />
      )}

      {isCephAdmin && !endpointId && (
        <PageBanner tone="warning">{text("Select a Ceph endpoint before managing this bucket.")}</PageBanner>
      )}

      {bucketError && <PageBanner tone="error">{text(bucketError)}</PageBanner>}

      <PageTabs
        variant="line"
        ariaLabel={text("Bucket sections")}
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
            {text(activeTabLoading ? "Loading..." : "Refresh")}
          </SettingsButton>
        }
        tabs={[
          {
            id: "overview",
            label: text("Overview"),
            content: (
              <section className="space-y-4 px-1 py-2">
                <header className={bucketDetailTightStackClass}>
                  <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">
                    {bucketName ? text("Bucket {name}", { name: bucketName }) : text("Bucket overview")}
                  </h3>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1">
                    <div className={bucketDetailHintClass}>
                      <dt className="inline">{text("Owner:")} </dt>
                      <dd className="inline font-semibold text-slate-700 dark:text-slate-200">{bucketOwner ?? text(loadingBucket || bucketAclLoading ? "Loading..." : "Unknown")}</dd>
                    </div>
                    <div className={bucketDetailHintClass}>
                      <dt className="inline">{text("Created:")} </dt>
                      <dd className="inline font-semibold text-slate-700 dark:text-slate-200">{loadingBucket ? text("Loading...") : formatLocalDateTime(bucket?.creation_date)}</dd>
                    </div>
                  </dl>
                </header>
                <div className={bucketDetailTwoColumnGridClass}>
                  <UsageTile
                    label={text("Storage")}
                    used={storageUsage.used}
                    quota={storageUsage.quota}
                    formatter={formatBytes}
                    quotaFormatter={formatBytes}
                    loading={loadingBucket}
                    emptyHint={text("No storage quota configured.")}
                  />
                  <UsageTile
                    label={text("Objects")}
                    used={objectUsage.used}
                    quota={objectUsage.quota}
                    formatter={formatCompactNumber}
                    quotaFormatter={(value) => (value != null ? value.toLocaleString(intlLocale) : "-")}
                    loading={loadingBucket}
                    unitHint={text("objects")}
                    emptyHint={text("No object quota configured.")}
                  />
                </div>
                <div className="border-t border-[color:var(--ui-border-soft)] pt-4">
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">{text("Bucket properties")}</p>
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
                  label: text("Objects"),
                  content: (
                    <SplitView
                      left={
                  <div className="p-3 space-y-2">
                    <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">{text("Prefixes")}</p>
                    <div className={bucketDetailTightStackClass}>
                      <ListActionButton
                        variant="ghost"
                        active={currentPrefix === ""}
                        aria-pressed={currentPrefix === ""}
                        className="w-full !justify-between text-left"
                        onClick={() => openObjectsPrefix("")}
                      >
                        <span>{text("(root)")}</span>
                      </ListActionButton>
                      {parentPrefix !== "" && (
                        <ListActionButton
                          variant="ghost"
                          className="w-full !justify-between text-left"
                          onClick={() => openObjectsPrefix(parentPrefix)}
                        >
                          <span>{text("⬆️ Up")}</span>
                          <span className={bucketDetailHintClass}>{parentPrefix || "/"}</span>
                        </ListActionButton>
                      )}
                      {prefixes.map((prefix) => {
                        const isActive = prefix === currentPrefix;
                        const displayName = prefix.replace(currentPrefix, "") || prefix;
                        return (
                          <ListActionButton
                            key={prefix}
                            variant="ghost"
                            active={isActive}
                            aria-pressed={isActive}
                            className="w-full !justify-between text-left"
                            onClick={() => openObjectsPrefix(prefix)}
                          >
                            <span>{displayName}</span>
                          </ListActionButton>
                        );
                      })}
                    </div>
                  </div>
                }
                right={
                  <div className="space-y-3 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className={bucketDetailTightStackClass}>
                        <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">{text("Path")}</p>
                        <div className="ui-caption text-slate-500 dark:text-slate-300">
                          {bucketName}/{currentPrefix || "(root)"}
                        </div>
                        <div className={bucketDetailHintClass}>
                          {isCephAdmin
                            ? text("Read-only preview using the selected endpoint's Ceph Admin credentials.")
                            : managerBrowserAvailable
                              ? text("Read-only preview. Use the main Browser page for object operations.")
                              : text("Read-only preview. Object operations are unavailable because Manager Browser is disabled.")}
                        </div>
                      </div>
                      <div className={bucketDetailWrapActionsClass}>
                        <ListActionButton
                          onClick={() => void refreshObjects()}
                          loading={objectsLoading}
                        >
                          {text("Refresh")}
                        </ListActionButton>
                      </div>
                    </div>
                    {objectsError && (
                      <UiInlineMessage tone="error">{text(objectsError)}</UiInlineMessage>
                    )}

                    <div className={uiTableContainerClass}>
                      <table className={uiDataTableClass}>
                        <thead>
                          <tr>
                            <th className="text-left">
                              {text("Name")}
                            </th>
                            <th className="text-left">
                              {text("Size")}
                            </th>
                            <th className="text-left">
                              {text("Last modified")}
                            </th>
                            <th className="text-left">
                              {text("Storage class")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className={bucketDetailDividerClass}>
                          {objectsLoading && (
                            <tr>
                              <td colSpan={4} className="ui-table-secondary">
                                {text("Loading objects...")}
                              </td>
                            </tr>
                          )}
                          {!objectsLoading && objectRows.length === 0 && (
                            <tr>
                              <td colSpan={4} className="ui-table-secondary">
                                {text("No objects in this prefix.")}
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
                                    {row.object.last_modified ? new Date(row.object.last_modified).toLocaleString(intlLocale) : "-"}
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
            label: text("Properties"),
            content: (
              <BucketFeatureGrid
                title={text("Bucket properties")}
                description={text("Configured features are highlighted. Changes remain scoped to each S3 feature.")}
                summary={text("{count} configured", { count: [
                  versioningController.isEnabled,
                  objectLockController.persistentlyEnabled,
                  encryptionController.configured,
                  bucketTagsController.configured,
                  websiteController.configured,
                  accessLoggingController.configured,
                  notificationsController.configured,
                ].filter(Boolean).length })}
              >
                  <BucketVersioningFeature
                    controller={versioningController}
                    disableBlocked={versioningDisableBlocked}
                  />
                  <BucketObjectLockFeature
                    controller={objectLockController}
                    onEnableVersioningDraft={() => updateVersioningDraft(true)}
                  />
                  <BucketEncryptionFeature
                    controller={encryptionController}
                    enabled={sseFeatureEnabled}
                  />
                  <BucketTagsFeature
                    controller={bucketTagsController}
                    onRequestClear={() => setPendingConfigurationDelete("tags")}
                  />
                  <BucketWebsiteFeature
                    blocked={!staticWebsiteEnabled}
                    bucketName={bucketName}
                    controller={websiteController}
                    onRequestDelete={() => setPendingConfigurationDelete("website")}
                  />
                  <BucketAccessLoggingFeature
                    controller={accessLoggingController}
                    onRequestDisable={() => setPendingConfigurationDelete("access-logging")}
                  />
                  <BucketNotificationsFeature controller={notificationsController} />
              </BucketFeatureGrid>
            ),
          },
          {
            id: "permissions",
            label: text("Permissions"),
            content: (
              <BucketFeatureGrid
                title={text("Bucket permissions")}
                description={text("Configured protections and access rules are highlighted. Common list actions stay on this page.")}
                summary={text("{count} configured", { count: [
                  publicAccessController.fullyEnabled || publicAccessController.partiallyEnabled,
                  Boolean(bucketAclController.acl),
                  policyController.configured,
                  corsController.configured,
                ].filter(Boolean).length })}
              >
                <BucketPublicAccessFeature controller={publicAccessController} />

                <BucketAclFeature controller={bucketAclController} />

                <BucketPolicyFeature
                  bucketName={bucketName}
                  controller={policyController}
                  onRequestDelete={() => setPendingConfigurationDelete("policy")}
                />

                <BucketCorsFeature controller={corsController} />
              </BucketFeatureGrid>
            ),
          },
          {
            id: "data-management",
            label: text("Data management"),
            content: (
              <BucketFeatureGrid
                title={text("Bucket data management")}
                description={text("Configure lifecycle and replication rules that control how bucket data is retained and copied.")}
                summary={text("{count} configured", { count: [
                  lifecycleController.hasRules,
                  isCephEndpoint && replicationController.configured,
                ].filter(Boolean).length })}
              >
                <BucketLifecycleFeature controller={lifecycleController} />
                {isCephEndpoint && (
                  <BucketReplicationFeature
                    blocked={!replicationFeatureEnabled}
                    controller={replicationController}
                  />
                )}
              </BucketFeatureGrid>
            ),
          },
          {
            id: "usage-metrics",
            label: text("Usage & Metrics"),
            content: (
              <div className={bucketDetailSectionStackClass}>
                {showQuotaTab && (
                  <div className="settings-compact">
                    <BucketQuotaFeature
                      controller={quotaController}
                      editable={canEditQuota}
                      featureEnabled={quotaFeatureEnabled}
                      loading={loadingBucket}
                    />
                  </div>
                )}
                <BucketUsageStatsPanel
                  title={text("Inventory statistics")}
                  snapshot={usageStatsSnapshot}
                  loading={usageStatsLoading}
                  error={usageStatsError}
                  recalculating={usageStatsRecalculating}
                  onCancel={cancelUsageStatsRecalculation}
                  onRefresh={loadUsageStats}
                  onRecalculate={recalculateUsageStats}
                  text={text}
                />
                <MetricsCard
                  title={text("Current usage and quota")}
                  description={text("Live usage, quotas, and traffic sourced from backend metrics.")}
                >
                  <div className={bucketDetailTwoColumnGridClass}>
                    <UsageTile
                      label={text("Storage")}
                      used={storageUsage.used}
                      quota={storageUsage.quota}
                      formatter={formatBytes}
                      quotaFormatter={formatBytes}
                      loading={loadingBucket}
                      emptyHint={text("No storage quota defined.")}
                    />
                    <UsageTile
                      label={text("Objects")}
                      used={objectUsage.used}
                      quota={objectUsage.quota}
                      formatter={formatCompactNumber}
                      quotaFormatter={(value) => (value != null ? value.toLocaleString(intlLocale) : "-")}
                      loading={loadingBucket}
                      unitHint={text("objects")}
                      emptyHint={text("No object quota defined.")}
                    />
                  </div>
                </MetricsCard>
                {!canViewLiveBucketMetrics && (
                  <PageBanner>
                    {!isCephAdmin && managerStatsMessage
                      ? managerStatsMessage
                      : text("Live endpoint metrics are unavailable. BucketReef usage stats calculated from bucket listings remain available above.")}
                  </PageBanner>
                )}
                {canViewLiveBucketMetrics &&
                  (isCephAdmin ? (
                    endpointId && bucketName ? (
                      <TrafficAnalytics scope="ceph-admin" endpointId={endpointId} bucketName={bucketName} enabled={hasCephContext} />
                    ) : (
                      <PageBanner tone="warning">{text("Select an endpoint and a bucket to view detailed metrics.")}</PageBanner>
                    )
                  ) : hasAccountContext && bucketName ? (
                    <TrafficAnalytics accountId={contextIdForApi} bucketName={bucketName} enabled={hasAccountContext} />
                  ) : (
                    <PageBanner tone="warning">{text("Select an account and a bucket to view detailed metrics.")}</PageBanner>
                  ))}
              </div>
            ),
          },
        ].sort((a, b) => availableTabs.indexOf(a.id as BucketDetailTabId) - availableTabs.indexOf(b.id as BucketDetailTabId))}
      />

      {pendingConfigurationDelete && (
        <ConfirmActionDialog
          title={text(bucketConfigurationDeleteCopy[pendingConfigurationDelete].title)}
          description={text(bucketConfigurationDeleteCopy[pendingConfigurationDelete].description)}
          confirmLabel={text(bucketConfigurationDeleteCopy[pendingConfigurationDelete].confirmLabel)}
          details={[{ label: text("Bucket"), value: bucketName ?? text("Unknown"), mono: true }]}
          impacts={bucketConfigurationDeleteCopy[pendingConfigurationDelete].impacts.map((impact) => text(impact))}
          loading={configurationDeleteLoading}
          onCancel={() => setPendingConfigurationDelete(null)}
          onConfirm={() => void confirmPendingConfigurationDelete()}
        />
      )}

      </div>
    </BucketFeatureSuggestionsProvider>
  );
}
