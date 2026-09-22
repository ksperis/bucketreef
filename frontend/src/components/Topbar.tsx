/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { EffectiveUserAccess, UiRole, UserAvatarDescriptor } from "../api/users";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  canAccessPrivateConnectionsSection,
  readStoredUser,
  SESSION_USER_UPDATED_EVENT,
} from "../utils/workspaces";
import type { WorkspaceSwitcherModel } from "./EnvironmentSwitcher";
import ThemeToggle from "./ThemeToggle";
import TopbarAccountMenu from "./TopbarAccountMenu";
import TopbarNotifications from "./TopbarNotifications";
import TopbarWorkspaceSelector from "./TopbarWorkspaceSelector";
import { HamburgerIcon } from "./topbarIcons";
import type { TopbarControlDescriptor } from "./topbarControlsLayout";

type TopbarProps = {
  projectName?: string;
  section?: string;
  inlineContent?: ReactNode;
  controlsContent?: ReactNode;
  controlDescriptors?: TopbarControlDescriptor[];
  userEmail?: string | null;
  onLogout?: () => void;
  contextAction?: ReactNode;
  showMobileMenuButton?: boolean;
  mobileMenuOpen?: boolean;
  onMobileMenuToggle?: () => void;
  showWorkspaceSwitcher?: boolean;
  workspaceSwitcher?: WorkspaceSwitcherModel | null;
  profilePath?: string;
};

type StoredAccountLink = {
  account_id: number;
};

type StoredTopbarUser = {
  full_name?: string | null;
  avatar?: UserAvatarDescriptor | null;
  role?: UiRole | null;
  can_create_manual_private_connections?: boolean | null;
  can_provision_managed_private_connections?: boolean | null;
  effective_access?: Pick<
    EffectiveUserAccess,
    | "can_create_manual_private_connections"
    | "can_provision_managed_private_connections"
    | "has_owned_private_connections"
  > | null;
  authType?: "password" | "s3_session" | "oidc" | "ldap" | null;
  account_links?: StoredAccountLink[] | null;
};

function resolveUiRoleLabel(user: StoredTopbarUser | null): string {
  if (!user) return "Unknown";
  if (user.authType === "s3_session") return "S3 Session";
  if (user.role === "ui_superadmin") return "Superadmin";
  if (user.role === "ui_admin") return "Admin";
  if (user.role === "ui_user") return "User";
  if (user.role === "ui_none") return "No access";
  return "Unknown";
}

