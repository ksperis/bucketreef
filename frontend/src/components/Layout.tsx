/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { WorkspaceErrorContext } from "./errors/WorkspaceErrorContext";
import { logout as logoutRequest } from "../api/auth";
import { broadcastSessionEnded } from "../auth/sessionEvents";
import Header from "./Header";
import Sidebar, { SidebarLink, SidebarSection, type SidebarBodyRenderArgs } from "./Sidebar";
import WorkspaceDocumentationLink from "./WorkspaceDocumentationLink";
import { resolveDocumentationUrl } from "../navigation/documentation";
import { useGeneralSettings } from "./GeneralSettingsContext";
import { resolveWorkspaceProfilePath } from "../navigation/workspacePages";
import { useShellI18n } from "./shellMessages";
import { useWorkspaceSwitcherModel } from "./EnvironmentSwitcher";
import Topbar from "./Topbar";
import type { TopbarControlDescriptor } from "./topbarControlsLayout";
import UiDrawer from "./ui/UiDrawer";
import { useWorkspaceDrawerAnchor } from "./useWorkspaceDrawerAnchor";
import {
  CLIENT_STORAGE_KEYS,
  clearAuthStorage,
  readClientStorage,
  writeClientStorage,
} from "../utils/clientStorage";
import { readStoredUser } from "../utils/workspaces";

type LayoutProps = {
  navLinks?: SidebarLink[];
  navSections?: SidebarSection[];
  headerTitle: string;
  headerSubtitle?: string;
  headerContext?: string;
  sidebarTitle?: string;
  headerInlineAction?: ReactNode;
  topbarContent?: ReactNode;
  topbarControls?: ReactNode;
  topbarControlDescriptors?: TopbarControlDescriptor[];
  projectName?: string;
  hideHeader?: boolean;
  hideTopbar?: boolean;
  topbarAction?: ReactNode;
  sidebarAction?: ReactNode;
  sidebarFooter?: ReactNode;
  renderSidebarBody?: (args: SidebarBodyRenderArgs) => ReactNode;
  hideSidebar?: boolean;
  mainClassName?: string;
  disableMainScroll?: boolean;
  children?: ReactNode;
};

function getUserEmail(): string | null {
  return readStoredUser()?.email ?? null;
}

export default function Layout({
  navLinks = [],
  navSections,
  headerTitle,
  headerSubtitle,
  headerContext,
  sidebarTitle,
  headerInlineAction,
  topbarContent,
  topbarControls,
  topbarControlDescriptors,
  projectName,
  hideHeader = false,
  hideTopbar = false,
  topbarAction,
  sidebarAction,
  sidebarFooter,
  renderSidebarBody,
  hideSidebar = false,
  mainClassName,
  disableMainScroll = false,
  children,
}: LayoutProps) {
  const location = useLocation();
  const workspaceContentRef = useWorkspaceDrawerAnchor();
  const { locale, text } = useShellI18n();
  const { generalSettings } = useGeneralSettings();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCompact, setDesktopSidebarCompact] = useState(
    () => readClientStorage(CLIENT_STORAGE_KEYS.sidebarCompact) === "1",
  );
  const shouldShowSidebar = !hideSidebar;
  const userEmail = getUserEmail();
  const workspaceSwitcher = useWorkspaceSwitcherModel();
  const logout = () => {
    void logoutRequest().catch((err) => {
      console.warn("Unable to revoke refresh session", err);
    });
    clearAuthStorage();
    broadcastSessionEnded();
    window.location.href = "/login";
  };
  const hasTopbarControls = Boolean(topbarControls) || Boolean(topbarControlDescriptors?.length);
  const heroInlineAction = topbarContent || hasTopbarControls ? undefined : headerInlineAction;
  const resolvedInlineTopbarContent = topbarContent ?? (hasTopbarControls ? undefined : headerInlineAction);
  const mainOverflowClass = disableMainScroll ? "overflow-hidden" : "overflow-y-auto";
  const mainClasses = `shell-page flex min-h-0 min-w-0 flex-1 flex-col ${mainOverflowClass} px-4 pb-8 pt-4 sm:px-8${
    mainClassName ? ` ${mainClassName}` : ""
  }`;
  const documentationUrl = resolveDocumentationUrl(location.pathname, {
    language: locale,
    baseUrl: generalSettings.documentation_base_url,
  });
  const resolvedTopbarAction = topbarAction || documentationUrl ? (
    <div className="flex items-center gap-1.5">
      {topbarAction}
      {documentationUrl ? <WorkspaceDocumentationLink href={documentationUrl} /> : null}
    </div>
  ) : undefined;

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!shouldShowSidebar) {
      setMobileSidebarOpen(false);
    }
  }, [shouldShowSidebar]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [mobileSidebarOpen]);

  const handleDesktopSidebarCollapseToggle = () => {
    setDesktopSidebarCompact((current) => {
      const next = !current;
      writeClientStorage(CLIENT_STORAGE_KEYS.sidebarCompact, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="shell-page flex h-[100dvh] overflow-hidden">
      {shouldShowSidebar && (
        <Sidebar
          title={sidebarTitle}
          sections={navSections}
          links={navLinks}
          headerAction={sidebarAction}
          footer={sidebarFooter}
          renderSidebarBody={renderSidebarBody}
          compact={desktopSidebarCompact}
          onCollapseToggle={handleDesktopSidebarCollapseToggle}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!hideTopbar && (
          <Topbar
            projectName={projectName}
            section={headerTitle}
            inlineContent={resolvedInlineTopbarContent}
            controlsContent={topbarControls}
            controlDescriptors={topbarControlDescriptors}
            userEmail={userEmail}
            onLogout={logout}
            contextAction={resolvedTopbarAction}
            showMobileMenuButton={shouldShowSidebar}
            mobileMenuOpen={mobileSidebarOpen}
            onMobileMenuToggle={() => setMobileSidebarOpen((open) => !open)}
            showWorkspaceSwitcher
            workspaceSwitcher={workspaceSwitcher}
            profilePath={resolveWorkspaceProfilePath(location.pathname)}
          />
        )}
        <div ref={workspaceContentRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {shouldShowSidebar && mobileSidebarOpen ? (
            <UiDrawer
              ariaLabelledBy="mobile-navigation-title"
              placement="left"
              rootClassName="inset-0 md:hidden"
              showBackdrop
              backdropLabel={text("closeMobileNavigation")}
              surfaceClassName="w-[16rem] max-w-[86vw]"
              onClose={() => setMobileSidebarOpen(false)}
            >
              <div id="mobile-navigation-panel" className="h-full">
                <h2 id="mobile-navigation-title" className="sr-only">
                  {sidebarTitle ?? text("navigation")}
                </h2>
                <Sidebar
                  variant="mobile"
                  title={sidebarTitle}
                  sections={navSections}
                  links={navLinks}
                  headerAction={sidebarAction}
                  footer={sidebarFooter}
                  renderSidebarBody={renderSidebarBody}
                  onNavigate={() => setMobileSidebarOpen(false)}
                />
              </div>
            </UiDrawer>
          ) : null}
          <main className={mainClasses}>
            {!hideHeader && (
              <Header
                title={headerTitle}
                subtitle={headerSubtitle}
                context={headerContext}
                inlineAction={heroInlineAction}
              />
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col space-y-4">
              <WorkspaceErrorContext.Provider value={`/${location.pathname.split("/")[1]}`}>
                {children ?? <Outlet />}
              </WorkspaceErrorContext.Provider>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
