/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type { EffectiveUserAccess, UiRole, UserAvatarDescriptor } from "../api/users";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  canAccessPrivateConnectionsSection,
  readStoredUser,
  SESSION_USER_UPDATED_EVENT,
} from "../utils/workspaces";
import type { WorkspaceSwitcherModel } from "./EnvironmentSwitcher";
import ThemeToggle from "./ThemeToggle";
import TopbarNotifications from "./TopbarNotifications";
import TopbarWorkspaceSelector from "./TopbarWorkspaceSelector";
import {
  ChevronDownIcon,
  HamburgerIcon,
  LinkIcon,
  LogoutIcon,
  UserIcon,
} from "./topbarIcons";
import type { TopbarControlDescriptor } from "./topbarControlsLayout";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { useDismissibleLayer } from "./ui/useDismissibleLayer";
import UserAvatar from "./UserAvatar";

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

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRootRef = useRef<HTMLDivElement | null>(null);
  const accountMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const accountMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuId = useId();

  const controlsStripRef = useRef<HTMLDivElement | null>(null);

  const accountDisplay = userEmail ?? "Session";
  const accountName = storedUser?.full_name?.trim() || accountDisplay;
  const accountAvatarName = accountName === accountDisplay ? null : accountName;
  useDismissibleLayer({
    open: accountMenuOpen,
    insideRefs: [accountMenuRootRef, accountMenuSurfaceRef],
    onDismiss: (reason) => {
      setAccountMenuOpen(false);
      if (reason === "escape") accountMenuTriggerRef.current?.focus();
    },
    preventEscapeDefault: true,
  });
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

  useEffect(() => {
    if (!accountMenuOpen) return;

    const queryMenuItems = () =>
      Array.from(accountMenuSurfaceRef.current?.querySelectorAll<HTMLButtonElement>("[data-account-menu-item='true']") ?? []);

    const focusMenuItem = (index: number) => {
      const items = queryMenuItems();
      if (items.length === 0) return;
      const normalizedIndex = (index + items.length) % items.length;
      items[normalizedIndex].focus();
    };

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setAccountMenuOpen(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const activeElement = document.activeElement as HTMLElement | null;
      const items = queryMenuItems();
      if (items.length === 0) return;
      const currentIndex = activeElement ? items.findIndex((item) => item === activeElement) : -1;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMenuItem(currentIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMenuItem(currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        focusMenuItem(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        focusMenuItem(items.length - 1);
      }
    };

    requestAnimationFrame(() => {
      focusMenuItem(0);
    });

    document.addEventListener("keydown", handleMenuKeyDown);
    return () => {
      document.removeEventListener("keydown", handleMenuKeyDown);
    };
  }, [accountMenuOpen]);

  const triggerLogout = () => {
    setAccountMenuOpen(false);
    onLogout?.();
  };

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

            <div ref={accountMenuRootRef} className="relative">
              <button
                ref={accountMenuTriggerRef}
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-label={`Account actions for ${accountDisplay}`}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-controls={accountMenuOpen ? accountMenuId : undefined}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  setAccountMenuOpen(true);
                }}
                className="inline-flex h-9 items-center gap-0 rounded-lg border border-transparent bg-transparent px-1 text-left transition hover:bg-[var(--shell-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:gap-2 sm:px-1.5"
              >
                <UserAvatar
                  avatar={storedUser?.avatar}
                  name={accountAvatarName}
                  email={accountDisplay}
                  size="md"
                  className="border-[var(--shell-surface)] shadow-none"
                />
                <span className="hidden min-w-0 max-w-40 truncate text-[12px] font-semibold text-[var(--shell-text)] sm:block lg:max-w-52">
                  {accountDisplay}
                </span>
                <ChevronDownIcon
                  className={`shell-icon-muted hidden h-4 w-4 transition-transform sm:block ${
                    accountMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {accountMenuOpen && (
                <AnchoredPortalMenu open={accountMenuOpen} anchorRef={accountMenuTriggerRef} placement="bottom-end" minWidth={288}>
                  <div
                    id={accountMenuId}
                    ref={accountMenuSurfaceRef}
                    role="menu"
                    aria-label="Account actions"
                    className="shell-menu w-72 rounded-lg border p-1.5"
                  >
                    <div className="shell-menu-muted mb-1 flex items-center gap-2.5 rounded-md border px-2.5 py-2">
                      <UserAvatar
                        avatar={storedUser?.avatar}
                        name={accountAvatarName}
                        email={accountDisplay}
                        size="lg"
                        className="border-[var(--shell-surface)] shadow-none"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="shell-muted-text ui-caption">Signed in as</p>
                        <p className="truncate ui-caption font-semibold text-[var(--shell-text)]">{accountName}</p>
                        {accountName !== accountDisplay ? (
                          <p className="shell-muted-text truncate ui-caption">{accountDisplay}</p>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <span className="shell-menu-muted inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold text-[var(--shell-text)]">
                            {uiRoleLabel}
                          </span>
                        </div>
                      </div>
                    </div>

                    <a
                      href={`${profilePath}?tab=profile`}
                      role="menuitem"
                      data-account-menu-item="true"
                      onClick={() => setAccountMenuOpen(false)}
                      className="shell-menu-item flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition"
                    >
                      <UserIcon className="shell-icon-muted mt-0.5 h-4 w-4" />
                      <span>
                        <span className="block ui-caption font-semibold text-[var(--shell-text)]">
                          User profile
                        </span>
                        <span className="shell-muted-text block ui-caption">
                          Personal details and preferences
                        </span>
                      </span>
                    </a>

                    {canAccessPrivateConnections && (
                      <a
                        href={`${profilePath}?tab=connections`}
                        role="menuitem"
                        data-account-menu-item="true"
                        onClick={() => setAccountMenuOpen(false)}
                        className="shell-menu-item flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition"
                      >
                        <LinkIcon className="shell-icon-muted mt-0.5 h-4 w-4" />
                        <span>
                          <span className="block ui-caption font-semibold text-[var(--shell-text)]">
                            Private S3 connections
                          </span>
                          <span className="shell-muted-text block ui-caption">
                            Manage your endpoints and credentials
                          </span>
                        </span>
                      </a>
                    )}

                    <div className="my-1 border-t border-[color:var(--shell-border-soft)]" />
                    <button
                      type="button"
                      role="menuitem"
                      data-account-menu-item="true"
                      onClick={triggerLogout}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left ui-caption font-semibold text-primary-700 transition hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-white/[0.06]"
                    >
                      <LogoutIcon className="h-4 w-4" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </AnchoredPortalMenu>
              )}
            </div>
          </div>
        </div>
      </div>

    </>
  );
}
