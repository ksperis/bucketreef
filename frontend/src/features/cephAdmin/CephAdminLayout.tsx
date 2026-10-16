/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ErrorState from "../../components/errors/ErrorState";
import { Outlet, useLocation } from "react-router-dom";
import Layout from "../../components/Layout";
import CephStorageIcon from "../../components/CephStorageIcon";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import { TopbarStaticControl } from "../../components/TopbarControlTrigger";
import TopbarDropdownSelect, { TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import { SidebarSection } from "../../components/Sidebar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { CephAdminEndpointProvider, useCephAdminEndpoint } from "./CephAdminEndpointContext";
import type { TopbarControlDescriptor } from "../../components/topbarControlsLayout";
import {
  TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
  TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_VALUE_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
} from "../../components/topbarControlWidths";
import { useSelectorTagsPreference } from "../../utils/selectorTagsPreference";
import { buildUiTagItems, filterSelectorVisibleUiTags } from "../../utils/uiTags";
import {
  CEPH_ADMIN_PAGE_CONTRACTS,
  workspacePageLink,
} from "../../navigation/workspacePages";
import { useCephAdminI18n } from "./cephAdminI18n";

function CephAdminShell() {
  const { text: surfaceText } = useCephAdminI18n();
  const location = useLocation();
  const { generalSettings } = useGeneralSettings();
  const {
    endpoints,
    selectedEndpointId,
    setSelectedEndpointId,
    selectedEndpoint,
    selectedEndpointAccess,
    selectedEndpointAccessLoading,
    selectedEndpointAccessError,
    retrySelectedEndpointAccess,
    retryEndpoints,
    loading,
    error,
  } = useCephAdminEndpoint();
  const showSelectorTags = useSelectorTagsPreference();
  const showSelector = endpoints.length > 1;
  const selectorEnabled = endpoints.length > 0;
  const endpointSelected = selectorEnabled && selectedEndpointId != null;
  const endpointUnavailable = selectedEndpointAccess?.availability_status === "unavailable";
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
  const endpointDependentRoute = normalizedPath !== "/ceph-admin" && normalizedPath !== "/ceph-admin/profile";
  const usageFeatureEnabled = selectedEndpoint?.capabilities?.metrics !== false;
  const trafficFeatureEnabled = selectedEndpoint?.capabilities?.usage !== false;
  const canAdmin = endpointSelected && !selectedEndpointAccessLoading && Boolean(selectedEndpointAccess?.can_admin);
  const canViewRgwMetrics =
    endpointSelected &&
    !selectedEndpointAccessLoading &&
    Boolean(selectedEndpointAccess?.can_metrics) &&
    (usageFeatureEnabled || trafficFeatureEnabled);
  const canUsageStats = Boolean(canAdmin);
  const canMetrics = canViewRgwMetrics || canUsageStats;
  const canAccounts =
    endpointSelected &&
    !selectedEndpointAccessLoading &&
    canAdmin &&
    Boolean(selectedEndpointAccess?.can_accounts);
  const canBrowser =
    endpointSelected &&
    !selectedEndpointAccessLoading &&
    canAdmin &&
    generalSettings.browser_enabled &&
    generalSettings.browser_ceph_admin_enabled;
  const onCephAdminBrowserRoute = normalizedPath === "/ceph-admin/browser";
  const browserLinkDisabled = !canBrowser || !onCephAdminBrowserRoute;
  const resolveCommonEndpointHint = () => {
    if (!endpointSelected) return surfaceText("Select a Ceph endpoint first.");
    if (selectedEndpointAccessLoading) return surfaceText("Endpoint access is loading.");
    if (endpointUnavailable) return surfaceText("The selected endpoint is currently unavailable.");
    return null;
  };
  const metricsDisabledHint = (() => {
    const commonHint = resolveCommonEndpointHint();
    if (commonHint) return commonHint;
    if (!selectedEndpointAccess?.can_metrics && !canUsageStats) return surfaceText("Metrics access is not granted for this endpoint.");
    if (!usageFeatureEnabled && !trafficFeatureEnabled && !canUsageStats)
      return surfaceText("Metrics are unavailable for this endpoint capabilities.");
    return undefined;
  })();
  const accountsDisabledHint = (() => {
    const commonHint = resolveCommonEndpointHint();
    if (commonHint) return commonHint;
    if (!selectedEndpointAccess?.can_admin) return surfaceText("Administrator access is required for RGW account management.");
    if (!selectedEndpointAccess?.can_accounts) return surfaceText("RGW account management is not granted for this endpoint.");
    return undefined;
  })();
  const endpointAdminDisabledHint = (() => {
    const commonHint = resolveCommonEndpointHint();
    if (commonHint) return commonHint;
    if (!selectedEndpointAccess?.can_admin) return surfaceText("Administrator access is required for this endpoint.");
    return undefined;
  })();
  const browserDisabledHint = (() => {
    const commonHint = resolveCommonEndpointHint();
    if (commonHint) return commonHint;
    if (!selectedEndpointAccess?.can_admin) return surfaceText("Administrator access is required for this endpoint.");
    if (!generalSettings.browser_enabled) return surfaceText("Browser feature is disabled in General settings.");
    if (!generalSettings.browser_ceph_admin_enabled) return surfaceText("Ceph Admin Browser is disabled in Browser settings.");
    if (!onCephAdminBrowserRoute) return surfaceText("Open the bucket from the Buckets list.");
    return undefined;
  })();
  const adminWarning = endpointSelected && !selectedEndpointAccessLoading ? selectedEndpointAccess?.admin_warning ?? null : null;
  const accountsWarning = endpointSelected && !selectedEndpointAccessLoading ? selectedEndpointAccess?.accounts_warning ?? null : null;

  const handleChange = (selectedValue: string) => {
    const next = Number(selectedValue);
    if (!Number.isFinite(next) || next <= 0) return;
    if (next === selectedEndpointId) return;
    setSelectedEndpointId(next);
  };

  const navSections: SidebarSection[] = [
    {
      links: [{ ...workspacePageLink(CEPH_ADMIN_PAGE_CONTRACTS.dashboard), label: surfaceText(CEPH_ADMIN_PAGE_CONTRACTS.dashboard.label), end: true, iconName: "home" }],
    },
    {
      label: surfaceText("Monitoring"),
      links: [
        {
          ...workspacePageLink(CEPH_ADMIN_PAGE_CONTRACTS.metrics),
          label: surfaceText(CEPH_ADMIN_PAGE_CONTRACTS.metrics.label),
          disabled: !canMetrics,
          disabledHint: !canMetrics ? metricsDisabledHint : undefined,
        },
      ],
    },
    {
      label: "CEPH S3",
      links: [
        {
          ...workspacePageLink(CEPH_ADMIN_PAGE_CONTRACTS.accounts),
          label: surfaceText(CEPH_ADMIN_PAGE_CONTRACTS.accounts.label),
          disabled: !canAccounts,
          disabledHint: !canAccounts ? accountsDisabledHint : undefined,
        },
        {
          ...workspacePageLink(CEPH_ADMIN_PAGE_CONTRACTS.users),
          label: surfaceText(CEPH_ADMIN_PAGE_CONTRACTS.users.label),
          disabled: !canAdmin,
          disabledHint: !canAdmin ? endpointAdminDisabledHint : undefined,
        },
        {
          ...workspacePageLink(CEPH_ADMIN_PAGE_CONTRACTS.buckets),
          label: surfaceText(CEPH_ADMIN_PAGE_CONTRACTS.buckets.label),
          disabled: !canAdmin,
          disabledHint: !canAdmin ? endpointAdminDisabledHint : undefined,
        },
      ],
    },
    {
      label: surfaceText("Data"),
      links: [
        {
          ...workspacePageLink(CEPH_ADMIN_PAGE_CONTRACTS.browser),
          label: surfaceText(CEPH_ADMIN_PAGE_CONTRACTS.browser.label),
          disabled: browserLinkDisabled,
          disabledHint: browserDisabledHint,
        },
      ],
    },
  ];

  const endpointOptions: TopbarDropdownOption[] = endpoints.map((endpoint) => {
    const selectorEndpointTags = filterSelectorVisibleUiTags(endpoint.tags);
    return {
      value: String(endpoint.id),
      label: `${endpoint.name}${endpoint.is_default ? ` · ${surfaceText("Default")}` : ""}`,
      description: endpoint.endpoint_url,
      title: endpoint.endpoint_url,
      icon: <EndpointItemIcon className="h-4 w-4" />,
      inlineAddon:
        showSelectorTags && selectorEndpointTags.length > 0 ? (
          <UiTagBadgeList
            items={buildUiTagItems(undefined, selectorEndpointTags)}
            layout="inline-compact"
            maxVisible={4}
            className="max-w-full"
          />
        ) : undefined,
      triggerAddon:
        showSelectorTags && selectorEndpointTags.length > 0 ? (
          <UiTagBadgeList
            items={buildUiTagItems(undefined, selectorEndpointTags)}
            layout="inline-compact"
            maxVisible={3}
            className="max-w-full"
          />
        ) : undefined,
    };
  });
  const selectedEndpointLabel = selectedEndpoint
    ? selectedEndpoint.name
    : loading
      ? surfaceText("Loading...")
      : surfaceText("No endpoint selected");

  const renderStaticEndpointPill = (mode: "icon" | "icon_label") => {
    if (mode === "icon") {
      return (
        <TopbarStaticControl
          mode="icon"
          label={surfaceText("Endpoint")}
          value={selectedEndpointLabel}
          icon={<CephStorageIcon className="h-4 w-4" />}
          ariaLabel={`${surfaceText("Endpoint")} ${selectedEndpointLabel}`}
          title={selectedEndpoint?.endpoint_url ?? selectedEndpointLabel}
        />
      );
    }
    return (
      <TopbarStaticControl
        mode="icon_label"
        label={surfaceText("Endpoint")}
        value={selectedEndpointLabel}
        icon={<CephStorageIcon className="h-4 w-4" />}
        ariaLabel={`${surfaceText("Endpoint")} ${selectedEndpointLabel}`}
        title={selectedEndpoint?.endpoint_url ?? selectedEndpointLabel}
        className={TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS}
        valueClassName={TOPBAR_CONTEXT_SELECTOR_VALUE_WIDTH_CLASS}
      />
    );
  };

  const topbarControlDescriptors: TopbarControlDescriptor[] = [
    {
      id: "endpoint",
      icon: <CephStorageIcon className="h-4 w-4" />,
      selectedLabel: selectedEndpointLabel,
      priority: 20,
      estimatedIconWidth: 36,
      estimatedLabelWidth: TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
      renderControl: (mode) =>
        showSelector ? (
          <TopbarDropdownSelect
            value={selectedEndpointId ? String(selectedEndpointId) : ""}
            options={endpointOptions}
            onChange={handleChange}
            ariaLabel={surfaceText("Select Ceph endpoint")}
            triggerLabel={surfaceText("Endpoint")}
            title={selectedEndpoint?.endpoint_url ?? undefined}
            widthClassName={mode === "icon" ? TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS : TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS}
            menuMinWidthClassName="min-w-[24rem]"
            icon={<CephStorageIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />}
            disabled={!selectorEnabled || loading}
            triggerMode={mode}
          />
        ) : (
          renderStaticEndpointPill(mode)
        ),
    },
  ];

  return (
    <Layout
      navSections={navSections}
      headerTitle="Ceph Admin"
      sidebarTitle="CEPH ADMIN"
      hideHeader
      topbarControlDescriptors={topbarControlDescriptors}
    >
      <>
        {endpointDependentRoute && error ? (
          <ErrorState
            kind="unavailable"
            error={error}
            title={surfaceText("Unable to load Ceph endpoints")}
            description={error}
            onRetry={retryEndpoints}
            secondaryAction={{ label: surfaceText("Back to dashboard"), to: "/ceph-admin" }}
          />
        ) : endpointDependentRoute && loading ? (
          <PageEmptyState
            eyebrow={surfaceText("Loading")}
            title={surfaceText("Loading Ceph endpoints")}
            description={surfaceText("Ceph Admin operations will open as soon as the available endpoints are loaded.")}
          />
        ) : endpointDependentRoute && endpoints.length === 0 ? (
          <PageEmptyState
            eyebrow={surfaceText("Unavailable")}
            title={surfaceText("No Ceph endpoint available")}
            description={surfaceText("Ceph Admin requires at least one Ceph endpoint before cluster-level administration can be used.")}
            tone="warning"
          />
        ) : endpointDependentRoute && !endpointSelected ? (
          <PageEmptyState
            eyebrow={surfaceText("Loading")}
            title={surfaceText("Selecting Ceph endpoint")}
            description={surfaceText("Ceph Admin is selecting the endpoint to use for this operation.")}
          />
        ) : endpointDependentRoute && selectedEndpointAccessError ? (
          <ErrorState
            kind="unavailable"
            title={surfaceText("Endpoint availability could not be checked")}
            description={surfaceText("The selected endpoint cannot be checked right now. Use the menu to continue elsewhere, or try again.")}
            primaryAction={{ label: surfaceText("Retry"), onClick: retrySelectedEndpointAccess }}
            secondaryAction={{ label: surfaceText("Back to dashboard"), to: "/ceph-admin" }}
          />
        ) : endpointDependentRoute && selectedEndpointAccessLoading ? (
          <PageEmptyState
            eyebrow={surfaceText("Checking")}
            title={surfaceText("Checking endpoint availability")}
            description={surfaceText("Ceph Admin operations will open as soon as the selected endpoint responds.")}
          />
        ) : endpointDependentRoute && endpointUnavailable ? (
          <ErrorState
            kind="unavailable"
            title={surfaceText("Storage endpoint unavailable")}
            description={surfaceText("The selected storage endpoint is not responding. Use the menu to continue elsewhere, or try again.")}
            primaryAction={{ label: surfaceText("Retry"), onClick: retrySelectedEndpointAccess }}
            secondaryAction={{ label: surfaceText("Back to dashboard"), to: "/ceph-admin" }}
          />
        ) : (
          <>
            {adminWarning && (
          <PageBanner tone="warning" className="mb-4">
            {adminWarning}
          </PageBanner>
            )}
            {accountsWarning && (
              <PageBanner tone="warning" className="mb-4">
                {accountsWarning}
              </PageBanner>
            )}
            <Outlet />
          </>
        )}
      </>
    </Layout>
  );
}

export default function CephAdminLayout() {
  return (
    <CephAdminEndpointProvider>
      <CephAdminShell />
    </CephAdminEndpointProvider>
  );
}

function EndpointItemIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
