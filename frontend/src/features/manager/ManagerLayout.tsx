/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import AccountControlIcon from "../../components/AccountControlIcon";
import Layout from "../../components/Layout";
import PageBanner from "../../components/PageBanner";
import TopbarContextAccountSelector, {
  getContextAccessModeVisual,
} from "../../components/TopbarContextAccountSelector";
import TopbarStaticAccountControl from "../../components/TopbarStaticAccountControl";
import { useShellI18n } from "../../components/shellMessages";
import { ExecutionContextProvider, useExecutionContext } from "./ExecutionContextProvider";
import { SidebarSection } from "../../components/Sidebar";
import { formatAccountLabel } from "../shared/storageEndpointLabel";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { isFeaturePolicyAvailable } from "../../api/featurePolicies";
import type { TopbarControlDescriptor } from "../../components/topbarControlsLayout";
import {
  TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
  TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
} from "../../components/topbarControlWidths";
import {
  getManagerToolAccess,
  readStoredUser,
} from "../../utils/workspaces";
import {
  MANAGER_PAGE_CONTRACTS,
  type WorkspacePageContract,
  workspacePageLink,
} from "../../navigation/workspacePages";
import { useManagerI18n } from "./managerI18n";
import { useOpenStackProjectSelector } from "../shared/useOpenStackProjectSelector";
import OpenStackRegionControl, { OpenStackRegionIcon } from "../shared/OpenStackRegionControl";

type SessionCapabilities = {
  can_manage_iam?: boolean;
  can_manage_buckets?: boolean;
  can_view_traffic?: boolean;
};

