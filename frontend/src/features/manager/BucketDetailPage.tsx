/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState, useCallback, useId, useRef } from "react";
import { useParams } from "react-router-dom";
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
    return selectedS3Account?.storage_endpoint_capabilities?.metrics ?? true;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const canViewBucketMetrics = hasContext;
  const canViewLiveBucketMetrics = Boolean(isCephEndpoint && usageFeatureEnabled);

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
                      <ListActionButton
                        variant="ghost"
                        active={currentPrefix === ""}
                        aria-pressed={currentPrefix === ""}
                        className="w-full !justify-between text-left"
                        onClick={() => openObjectsPrefix("")}
                      >
                        <span>(root)</span>
                      </ListActionButton>
                      {parentPrefix !== "" && (
                        <ListActionButton
                          variant="ghost"
                          className="w-full !justify-between text-left"
                          onClick={() => openObjectsPrefix(parentPrefix)}
                        >
                          <span>⬆️ Up</span>
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
                        <ListActionButton
                          onClick={() => void refreshObjects()}
                          loading={objectsLoading}
                        >
                          Refresh
                        </ListActionButton>
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
              <BucketFeatureGrid
                title="Bucket properties"
                description="Configured features are highlighted. Changes remain scoped to each S3 feature."
                summary={`${[
                  versioningController.isEnabled,
                  objectLockController.persistentlyEnabled,
                  encryptionController.configured,
                  lifecycleController.hasRules,
                  bucketTagsController.configured,
                ].filter(Boolean).length} configured`}
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
                  <BucketLifecycleFeature controller={lifecycleController} />
              </BucketFeatureGrid>
            ),
          },
          {
            id: "permissions",
            label: "Permissions",
            content: (
              <BucketFeatureGrid
                title="Bucket permissions"
                description="Configured protections and access rules are highlighted. Common list actions stay on this page."
                summary={`${[
                  publicAccessController.fullyEnabled || publicAccessController.partiallyEnabled,
                  Boolean(bucketAclController.acl),
                  policyController.configured,
                  corsController.configured,
                ].filter(Boolean).length} configured`}
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
            id: "advanced",
            label: "Advanced",
            content: (
              <BucketFeatureGrid
                title="Advanced bucket features"
                description="Configured integrations are highlighted; collections expose their common row actions directly."
                summary={`${[
                  websiteController.configured,
                  isCephEndpoint && replicationController.configured,
                  accessLoggingController.configured,
                  notificationsController.configured,
                ].filter(Boolean).length} configured`}
              >
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
                {isCephEndpoint && (
                  <BucketReplicationFeature
                    blocked={!replicationFeatureEnabled}
                    controller={replicationController}
                  />
                )}
                <BucketNotificationsFeature
                  controller={notificationsController}
                />
              </BucketFeatureGrid>
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
                onCancel={cancelUsageStatsRecalculation}
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
                      <BucketQuotaFeature
                        controller={quotaController}
                        editable={canEditQuota}
                        featureEnabled={quotaFeatureEnabled}
                        loading={loadingBucket}
                      />
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
