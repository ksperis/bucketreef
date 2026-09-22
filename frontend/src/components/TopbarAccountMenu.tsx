/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useId, useRef, useState } from "react";
import type { UserAvatarDescriptor } from "../api/users";
import { ChevronDownIcon, LinkIcon, LogoutIcon, UserIcon } from "./topbarIcons";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { useDismissibleLayer } from "./ui/useDismissibleLayer";
import UserAvatar from "./UserAvatar";

type TopbarAccountMenuProps = {
  avatar?: UserAvatarDescriptor | null;
  display: string;
  name: string;
  roleLabel: string;
  canAccessPrivateConnections: boolean;
  profilePath: string;
  onLogout?: () => void;
};

export default function TopbarAccountMenu({
  avatar,
  display,
  name,
  roleLabel,
  canAccessPrivateConnections,
  profilePath,
  onLogout,
}: TopbarAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const avatarName = name === display ? null : name;

  useDismissibleLayer({
    open,
    insideRefs: [rootRef, surfaceRef],
    onDismiss: (reason) => {
      setOpen(false);
      if (reason === "escape") triggerRef.current?.focus();
    },
    preventEscapeDefault: true,
  });

  useEffect(() => {
    if (!open) return;

    const queryMenuItems = () =>
      Array.from(surfaceRef.current?.querySelectorAll<HTMLButtonElement>("[data-account-menu-item='true']") ?? []);

    const focusMenuItem = (index: number) => {
      const items = queryMenuItems();
      if (items.length === 0) return;
      const normalizedIndex = (index + items.length) % items.length;
      items[normalizedIndex].focus();
    };

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setOpen(false);
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
  }, [open]);

  const triggerLogout = () => {
    setOpen(false);
    onLogout?.();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Account actions for ${display}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        }}
        className="inline-flex h-9 items-center gap-0 rounded-lg border border-transparent bg-transparent px-1 text-left transition hover:bg-[var(--shell-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:gap-2 sm:px-1.5"
      >
        <UserAvatar
          avatar={avatar}
          name={avatarName}
          email={display}
          size="md"
          className="border-[var(--shell-surface)] shadow-none"
        />
        <span className="hidden min-w-0 max-w-40 truncate text-[12px] font-semibold text-[var(--shell-text)] sm:block lg:max-w-52">
          {display}
        </span>
        <ChevronDownIcon
          className={`shell-icon-muted hidden h-4 w-4 transition-transform sm:block ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <AnchoredPortalMenu open={open} anchorRef={triggerRef} placement="bottom-end" minWidth={288}>
          <div
            id={menuId}
            ref={surfaceRef}
            role="menu"
            aria-label="Account actions"
            className="shell-menu w-72 rounded-lg border p-1.5"
          >
            <div className="shell-menu-muted mb-1 flex items-center gap-2.5 rounded-md border px-2.5 py-2">
              <UserAvatar
                avatar={avatar}
                name={avatarName}
                email={display}
                size="lg"
                className="border-[var(--shell-surface)] shadow-none"
              />
              <div className="min-w-0 flex-1">
                <p className="shell-muted-text ui-caption">Signed in as</p>
                <p className="truncate ui-caption font-semibold text-[var(--shell-text)]">{name}</p>
                {name !== display ? (
                  <p className="shell-muted-text truncate ui-caption">{display}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="shell-menu-muted inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold text-[var(--shell-text)]">
                    {roleLabel}
                  </span>
                </div>
              </div>
            </div>

            <a
              href={`${profilePath}?tab=profile`}
              role="menuitem"
              data-account-menu-item="true"
              onClick={() => setOpen(false)}
              className="shell-menu-item flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition"
            >
              <UserIcon className="shell-icon-muted mt-0.5 h-4 w-4" />
              <span>
                <span className="block ui-caption font-semibold text-[var(--shell-text)]">User profile</span>
                <span className="shell-muted-text block ui-caption">Personal details and preferences</span>
              </span>
            </a>

            {canAccessPrivateConnections && (
              <a
                href={`${profilePath}?tab=connections`}
                role="menuitem"
                data-account-menu-item="true"
                onClick={() => setOpen(false)}
                className="shell-menu-item flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition"
              >
                <LinkIcon className="shell-icon-muted mt-0.5 h-4 w-4" />
                <span>
                  <span className="block ui-caption font-semibold text-[var(--shell-text)]">
                    Private S3 connections
                  </span>
                  <span className="shell-muted-text block ui-caption">Manage your endpoints and credentials</span>
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
  );
}
