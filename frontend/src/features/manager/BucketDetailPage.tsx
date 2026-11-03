/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState, useCallback, useId, useRef } from "react";
import { useParams } from "react-router-dom";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageHeader from "../../components/PageHeader";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { settingsLabels } from "../../components/settings/settingsLabels";
import { useI18n } from "../../i18n";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import InlineSummary from "../../components/InlineSummary";
import { MetricsCard } from "../../components/MetricsCard";
import UsageTile from "../../components/UsageTile";
import { formatCompactNumber } from "../../utils/format";
import { formatLocalDateTime } from "../../utils/dateTime";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { useExecutionContext } from "./ExecutionContextProvider";
import TrafficAnalytics from "./TrafficAnalytics";
import BucketUsageStatsPanel from "../shared/BucketUsageStatsPanel";
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
  resolveBucketDetailFeatureAvailability,
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
import BucketObjectsPreview from "./bucketDetail/BucketObjectsPreview";
import {
  buildBucketOverviewSummary,
  type BucketOverviewSummaryItem,
} from "./bucketDetail/bucketOverviewSummary";
import { useManagerI18n } from "./managerI18n";
import { useBrowserBucketDetailsScope } from "../shared/BucketDetailsScope";
import { useBucketUsageLimits } from "./bucketDetail/useBucketUsageLimits";
import type { BucketUsageLimitSource } from "./bucketDetail/bucketUsageLimit";

function getUserRole(): UiRole | null {
  return readStoredUser()?.role ?? null;
}

const bucketDetailTwoColumnGridClass = "grid gap-3 md:grid-cols-2";

const bucketDetailSectionStackClass = "space-y-4";

function overviewInlineItems(items: BucketOverviewSummaryItem[]) {
  return items.map((item) => ({
    label: item.label,
    value: item.value,
    tone: item.state === "active"
      ? "primary" as const
      : item.state === "warning" || item.state === "unavailable"
        ? "warning" as const
        : undefined,
  }));
}

type BucketDetailPageProps = {
  mode?: BucketDetailMode;
  bucketNameOverride?: string;
  cephAdminTenantOverride?: string | null;
  contextIdOverride?: string | null;
  hideQuotaTab?: boolean;
  embedded?: boolean;
  hideObjectsTab?: boolean;
  hideUsageMetricsTab?: boolean;
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
  executionContext: ReturnType<typeof useExecutionContext>;
};

