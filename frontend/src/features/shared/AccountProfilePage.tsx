/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useContext, useEffect, useMemo, useState } from "react";
import { UNSAFE_DataRouterContext, useBlocker, useLocation, useSearchParams } from "react-router-dom";

import PageShell from "../../components/PageShell";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import { ProfileConfirmation } from "./ProfileControls";
import { useProfileI18n } from "./profileMessages";
import {
  canAccessPrivateConnectionsSection,
  readStoredUser,
} from "../../utils/workspaces";
import ProfilePage from "./ProfilePage";
import SecurityPage from "./SecurityPage";
import {
  buildWorkspaceBreadcrumbs,
  resolveWorkspaceIdFromPath,
} from "../../navigation/workspacePages";

type AccountTab = "profile" | "security" | "connections";

function ProfileRouteGuard({ dirty, onDiscard }: { dirty: boolean; onDiscard: () => void }) {
  const { text } = useProfileI18n();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && Boolean(readStoredUser()) && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  if (blocker.state !== "blocked") return null;
  return <ProfileConfirmation title={text("discardTitle")} description={text("discardDescription")} confirmLabel={text("discard")} cancelLabel={text("keepEditing")} zIndexClass="z-[110]" onCancel={() => blocker.reset()} onConfirm={() => { onDiscard(); blocker.proceed(); }} />;
}

export default function AccountProfilePage() {
  const { text } = useProfileI18n();
  const hasDataRouter = Boolean(useContext(UNSAFE_DataRouterContext));
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const storedUser = useMemo(() => readStoredUser(), []);
  const isS3Session = storedUser?.authType === "s3_session";
  const canAccessPrivateConnections =
    !isS3Session && canAccessPrivateConnectionsSection(storedUser);
  const availableTabs = useMemo<AccountTab[]>(
    () => [
      "profile",
      ...(!isS3Session ? (["security"] as const) : []),
      ...(canAccessPrivateConnections ? (["connections"] as const) : []),
    ],
    [canAccessPrivateConnections, isS3Session]
  );
  const requestedTab = searchParams.get("tab") as AccountTab | null;
  const activeTab: AccountTab = requestedTab && availableTabs.includes(requestedTab) ? requestedTab : "profile";
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingTab, setPendingTab] = useState<AccountTab | null>(null);
  const workspace = resolveWorkspaceIdFromPath(location.pathname);

  useEffect(() => {
    if (!requestedTab || requestedTab === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set("tab", "profile");
    setSearchParams(next, { replace: true });
  }, [activeTab, requestedTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const applyTabChange = (tab: AccountTab) => {
    if (!hasDataRouter) setHasUnsavedChanges(false);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
  };

  const changeTab = (tab: string) => {
    if (!availableTabs.includes(tab as AccountTab) || tab === activeTab) return;
    if (hasUnsavedChanges && !hasDataRouter) {
      setPendingTab(tab as AccountTab);
      return;
    }
    applyTabChange(tab as AccountTab);
  };

  const tabs = [
    { id: "profile", label: text("preferencesTab") },
    ...(!isS3Session ? [{ id: "security", label: text("security") }] : []),
    ...(canAccessPrivateConnections ? [{ id: "connections", label: text("connections") }] : []),
  ];

  return (
    <PageShell
      className="account-profile"
      title={text("title")}
      description={text(isS3Session ? "temporary" : "intro")}
      breadcrumbs={buildWorkspaceBreadcrumbs(workspace, { label: text("profile") })}
    >
      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={changeTab}
        variant="line"
        ariaLabel={text("sections")}
        idPrefix="account-profile"
      />
      <PageTabPanel idPrefix="account-profile" tabId={activeTab}>
        {activeTab === "profile" ? (
          <ProfilePage showPageHeader={false} showSettingsCards showConnectionsSection={false} onUnsavedChangesChange={setHasUnsavedChanges} />
        ) : null}
        {activeTab === "connections" ? (
          <ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection onUnsavedChangesChange={setHasUnsavedChanges} />
        ) : null}
        {activeTab === "security" ? <SecurityPage onUnsavedChangesChange={setHasUnsavedChanges} /> : null}
      </PageTabPanel>
      {hasDataRouter && <ProfileRouteGuard dirty={hasUnsavedChanges} onDiscard={() => setHasUnsavedChanges(false)} />}
      {pendingTab ? (
        <ProfileConfirmation
          title={text("discardTitle")}
          description={text("discardDescription")}
          confirmLabel={text("discard")}
          cancelLabel={text("keepEditing")}
          onCancel={() => setPendingTab(null)}
          onConfirm={() => {
            const nextTab = pendingTab;
            setPendingTab(null);
            applyTabChange(nextTab);
          }}
        />
      ) : null}
    </PageShell>
  );
}
