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
  const location = useLocation();
  const {
    contexts,
    contextsLoaded,
    selectedContextId,
    requiresContextSelection,
    sessionAccountName,
    accessError,
  } = useBrowserContext();
  const [iamIdentity, setIamIdentity] = useState<string | null>(null);
  const [identityAccessMode, setIdentityAccessMode] = useState<ContextAccessMode>(null);
  const [sidebarBody, setSidebarBodyState] = useState<BrowserSidebarBodyRenderer | null>(null);
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
  const isBrowserExplorerRoute = normalizedPath === "/browser";
  const selected = contexts.find((a) => a.id === selectedContextId);
  const showSelector = requiresContextSelection && contexts.length > 1;
  const identityLabel = iamIdentity
    ? identityAccessMode === "connection"
      ? `S3 Identity: ${iamIdentity}`
      : `IAM Identity: ${iamIdentity}`
    : null;
  const selectedLabel = selected
    ? formatAccountLabel(selected)
    : requiresContextSelection
      ? "No account selected"
      : sessionAccountName || "S3 session";

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
  }, [isBrowserExplorerRoute, requiresContextSelection, selectedContextId]);

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
            selectedContextId={selectedContextId}
            onContextChange={handleS3AccountChange}
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

  return (
    <BrowserSidebarSlotContext.Provider value={sidebarSlotValue}>
      <Layout
        navLinks={BROWSER_FALLBACK_NAV_LINKS}
        headerTitle="Browser"
        sidebarTitle="Browser"
        hideHeader
        hideSidebar={isBrowserExplorerRoute && !sidebarBody}
        renderSidebarBody={sidebarBody ?? undefined}
        topbarControlDescriptors={isBrowserExplorerRoute ? topbarControlDescriptors : undefined}
        mainClassName={isBrowserExplorerRoute ? "pb-0" : undefined}
        disableMainScroll={isBrowserExplorerRoute}
        fullHeight
      >
        {isBrowserExplorerRoute && accessError ? <PageBanner tone="warning">{accessError}</PageBanner> : null}
        {isBrowserExplorerRoute && requiresContextSelection && contextsLoaded && !selectedContextId ? (
          <>
            <h1 className="sr-only">Browser</h1>
            <PageEmptyState
              title={contexts.length > 0 ? "Select a private Browser connection" : "No private Browser connection"}
              description={
                contexts.length > 0
                  ? "Choose a private connection explicitly to start browsing."
                  : "Accounts, RGW users and shared connections are unavailable in Browser. Create a private connection with a dedicated access key."
              }
              primaryAction={{
                label: "Manage private connections",
                to: "/browser/profile?tab=connections",
              }}
              tone="warning"
              className="h-full"
            />
          </>
        ) : (
          <Outlet key={`${selectedContextId ?? "session"}`} />
        )}
      </Layout>
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