export function BucketDetailContent(props: BucketDetailPageProps) {
  const [activeTab, setActiveTab] = useState<BucketDetailTabId>("overview");
  const params = useParams<{ bucketName: string }>();
  const executionContext = useExecutionContext();
  const cephAdminEndpoint = useCephAdminEndpoint();
  const bucketName = props.bucketNameOverride ?? params.bucketName;
  const contextKey = JSON.stringify([
    props.mode ?? "manager",
    bucketName ?? null,
    props.cephAdminTenantOverride ?? null,
    props.contextIdOverride ?? null,
    executionContext.contextIdForApi,
    executionContext.selectedContextId ?? null,
    executionContext.requiresContextSelection
      ? null
      : (executionContext.contexts[0]?.id ?? null),
    executionContext.accessMode,
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
      executionContext={executionContext}
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
  cephAdminTenantOverride = null,
  contextIdOverride = null,
  hideQuotaTab = false,
  embedded = false,
  hideObjectsTab = false,
  hideUsageMetricsTab = false,
  bucketListPathOverride,
  onBackToBuckets,
  onDirtyChange,
  onBusyChange,
  activeTab,
  cephAdminEndpoint,
  onActiveTabChange,
  routeBucketName,
  executionContext,
}: BucketDetailPageContentProps) {
  const { text, intlLocale } = useManagerI18n();
  const { generalSettings } = useGeneralSettings();
  const browserBucketDetailsScope = useBrowserBucketDetailsScope();
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
    selectedStorageEndpointCapabilities,
  } = executionContext;
  const { selectedEndpointId, selectedEndpoint } = cephAdminEndpoint;
  const [pendingConfigurationDelete, setPendingConfigurationDelete] = useState<BucketConfigurationDeleteKind | null>(null);

  const selectedContext = useMemo(() => {
    if (isCephAdmin) return null;
    if (contextIdOverride) {
      return contexts.find((context) => context.id === contextIdOverride) ?? null;
    }
    if (selectedContextId) {
      return contexts.find((context) => context.id === selectedContextId) ?? null;
    }
    if (!requiresContextSelection && contexts.length > 0) {
      return contexts[0];
    }
    return null;
  }, [contextIdOverride, contexts, isCephAdmin, requiresContextSelection, selectedContextId]);
  const isCephEndpoint = isCephAdmin || selectedContext?.endpoint_provider === "ceph";
  const contextId = contextIdOverride ?? contextIdForApi;
  const hasManagerExecutionContext = !requiresContextSelection || contextId !== null;
  const endpointId = selectedEndpointId ?? null;
  const hasCephContext = Boolean(endpointId);
  const hasContext = isCephAdmin ? hasCephContext : hasManagerExecutionContext;
  const effectiveStorageEndpointCapabilities = isCephAdmin
    ? selectedEndpoint?.capabilities
    : (selectedStorageEndpointCapabilities ?? selectedContext?.storage_endpoint_capabilities);
  const featureAvailability = resolveBucketDetailFeatureAvailability({
    mode,
    isCephEndpoint,
    capabilities: effectiveStorageEndpointCapabilities,
    managerStatsEnabled,
    managerBucketQuotaEnabled,
  });
  const managerBrowserAvailable =
    generalSettings.browser_enabled &&
    generalSettings.browser_manager_enabled &&
    managerBrowserEnabled === true;
  const versioningController = useBucketVersioningController({
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
    enabled: hasContext,
    endpointId,
  });
  const {
    configured: notificationsConfigured,
    dirty: notificationsDirty,
    error: notificationsError,
    load: loadNotifications,
    loading: notificationsLoading,
    topicCount: notificationTopicCount,
  } = notificationsController;
  const publicAccessController = useBucketPublicAccessController({
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
    enabled: hasContext,
    endpointId,
  });
  const {
    dirty: tagsDirty,
    load: loadBucketTags,
    loading: bucketTagsLoading,
  } = bucketTagsController;
  const quotaFeatureEnabled = featureAvailability.quota;
  const showQuotaTab = !hideQuotaTab && (isCephAdmin || Boolean(quotaFeatureEnabled && hasManagerExecutionContext));
  const showObjectsTab = !hideObjectsTab;
  const availableTabs = useMemo(() => {
    return resolveBucketDetailTabs({ showObjectsTab }).filter((tab) => !hideUsageMetricsTab || tab !== "usage-metrics");
  }, [showObjectsTab, hideUsageMetricsTab]);

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      onActiveTabChange(availableTabs[0] ?? "overview");
    }
  }, [activeTab, availableTabs, onActiveTabChange]);
  const staticWebsiteEnabled = featureAvailability.staticWebsite;
  const websiteController = useBucketWebsiteController({
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
  const sseFeatureEnabled = featureAvailability.sse;
  const encryptionController = useBucketEncryptionController({
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
    enabled: hasContext,
    endpointId,
  });
  const {
    dirty: lifecycleDirty,
    error: lifecycleError,
    hasRules: hasLifecycleRules,
    load: loadLifecycle,
    loading: lifecycleLoading,
    ruleCount: lifecycleRuleCount,
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
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
    enabled: hasContext && !hideUsageMetricsTab,
    endpointId,
  });
  const objectsController = useBucketObjectsController({
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
    enabled: hasContext && showObjectsTab,
    endpointId,
  });
  const {
    loading: objectsLoading,
    refresh: refreshObjects,
  } = objectsController;
  const snsFeatureEnabled = featureAvailability.sns;
  const replicationFeatureEnabled = featureAvailability.replication;
  const replicationController = useBucketReplicationController({
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
    enabled: hasContext && isCephEndpoint && replicationFeatureEnabled,
    endpointId,
  });
  const {
    configured: replicationConfigured,
    dirty: replicationDirty,
    error: replicationError,
    load: loadReplication,
    loading: replicationLoading,
    ruleCount: replicationRuleCount,
  } = replicationController;
  const usageFeatureEnabled = featureAvailability.usage;
  const canViewLiveBucketMetrics = featureAvailability.liveMetrics;
  const userRole = getUserRole();
  const isAdmin = isAdminLikeRole(userRole);
  const canEditQuota =
    quotaFeatureEnabled &&
    ((isCephAdmin && isAdmin && hasCephContext) || (!isCephAdmin && hasManagerExecutionContext));
  const versioningDisableBlocked = objectLockActive && versioningIsEnabled;

  const {
    bucket,
    error: bucketError,
    loading: loadingBucket,
    refresh: refreshBucketMeta,
  } = useBucketMetadataController({
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
    enabled: hasContext,
    endpointId,
    withStats: usageFeatureEnabled,
  });

  const quotaController = useBucketQuotaController({
    contextId,
    bucketName,
    cephAdmin: isCephAdmin,
    cephAdminTenant: cephAdminTenantOverride,
    editable: canEditQuota,
    enabled: quotaFeatureEnabled,
    endpointId,
    maxObjects: bucket?.quota_max_objects,
    maxSizeBytes: bucket?.quota_max_size_bytes,
    onSaved: refreshBucketMeta,
  });
  const {
    dirty: quotaDirty,
  } = quotaController;

  const mutations = {
    versioning: versioningController.saving,
    objectLock: objectLockController.saving,
    lifecycle: lifecycleController.saving,
    policy: policyController.saving,
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
        publicAccessLoading ||
        websiteLoading ||
        accessLoggingLoading ||
        notificationsLoading
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

  const usageLimits = useBucketUsageLimits({
    bucket,
    cephAdmin: isCephAdmin,
    browserScope: browserBucketDetailsScope,
    managerContextId: contextId,
    managerEnabled: hasContext && usageFeatureEnabled,
  });
  const usageLimitLabel = useCallback((source: BucketUsageLimitSource) => {
    if (source === "bucket") return text("Bucket quota");
    if (source === "account") return text("Account quota");
    if (source === "user") return text("User quota");
    if (source === "owner") return text("Owner quota");
    return undefined;
  }, [text]);
  const usageOwnerSource = usageLimits.ownerSource;
  const unavailableOwnerUsageLabel = useCallback(() => {
    if (usageOwnerSource === "user") return text("User quota usage unavailable.");
    if (usageOwnerSource === "owner") return text("Owner quota usage unavailable.");
    return text("Account quota usage unavailable.");
  }, [text, usageOwnerSource]);
  const storageUsage = useMemo(
    () => ({
      used: bucket?.used_bytes ?? null,
      quota: usageLimits.storage.limit,
      displayQuota: usageLimits.storage.configuredQuota,
      ratio: usageLimits.storage.ratio,
      limitLabel: usageLimitLabel(usageLimits.storage.source),
      limitWarning: usageLimits.storage.ownerConstraintUnavailable
        ? unavailableOwnerUsageLabel()
        : undefined,
    }),
    [bucket?.used_bytes, unavailableOwnerUsageLabel, usageLimitLabel, usageLimits.storage]
  );

  const objectUsage = useMemo(
    () => ({
      used: bucket?.object_count ?? null,
      quota: usageLimits.objects.limit,
      displayQuota: usageLimits.objects.configuredQuota,
      ratio: usageLimits.objects.ratio,
      limitLabel: usageLimitLabel(usageLimits.objects.source),
      limitWarning: usageLimits.objects.ownerConstraintUnavailable
        ? unavailableOwnerUsageLabel()
        : undefined,
    }),
    [bucket?.object_count, unavailableOwnerUsageLabel, usageLimitLabel, usageLimits.objects]
  );
  const bucketOwner = useMemo(() => {
    const ownerFromBucket = (bucket?.owner ?? "").trim();
    if (ownerFromBucket) return ownerFromBucket;
    const ownerFromAcl = (bucketAcl?.owner ?? "").trim();
    if (ownerFromAcl) return ownerFromAcl;
    return null;
  }, [bucket?.owner, bucketAcl?.owner]);
  const bucketTenant = (bucket?.tenant ?? "").trim() || null;

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

  const overviewSummary = useMemo(() => {
    return buildBucketOverviewSummary({
      accessLogging: {
        configured: accessLoggingConfigured,
        loading: accessLoggingLoading,
        hasError: Boolean(accessLoggingError),
      },
      cors: {
        configured: corsConfigured,
        loading: corsLoading,
        hasError: Boolean(corsError),
      },
      encryption: {
        configured: encryptionConfigured,
        loading: encryptionLoading,
        hasError: Boolean(encryptionError),
      },
      lifecycle: {
        configured: hasLifecycleRules,
        loading: lifecycleLoading,
        hasError: Boolean(lifecycleError),
        count: lifecycleRuleCount,
      },
      notifications: {
        configured: notificationsConfigured,
        loading: notificationsLoading,
        hasError: Boolean(notificationsError),
        count: notificationTopicCount,
      },
      notificationsEnabled: snsFeatureEnabled,
      objectLock: {
        configured: objectLockPersistentlyEnabled,
        loading: objectLockLoading,
        hasError: Boolean(objectLockLoadError),
      },
      policy: {
        configured: policyConfigured,
        loading: policyLoading,
        hasError: Boolean(policyError),
      },
      publicAccess: {
        blocked: publicAccessBlockEnabled,
        partial: publicAccessBlockPartial,
        loading: publicAccessLoading,
        hasError: Boolean(publicAccessError),
      },
      replication: {
        configured: replicationConfigured,
        loading: replicationLoading,
        hasError: Boolean(replicationError),
        count: replicationRuleCount,
        enabled: replicationFeatureEnabled,
      },
      serverSideEncryptionEnabled: sseFeatureEnabled,
      staticWebsite: {
        configured: websiteConfigured,
        loading: websiteLoading,
        hasError: Boolean(websiteError),
        enabled: staticWebsiteEnabled,
      },
      versioning: {
        enabled: versioningIsEnabled,
        loading: versioningLoading,
        hasError: Boolean(versioningLoadError),
        status: versioningStatus,
      },
    }, text);
  }, [
    accessLoggingConfigured,
    accessLoggingError,
    accessLoggingLoading,
    encryptionConfigured,
    encryptionError,
    encryptionLoading,
    hasLifecycleRules,
    lifecycleRuleCount,
    corsConfigured,
    corsError,
    corsLoading,
    lifecycleError,
    lifecycleLoading,
    notificationsConfigured,
    notificationsError,
    notificationsLoading,
    notificationTopicCount,
    objectLockLoadError,
    objectLockLoading,
    objectLockPersistentlyEnabled,
    policyConfigured,
    policyError,
    policyLoading,
    publicAccessBlockEnabled,
    publicAccessBlockPartial,
    publicAccessError,
    publicAccessLoading,
    sseFeatureEnabled,
    versioningLoadError,
    versioningIsEnabled,
    versioningLoading,
    versioningStatus,
    replicationConfigured,
    replicationError,
    replicationFeatureEnabled,
    replicationLoading,
    replicationRuleCount,
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
                : pendingConfigurationDelete === "access-logging"
                  ? accessLoggingController.clearing
                  : false;

  return (
    <BucketFeatureSuggestionsProvider
      contextId={contextId}
      bucketName={bucketName}
      cephAdmin={isCephAdmin}
      cephAdminTenant={cephAdminTenantOverride}
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
              <div className="settings-compact settings-stack px-1 py-2">
                <SettingsSection
                  title={text("Bucket details")}
                  description={text("Basic ownership and creation information for this bucket.")}
                  presentation="compact"
                >
                  <InlineSummary items={[
                    {
                      label: text("Owner"),
                      value: bucketOwner ?? text(loadingBucket || bucketAclLoading ? "Loading..." : "Unknown"),
                    },
                    ...(bucketTenant
                      ? [{
                          label: text("Tenant"),
                          value: bucketTenant,
                        }]
                      : []),
                    {
                      label: text("Created"),
                      value: loadingBucket
                        ? text("Loading...")
                        : bucket?.creation_date
                          ? formatLocalDateTime(bucket.creation_date)
                          : text("Unavailable"),
                    },
                  ]} />
                </SettingsSection>
                <SettingsSection
                  title={text("Usage")}
                  description={text("Current bucket consumption.")}
                  presentation="compact"
                >
                  <div className={bucketDetailTwoColumnGridClass}>
                    <UsageTile
                      label={text("Storage")}
                      used={storageUsage.used}
                      quota={storageUsage.quota}
                      displayQuota={storageUsage.displayQuota}
                      formatter={formatBytes}
                      quotaFormatter={formatBytes}
                      loading={loadingBucket}
                      emptyHint={text("No storage quota configured.")}
                      usageRatio={storageUsage.ratio}
                      limitLabel={storageUsage.limitLabel}
                      limitWarning={storageUsage.limitWarning}
                    />
                    <UsageTile
                      label={text("Objects")}
                      used={objectUsage.used}
                      quota={objectUsage.quota}
                      displayQuota={objectUsage.displayQuota}
                      formatter={formatCompactNumber}
                      quotaFormatter={(value) => (value != null ? value.toLocaleString(intlLocale) : "-")}
                      loading={loadingBucket}
                      unitHint={text("objects")}
                      emptyHint={text("No object quota configured.")}
                      usageRatio={objectUsage.ratio}
                      limitLabel={objectUsage.limitLabel}
                      limitWarning={objectUsage.limitWarning}
                    />
                  </div>
                </SettingsSection>
                <SettingsSection
                  title={text("Data protection")}
                  description={text("Protection and durability settings.")}
                  presentation="compact"
                >
                  <InlineSummary items={overviewInlineItems(overviewSummary.dataProtection)} />
                </SettingsSection>
                <SettingsSection
                  title={text("Access & exposure")}
                  description={text("External access controls.")}
                  presentation="compact"
                >
                  <InlineSummary items={overviewInlineItems(overviewSummary.accessExposure)} />
                </SettingsSection>
                <SettingsSection
                  title={text("Data management")}
                  description={text("Automation and data handling.")}
                  presentation="compact"
                >
                  <InlineSummary items={overviewInlineItems(overviewSummary.dataManagement)} />
                </SettingsSection>
              </div>
            ),
          },
          ...(showObjectsTab
            ? [
                {
                  id: "objects",
                  label: text("Objects"),
                  content: (
                    <BucketObjectsPreview
                      bucketName={bucketName}
                      controller={objectsController}
                      isCephAdmin={isCephAdmin}
                      managerBrowserAvailable={managerBrowserAvailable}
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

                <BucketPolicyFeature controller={policyController} />

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
                <MetricsCard
                  title={text("Current usage and quota")}
                  description={text("Live usage, quotas, and traffic sourced from backend metrics.")}
                >
                  <div className={bucketDetailTwoColumnGridClass}>
                    <UsageTile
                      label={text("Storage")}
                      used={storageUsage.used}
                      quota={storageUsage.quota}
                      displayQuota={storageUsage.displayQuota}
                      formatter={formatBytes}
                      quotaFormatter={formatBytes}
                      loading={loadingBucket}
                      emptyHint={text("No storage quota defined.")}
                      usageRatio={storageUsage.ratio}
                      limitLabel={storageUsage.limitLabel}
                      limitWarning={storageUsage.limitWarning}
                    />
                    <UsageTile
                      label={text("Objects")}
                      used={objectUsage.used}
                      quota={objectUsage.quota}
                      displayQuota={objectUsage.displayQuota}
                      formatter={formatCompactNumber}
                      quotaFormatter={(value) => (value != null ? value.toLocaleString(intlLocale) : "-")}
                      loading={loadingBucket}
                      unitHint={text("objects")}
                      emptyHint={text("No object quota defined.")}
                      usageRatio={objectUsage.ratio}
                      limitLabel={objectUsage.limitLabel}
                      limitWarning={objectUsage.limitWarning}
                    />
                  </div>
                </MetricsCard>
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
                  ) : hasManagerExecutionContext && bucketName ? (
                    <TrafficAnalytics contextId={contextIdForApi} bucketName={bucketName} enabled={hasManagerExecutionContext} />
                  ) : (
                    <PageBanner tone="warning">{text("Select a context and a bucket to view detailed metrics.")}</PageBanner>
                  ))}
                <BucketUsageStatsPanel
                  title={text("Inventory statistics")}
                  snapshot={usageStatsSnapshot}
                  loading={usageStatsLoading}
                  error={usageStatsError}
                  recalculating={usageStatsRecalculating}
                  onCancel={cancelUsageStatsRecalculation}
                  onRecalculate={recalculateUsageStats}
                  text={text}
                />
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
