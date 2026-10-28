/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import AccountControlIcon from "../../components/AccountControlIcon";
import Layout from "../../components/Layout";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import type { SidebarBodyRenderArgs, SidebarLink } from "../../components/Sidebar";
import TopbarContextAccountSelector, {
  type ContextAccessMode,
} from "../../components/TopbarContextAccountSelector";
import TopbarStaticAccountControl from "../../components/TopbarStaticAccountControl";
import { BrowserContextProvider, useBrowserContext } from "./BrowserContext";
import { fetchManagerContext } from "../../api/managerContext";
import { formatAccountLabel } from "../shared/storageEndpointLabel";
import type { TopbarControlDescriptor } from "../../components/topbarControlsLayout";
import {
  TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
  TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
} from "../../components/topbarControlWidths";
import {
  canAccessPrivateConnectionsSection,
  readStoredUser,
} from "../../utils/workspaces";
import { useBrowserI18n } from "./browserI18n";
import { useOpenStackProjectSelector } from "../shared/useOpenStackProjectSelector";
import OpenStackRegionControl, { OpenStackRegionIcon } from "../shared/OpenStackRegionControl";

export type BrowserSidebarBodyRenderer = (args: SidebarBodyRenderArgs) => ReactNode;

type BrowserSidebarSlotContextValue = {
  setSidebarBody: (renderer: BrowserSidebarBodyRenderer | null) => void;
};

const BrowserSidebarSlotContext = createContext<BrowserSidebarSlotContextValue>({
  setSidebarBody: () => undefined,
});

const BROWSER_FALLBACK_NAV_LINKS: SidebarLink[] = [
  { to: "/browser", label: "Browser", end: true, iconName: "folder" },
];

export function useBrowserSidebarSlot(): BrowserSidebarSlotContextValue {
  return useContext(BrowserSidebarSlotContext);
}