export default function Topbar({
  section,
  inlineContent,
  controlsContent,
  controlDescriptors,
  userEmail,
  onLogout,
  contextAction,
  showMobileMenuButton = false,
  mobileMenuOpen = false,
  onMobileMenuToggle,
  showWorkspaceSwitcher = true,
  workspaceSwitcher,
  profilePath = "/",
}: TopbarProps) {
  const [storedUser, setStoredUser] = useState<StoredTopbarUser | null>(
    () => readStoredUser() as StoredTopbarUser | null,
  );
  const isS3Session = storedUser?.authType === "s3_session";
  const canAccessPrivateConnections =
    !isS3Session && canAccessPrivateConnectionsSection(storedUser);
  const uiRoleLabel = useMemo(() => resolveUiRoleLabel(storedUser), [storedUser]);

  const isMobileViewport = useMediaQuery("(max-width: 767px)");
  const [controlsAvailableWidth, setControlsAvailableWidth] = useState<number>(Number.POSITIVE_INFINITY);

  const controlsStripRef = useRef<HTMLDivElement | null>(null);

  const accountDisplay = userEmail ?? "Session";
  const accountName = storedUser?.full_name?.trim() || accountDisplay;
  useEffect(() => {
    const syncStoredUser = () => {
      setStoredUser(readStoredUser() as StoredTopbarUser | null);
    };
    window.addEventListener(SESSION_USER_UPDATED_EVENT, syncStoredUser);
    window.addEventListener("storage", syncStoredUser);
    return () => {
      window.removeEventListener(SESSION_USER_UPDATED_EVENT, syncStoredUser);
      window.removeEventListener("storage", syncStoredUser);
    };
  }, []);
  const adaptiveControlDescriptors = useMemo(
    () => (controlDescriptors?.filter((control) => control.id !== "workspace") ?? []),
    [controlDescriptors]
  );
  const hasAdaptiveControls = adaptiveControlDescriptors.length > 0;
  const inlineControls = useMemo(() => {
    if (!hasAdaptiveControls) {
      return [] as { id: TopbarControlDescriptor["id"]; mode: "icon" | "icon_label"; descriptor: TopbarControlDescriptor }[];
    }
    const sorted = [...adaptiveControlDescriptors].sort((left, right) => left.priority - right.priority);
    const iconGap = 8;
    const iconOnlyWidth =
      sorted.reduce((sum, item) => sum + item.estimatedIconWidth, 0) + Math.max(0, sorted.length - 1) * iconGap;
    let remainingWidth = Math.max(0, Math.floor(controlsAvailableWidth) - iconOnlyWidth);

    return sorted.map((descriptor) => {
      if (isMobileViewport) {
        return { id: descriptor.id, mode: "icon" as const, descriptor };
      }
      const labelExtraWidth = Math.max(0, descriptor.estimatedLabelWidth - descriptor.estimatedIconWidth);
      if (remainingWidth >= labelExtraWidth) {
        remainingWidth -= labelExtraWidth;
        return { id: descriptor.id, mode: "icon_label" as const, descriptor };
      }
      return { id: descriptor.id, mode: "icon" as const, descriptor };
    });
  }, [adaptiveControlDescriptors, controlsAvailableWidth, hasAdaptiveControls, isMobileViewport]);

  useEffect(() => {
    if (!hasAdaptiveControls) return;
    const target = controlsStripRef.current;
    if (!target) return;

    const update = () => {
      const width = target.getBoundingClientRect().width;
      if (width > 0) {
        setControlsAvailableWidth(Math.floor(width));
      }
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        update();
      });
      observer.observe(target);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, [hasAdaptiveControls]);

  return (
    <>
      <div
        data-topbar
        className="shell-topbar z-[45] shrink-0"
      >
        <div className="flex h-14 min-w-0 items-center gap-2.5 px-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {showMobileMenuButton && (
              <button
                type="button"
                onClick={onMobileMenuToggle}
                aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
                aria-controls="mobile-navigation-panel"
                aria-expanded={mobileMenuOpen}
                className="shell-control inline-flex h-9 w-9 items-center justify-center rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 md:hidden"
              >
                <HamburgerIcon className="h-4 w-4" />
              </button>
            )}

            {showWorkspaceSwitcher ? (
              <TopbarWorkspaceSelector section={section} workspaceSwitcher={workspaceSwitcher} />
            ) : null}

            {hasAdaptiveControls ? (
              <div ref={controlsStripRef} className="flex min-w-0 flex-1 items-center">
                <div className="flex min-w-0 items-center gap-2">
                  {inlineControls.map((entry) => {
                    return <div key={entry.id}>{entry.descriptor.renderControl(entry.mode)}</div>;
                  })}
                </div>
              </div>
            ) : (
              controlsContent && <div className="hidden min-w-0 items-center md:flex">{controlsContent}</div>
            )}
          </div>

          {inlineContent && <div className="hidden min-w-0 items-center pl-1 xl:flex">{inlineContent}</div>}

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {contextAction && <div className="hidden sm:flex">{contextAction}</div>}

            <ThemeToggle />

            <TopbarNotifications enabled={!isS3Session} />

            <TopbarAccountMenu
              avatar={storedUser?.avatar}
              display={accountDisplay}
              name={accountName}
              roleLabel={uiRoleLabel}
              canAccessPrivateConnections={canAccessPrivateConnections}
              profilePath={profilePath}
              onLogout={onLogout}
            />
          </div>
        </div>
      </div>

    </>
  );
}