function ManagerShell() {
  const { text } = useManagerI18n();
  const localizedPageLink = (page: WorkspacePageContract) => ({
    ...workspacePageLink(page),
    label: text(page.label),
  });
  const {
    contexts,
    refreshContexts,
    selectedContextId,
    requiresContextSelection,
    sessionAccountName,
    selectedContextKind,
    accessError,
    iamIdentity,
    accessMode,
    managerStatsEnabled,
    managerStatsMessage,
    managerBrowserEnabled,
    managerCephKeysEnabled,
    managerPrivateAccessEnabled,
    managerFeatureStates,
  } = useExecutionContext();
  const { generalSettings } = useGeneralSettings();
  const { text: shellText } = useShellI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selected = contexts.find((a) => a.id === selectedContextId);
  const storedUser = readStoredUser();
  const userCapabilities = (storedUser?.capabilities as SessionCapabilities | undefined) ?? null;
  const contextCapabilities = (selected?.capabilities as Partial<SessionCapabilities> | undefined) ?? null;
  const capabilities: SessionCapabilities = {
    can_manage_iam: contextCapabilities?.can_manage_iam ?? userCapabilities?.can_manage_iam ?? true,
    can_manage_buckets: contextCapabilities?.can_manage_buckets ?? userCapabilities?.can_manage_buckets ?? true,
    can_view_traffic: contextCapabilities?.can_view_traffic ?? userCapabilities?.can_view_traffic ?? true,
  };
  const isS3User = selectedContextKind === "s3_user";
  const canViewActivityHistory = managerFeatureStates?.activity_history?.enabled === true;
  const canManageBuckets = capabilities.can_manage_buckets !== false;
  const canAccessBucketCompare =
    canManageBuckets && isFeaturePolicyAvailable(generalSettings.manager_feature_policies.bucket_compare) && Boolean(requiresContextSelection);
  const canAccessBucketIntegrity =
    canManageBuckets && isFeaturePolicyAvailable(generalSettings.manager_feature_policies.bucket_integrity_check) && Boolean(requiresContextSelection);
  const canAccessBucketPurge =
    canManageBuckets && isFeaturePolicyAvailable(generalSettings.manager_feature_policies.bucket_purge) && Boolean(requiresContextSelection);
  const userRole = storedUser?.role ?? null;
  const managerToolAccess = getManagerToolAccess(storedUser);
  const canAccessMigration =
    isFeaturePolicyAvailable(generalSettings.manager_feature_policies.bucket_migration) &&
    Boolean(managerToolAccess?.bucket_migration) &&
    (userRole === "ui_admin" || userRole === "ui_superadmin" || userRole === "ui_user");
  const canAccessBucketCompareForUser = Boolean(managerToolAccess?.bucket_compare);
  const canAccessBucketIntegrityForUser = Boolean(managerToolAccess?.bucket_integrity_check);
  const canAccessBucketPurgeForUser = Boolean(managerToolAccess?.bucket_purge);
  const canAccessFeatureRulesForUser = Boolean(managerToolAccess?.feature_rules);
  const canShowBucketCompare = canAccessBucketCompare && canAccessBucketCompareForUser;
  const canShowBucketIntegrity = canAccessBucketIntegrity && canAccessBucketIntegrityForUser;
  const canShowBucketPurge = canAccessBucketPurge && canAccessBucketPurgeForUser;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  const iamFeatureEnabled = endpointCaps ? endpointCaps.iam !== false : true;
  const canManageIam = !isS3User && capabilities.can_manage_iam !== false && iamFeatureEnabled;
  const usageFeatureEnabled = endpointCaps ? endpointCaps.metrics !== false : true;
  const metricsFeatureEnabled = endpointCaps ? endpointCaps.usage !== false : true;
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const canViewUsageStatsMenu =
    canManageBuckets &&
    Boolean(requiresContextSelection) &&
    managerFeatureStates?.bucket_usage_stats?.enabled === true;
  const canViewMetricsMenu =
    canViewUsageStatsMenu || (Boolean(managerStatsEnabled) && (usageFeatureEnabled || metricsFeatureEnabled));
  const managerMetricsDisabledHint =
    managerStatsEnabled === null
      ? text("Metrics availability is loading for this context.")
      : managerStatsEnabled === false
        ? managerStatsMessage && managerStatsMessage.trim()
          ? managerStatsMessage
          : text("Metrics are disabled for this context.")
        : !usageFeatureEnabled && !metricsFeatureEnabled
          ? text("Metrics are unavailable for this endpoint capabilities.")
          : undefined;
  const managerBrowserAvailable = managerBrowserEnabled === true;
  const modeVisual = getContextAccessModeVisual(accessMode, shellText);
  const identityLabel = iamIdentity
    ? accessMode === "connection"
      ? text("S3 Identity: {identity}", { identity: iamIdentity })
      : text("IAM Identity: {identity}", { identity: iamIdentity })
    : selectedContextKind === "s3_user" && sessionAccountName
      ? text("S3 user account: {account}", { account: sessionAccountName })
      : null;

  const selectedLabel = selected
    ? formatAccountLabel(selected)
      : text("No context selected");

  const handleS3AccountChange = (selectedValue: string) => {
    const value = selectedValue || null;
    if (value === selectedContextId) return;
    // Commit the URL navigation before changing the executor. An eager context
    // update remounts the keyed Outlet and destroys its unsaved-changes guard.
    const nextParams = new URLSearchParams(searchParams);
    if (value) {
      nextParams.set("ctx", value);
    } else {
      nextParams.delete("ctx");
    }
    navigate({ pathname: "/manager", search: nextParams.toString() ? `?${nextParams.toString()}` : "" });
  };
  const openStackSelector = useOpenStackProjectSelector({
    enabled: requiresContextSelection && generalSettings.openstack_enabled,
    activeContext: selected,
    refreshContexts,
    onActivated: handleS3AccountChange,
  });
  const showSelector = requiresContextSelection && (
    contexts.length > 1 || openStackSelector.candidateCount > 0
  );

  const topbarControlDescriptors: TopbarControlDescriptor[] = [
    {
      id: "account",
      icon: <AccountControlIcon className="h-4 w-4" />,
      selectedLabel,
      priority: 10,
      estimatedIconWidth: 36,
      estimatedLabelWidth: TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
      renderControl: (mode) =>
        requiresContextSelection && showSelector ? (
          <TopbarContextAccountSelector
            contexts={contexts}
            additionalOptions={openStackSelector.selectorOptions}
            selectedContextId={selectedContextId}
            onContextChange={(value) => openStackSelector.handleContextChange(value, handleS3AccountChange)}
            selectedLabel={selectedLabel}
            identityLabel={identityLabel}
            widthClassName={mode === "icon" ? TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS : TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS}
            icon={<AccountControlIcon className="h-4 w-4" />}
            triggerMode={mode}
            showTriggerTags={mode !== "icon"}
            disabled={openStackSelector.busy}
          />
        ) : (
          <TopbarStaticAccountControl
            mode={mode}
            selectedLabel={selectedLabel}
            title={identityLabel ?? selectedLabel}
            icon={<AccountControlIcon className="shell-icon-muted h-4 w-4" />}
            badge={
              <span className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${modeVisual.classes}`}>
                {text(modeVisual.shortLabel)}
              </span>
            }
          />
        ),
    },
  ];
  if (openStackSelector.region.visible) {
    topbarControlDescriptors.push({
      id: "region",
      icon: <OpenStackRegionIcon className="h-4 w-4" />,
      selectedLabel: openStackSelector.region.currentRegion ?? shellText("selectRegion"),
      priority: 20,
      estimatedIconWidth: 36,
      estimatedLabelWidth: 176,
      renderControl: (mode) => (
        <OpenStackRegionControl
          mode={mode}
          currentRegion={openStackSelector.region.currentRegion}
          currentTargetId={openStackSelector.region.currentTargetId}
          options={openStackSelector.region.options}
          loading={openStackSelector.region.loading}
          onChange={openStackSelector.region.onChange}
        />
      ),
    });
  }

  const navSections: SidebarSection[] = [
    {
      links: [{ ...localizedPageLink(MANAGER_PAGE_CONTRACTS.dashboard), end: true, iconName: "home" }],
    },
  ];

  if (canManageBuckets) {
    navSections.push({
      label: text("Storage"),
      links: [
        localizedPageLink(MANAGER_PAGE_CONTRACTS.buckets),
        ...(generalSettings.browser_enabled && generalSettings.browser_manager_enabled && managerBrowserAvailable
          ? [localizedPageLink(MANAGER_PAGE_CONTRACTS.browser)]
          : []),
      ],
    });
    if (snsFeatureEnabled) {
      navSections.push({
        label: text("Events"),
        links: [localizedPageLink(MANAGER_PAGE_CONTRACTS.topics)],
      });
    }
  }

  if (canManageIam) {
    navSections.push({
      label: text("IAM"),
      links: [
        localizedPageLink(MANAGER_PAGE_CONTRACTS.users),
        localizedPageLink(MANAGER_PAGE_CONTRACTS.groups),
        localizedPageLink(MANAGER_PAGE_CONTRACTS.roles),
        localizedPageLink(MANAGER_PAGE_CONTRACTS.policies),
      ],
    });
  }

  if (isS3User && (managerCephKeysEnabled || managerPrivateAccessEnabled)) {
    navSections.push({
      label: text("Ceph"),
      links: [localizedPageLink(MANAGER_PAGE_CONTRACTS["ceph-keys"])],
    });
  }

  if (canManageBuckets) {
    const toolsLinks: SidebarSection["links"] = [];
    if (canAccessFeatureRulesForUser) {
      toolsLinks.push({ ...localizedPageLink(MANAGER_PAGE_CONTRACTS["feature-rules"]), iconName: "rules" });
    }
    if (canShowBucketCompare) {
      toolsLinks.push({ ...localizedPageLink(MANAGER_PAGE_CONTRACTS.compare), iconName: "compare" });
    }
    if (canShowBucketIntegrity) {
      toolsLinks.push({ ...localizedPageLink(MANAGER_PAGE_CONTRACTS.integrity), iconName: "integrity" });
    }
    if (canShowBucketPurge) {
      toolsLinks.push({ ...localizedPageLink(MANAGER_PAGE_CONTRACTS.purge), iconName: "purge" });
    }
    if (canAccessMigration) {
      toolsLinks.push({ ...localizedPageLink(MANAGER_PAGE_CONTRACTS.migration), iconName: "migration" });
    }
    if (toolsLinks.length > 0) {
      navSections.push({
        label: text("Tools"),
        links: toolsLinks,
      });
    }
  }

  navSections.push({
    label: text("Monitoring"),
    links: [
      ...(canViewActivityHistory ? [localizedPageLink(MANAGER_PAGE_CONTRACTS.activity)] : []),
      {
        ...localizedPageLink(MANAGER_PAGE_CONTRACTS.metrics),
        disabled: !canViewMetricsMenu,
        disabledHint: !canViewMetricsMenu ? managerMetricsDisabledHint : undefined,
      },
    ],
  });

  return (
    <>
      <Layout
        navSections={navSections}
        headerTitle="Manager"
        hideHeader
        sidebarTitle="MANAGER"
        topbarControlDescriptors={topbarControlDescriptors}
      >
        <>
          {accessError && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 shadow-sm dark:border-amber-900/40 dark:bg-amber-900/30 dark:text-amber-100">
              {text("Access denied for /manager. Check your account permissions or contact an administrator.")}
            </div>
          )}
          {openStackSelector.error ? (
            <PageBanner tone="warning" className="mb-4">{openStackSelector.error}</PageBanner>
          ) : null}
          <Outlet key={`${selectedContextId ?? "session"}:${accessMode ?? "default"}`} />
        </>
      </Layout>
      {openStackSelector.dialog}
    </>
  );
}

export default function ManagerLayout() {
  return (
    <ExecutionContextProvider>
      <ManagerShell />
    </ExecutionContextProvider>
  );
}