function BrowserShell() {
  const { text } = useBrowserI18n();
  const location = useLocation();
  const {
    contexts,
    contextsLoaded,
    refreshContexts,
    selectedContextId,
    requiresContextSelection,
    sessionAccountName,
    accessError,
  } = useBrowserContext();
  const [iamIdentity, setIamIdentity] = useState<string | null>(null);
  const [identityAccessMode, setIdentityAccessMode] = useState<ContextAccessMode>(null);
  const [sidebarBody, setSidebarBodyState] = useState<BrowserSidebarBodyRenderer | null>(null);
  const canManagePrivateConnections = useMemo(
    () => canAccessPrivateConnectionsSection(readStoredUser()),
    [],
  );
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
  const isBrowserExplorerRoute = normalizedPath === "/browser";
  const selected = contexts.find((a) => a.id === selectedContextId);
  const canLoadManagerIdentity = !(
    selected?.kind === "connection" && selected.capabilities?.can_manage_iam === false
  );
  const identityLabel = iamIdentity
    ? identityAccessMode === "connection"
      ? text("S3 Identity: {identity}", { identity: iamIdentity })
      : text("IAM Identity: {identity}", { identity: iamIdentity })
    : null;
  const selectedLabel = selected
    ? formatAccountLabel(selected)
    : requiresContextSelection
      ? text("No account selected")
      : sessionAccountName || text("S3 session");

  useEffect(() => {
    if (!isBrowserExplorerRoute) {
      setIamIdentity(null);
      setIdentityAccessMode(null);
      return;
    }
    if (!requiresContextSelection) {
      setIamIdentity(null);
      setIdentityAccessMode("session");
      return;
    }
    if (!selectedContextId) {
      setIamIdentity(null);
      setIdentityAccessMode(null);
      return;
    }
    if (!canLoadManagerIdentity) {
      setIamIdentity(null);
      setIdentityAccessMode(null);
      return;
    }
    let isMounted = true;
    fetchManagerContext(selectedContextId)
      .then((data) => {
        if (!isMounted) return;
        setIamIdentity(data.iam_identity ?? null);
        setIdentityAccessMode(data.access_mode);
      })
      .catch(() => {
        if (!isMounted) return;
        setIamIdentity(null);
        setIdentityAccessMode(null);
      });
    return () => {
      isMounted = false;
    };
  }, [canLoadManagerIdentity, isBrowserExplorerRoute, requiresContextSelection, selectedContextId]);

  const [searchParams, setSearchParams] = useSearchParams();
  const handleS3AccountChange = (selectedValue: string) => {
    const value = selectedValue || null;
    if (value === selectedContextId) return;
    const nextParams = new URLSearchParams(searchParams);
    if (value) nextParams.set("ctx", value);
    else nextParams.delete("ctx");
    // Keep the mounted draft and executor until route guards accept the change.
    setSearchParams(nextParams, { replace: true });
  };
  const openStackSelector = useOpenStackProjectSelector({
    enabled: requiresContextSelection && isBrowserExplorerRoute,
    activeContext: selected,
    refreshContexts,
    onActivated: handleS3AccountChange,
  });
  const showSelector = requiresContextSelection && (
    contexts.length > 1 || openStackSelector.candidateCount > 0
  );
  const hasSelectableContext = contexts.length > 0 || openStackSelector.candidateCount > 0;
  const setSidebarBody = useCallback((renderer: BrowserSidebarBodyRenderer | null) => {
    setSidebarBodyState(() => renderer);
  }, []);
  const sidebarSlotValue = useMemo(
    () => ({ setSidebarBody }),
    [setSidebarBody],
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
        showSelector ? (
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
          />
        ) : (
          <TopbarStaticAccountControl
            mode={mode}
            selectedLabel={selectedLabel}
            title={identityLabel ?? undefined}
            icon={<AccountControlIcon className="h-4 w-4" />}
            muted={!selected}
          />
        ),
    },
  ];
  if (openStackSelector.region.visible && openStackSelector.region.currentRegion) {
    topbarControlDescriptors.push({
      id: "region",
      icon: <OpenStackRegionIcon className="h-4 w-4" />,
      selectedLabel: openStackSelector.region.currentRegion,
      priority: 20,
      estimatedIconWidth: 36,
      estimatedLabelWidth: 176,
      renderControl: (mode) => (
        <OpenStackRegionControl
          mode={mode}
          currentRegion={openStackSelector.region.currentRegion!}
          currentTargetId={openStackSelector.region.currentTargetId}
          options={openStackSelector.region.options}
          loading={openStackSelector.region.loading}
          onChange={openStackSelector.region.onChange}
        />
      ),
    });
  }

  return (
    <BrowserSidebarSlotContext.Provider value={sidebarSlotValue}>
      <Layout
        navLinks={BROWSER_FALLBACK_NAV_LINKS.map((link) => ({ ...link, label: text(link.label) }))}
        headerTitle={text("Browser")}
        sidebarTitle={text("Browser")}
        hideHeader
        hideSidebar={isBrowserExplorerRoute && !sidebarBody}
        renderSidebarBody={sidebarBody ?? undefined}
        topbarControlDescriptors={isBrowserExplorerRoute ? topbarControlDescriptors : undefined}
        mainClassName={isBrowserExplorerRoute ? "pb-0" : undefined}
        disableMainScroll={isBrowserExplorerRoute}
      >
        {isBrowserExplorerRoute && accessError ? <PageBanner tone="warning">{accessError}</PageBanner> : null}
        {isBrowserExplorerRoute && requiresContextSelection && contextsLoaded && openStackSelector.candidatesLoaded && !selectedContextId ? (
          <>
            <h1 className="sr-only">{text("Browser")}</h1>
            <PageEmptyState
              title={hasSelectableContext ? text("Select a Browser context") : text("No private Browser connection")}
              description={
                hasSelectableContext
                  ? text("Choose a Browser context explicitly to start browsing.")
                  : canManagePrivateConnections
                    ? text("Accounts, RGW users and Admin S3 connections are unavailable in Browser. Create a private connection with a dedicated access key.")
                    : text("Accounts, RGW users and Admin S3 connections are unavailable in Browser. Ask your administrator to allow manual private connections before adding a dedicated access key.")
              }
              primaryAction={canManagePrivateConnections ? {
                label: text("Manage private connections"),
                to: "/browser/profile?tab=connections",
              } : undefined}
              tone="warning"
              className="h-full"
            />
          </>
        ) : (
          <Outlet key={`${selectedContextId ?? "session"}`} />
        )}
      </Layout>
      {openStackSelector.dialog}
    </BrowserSidebarSlotContext.Provider>
  );
}

export default function BrowserLayout() {
  return (
    <BrowserContextProvider>
      <BrowserShell />
    </BrowserContextProvider>
  );
}
