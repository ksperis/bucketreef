/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  clearReadUserNotifications,
  deleteUserNotification,
  fetchUserNotifications,
  markUserNotificationsRead,
  type UserNotification,
} from "../api/userNotifications";
import { BellIcon } from "./topbarIcons";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { useDismissibleLayer } from "./ui/useDismissibleLayer";

type TopbarNotificationsProps = {
  enabled: boolean;
};

function formatPercent(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value.toFixed(1)}%`;
}

function formatBytes(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let amount = Math.max(0, value);
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function formatCount(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value).toLocaleString();
}

function formatDateTime(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TopbarNotifications({ enabled }: TopbarNotificationsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [deleting, setDeleting] = useState<number | "read" | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useDismissibleLayer({
    open,
    insideRefs: [rootRef, surfaceRef],
    onDismiss: (reason) => {
      setOpen(false);
      if (reason === "escape") triggerRef.current?.focus();
    },
    preventEscapeDefault: true,
  });

  const loadNotifications = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchUserNotifications(20);
      setNotifications(response.items);
      setUnreadCount(response.unread_count);
    } catch {
      setError("Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const markAllRead = useCallback(async () => {
    if (!enabled || unreadCount <= 0) return;
    setError(null);
    try {
      const response = await markUserNotificationsRead({ all: true });
      setUnreadCount(response.unread_count);
      await loadNotifications();
    } catch (markError) {
      console.warn("Unable to mark notifications as read", markError);
      setError("Unable to mark notifications as read.");
    }
  }, [enabled, loadNotifications, unreadCount]);

  const deleteNotification = useCallback(async (notificationId: number) => {
    setError(null);
    setDeleting(notificationId);
    try {
      const response = await deleteUserNotification(notificationId);
      setUnreadCount(response.unread_count);
      await loadNotifications();
    } catch (deleteError) {
      console.warn("Unable to delete notification", deleteError);
      setError("Unable to delete notification.");
    } finally {
      setDeleting(null);
    }
  }, [loadNotifications]);

  const clearRead = useCallback(async () => {
    setError(null);
    setDeleting("read");
    try {
      const response = await clearReadUserNotifications();
      setUnreadCount(response.unread_count);
      await loadNotifications();
    } catch (clearError) {
      console.warn("Unable to clear read notifications", clearError);
      setError("Unable to clear read notifications.");
    } finally {
      setDeleting(null);
    }
  }, [loadNotifications]);

  useEffect(() => {
    if (!enabled) return;
    void loadNotifications();
    const interval = window.setInterval(() => {
      void loadNotifications();
    }, 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, loadNotifications]);

  useEffect(() => {
    if (!open) return;
    void loadNotifications();
  }, [loadNotifications, open]);

  if (!enabled) return null;

  const renderNotificationItem = (item: UserNotification) => {
    const payload = item.payload ?? {};
    const isOperationalCheck = item.type === "quota_alert" || item.type === "endpoint_health";
    const occurredAt = formatDateTime(
      (isOperationalCheck ? payload.checked_at as string | undefined : undefined) ?? item.created_at
    );
    const ratio = formatPercent(payload.usage_ratio_pct);
    const usedBytes = formatBytes(payload.used_bytes);
    const quotaBytes = formatBytes(payload.quota_size_bytes);
    const usedObjects = formatCount(payload.used_objects);
    const quotaObjects = formatCount(payload.quota_objects);
    const endpointName = typeof payload.endpoint_name === "string" ? payload.endpoint_name : null;
    const targetUserEmail = typeof payload.target_user_email === "string" ? payload.target_user_email : null;
    const provider =
      typeof payload.provider_type === "string" && typeof payload.provider_id === "string"
        ? `${payload.provider_type}:${payload.provider_id}`
        : null;
    const currentStatus = typeof payload.current_status === "string" ? payload.current_status : null;
    const checkMode = typeof payload.check_mode === "string" ? payload.check_mode : null;
    const latency = typeof payload.latency_ms === "number" ? `${Math.round(payload.latency_ms)} ms` : null;
    const expiresAt = formatDateTime(typeof payload.expires_at === "string" ? payload.expires_at : null);
    const severityLabel = item.severity === "error" ? "Error" : item.severity === "warning" ? "Warning" : "Info";
    const severityClass =
      item.severity === "error"
        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-700/70 dark:bg-red-950/30 dark:text-red-200"
        : item.severity === "warning"
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-200"
          : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700/70 dark:bg-blue-950/30 dark:text-blue-200";

    return (
      <li
        key={item.id}
        className={`rounded-md border px-3 py-2 ${
          item.read_at ? "border-[color:var(--shell-border-soft)]" : "border-[color:var(--shell-border)] bg-[var(--shell-hover)]"
        }`}
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate ui-caption font-semibold text-[var(--shell-text)]">{item.title}</p>
            <p className="mt-0.5 ui-caption text-[var(--shell-text)]">{item.message}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${severityClass}`}>
              {severityLabel}
            </span>
            <button
              type="button"
              onClick={() => void deleteNotification(item.id)}
              disabled={deleting !== null}
              aria-label={`Delete notification: ${item.title}`}
              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-[var(--shell-muted)] transition hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting === item.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 ui-caption text-[var(--shell-muted)]">
          {ratio && (
            <>
              <dt>Usage</dt>
              <dd className="text-right font-semibold text-[var(--shell-text)]">{ratio}</dd>
            </>
          )}
          {usedBytes && (
            <>
              <dt>Storage</dt>
              <dd className="text-right text-[var(--shell-text)]">
                {usedBytes}
                {quotaBytes ? ` / ${quotaBytes}` : ""}
              </dd>
            </>
          )}
          {usedObjects && (
            <>
              <dt>Objects</dt>
              <dd className="text-right text-[var(--shell-text)]">
                {usedObjects}
                {quotaObjects ? ` / ${quotaObjects}` : ""}
              </dd>
            </>
          )}
          {endpointName && (
            <>
              <dt>Endpoint</dt>
              <dd className="truncate text-right text-[var(--shell-text)]">{endpointName}</dd>
            </>
          )}
          {targetUserEmail && (
            <>
              <dt>User</dt>
              <dd className="truncate text-right text-[var(--shell-text)]">{targetUserEmail}</dd>
            </>
          )}
          {provider && (
            <>
              <dt>Provider</dt>
              <dd className="truncate text-right text-[var(--shell-text)]">{provider}</dd>
            </>
          )}
          {currentStatus && (
            <>
              <dt>Status</dt>
              <dd className="text-right font-semibold capitalize text-[var(--shell-text)]">{currentStatus}</dd>
            </>
          )}
          {checkMode && (
            <>
              <dt>Check</dt>
              <dd className="text-right uppercase text-[var(--shell-text)]">{checkMode}</dd>
            </>
          )}
          {latency && (
            <>
              <dt>Latency</dt>
              <dd className="text-right text-[var(--shell-text)]">{latency}</dd>
            </>
          )}
          {expiresAt && (
            <>
              <dt>Expires</dt>
              <dd className="text-right text-[var(--shell-text)]">{expiresAt}</dd>
            </>
          )}
          {occurredAt && (
            <>
              <dt>{isOperationalCheck ? "Checked" : "Created"}</dt>
              <dd className="text-right text-[var(--shell-text)]">{occurredAt}</dd>
            </>
          )}
        </dl>
      </li>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`shell-control relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
          open ? "shell-control-active" : ""
        }`}
      >
        <BellIcon className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <AnchoredPortalMenu
          open={open}
          anchorRef={triggerRef}
          placement="bottom-end"
          minWidth={360}
          className="shell-menu w-[22.5rem] max-w-[calc(100vw-1.5rem)] rounded-lg border p-0"
        >
          <div
            id={menuId}
            ref={surfaceRef}
            role="menu"
            aria-label="Notifications"
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--shell-border-soft)] px-3 py-2">
              <div>
                <p className="ui-caption font-semibold text-[var(--shell-text)]">Notifications</p>
                <p className="shell-muted-text ui-caption">{unreadCount} unread</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void clearRead()}
                  disabled={notifications.length === 0 || deleting !== null}
                  className="rounded-md px-2 py-1 ui-caption font-semibold text-[var(--shell-muted)] transition hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleting === "read" ? "Clearing..." : "Clear read"}
                </button>
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount <= 0 || deleting !== null}
                  className="rounded-md px-2 py-1 ui-caption font-semibold text-primary-700 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-primary-200 dark:hover:bg-white/[0.06]"
                >
                  Mark all as read
                </button>
              </div>
            </div>

            <div className="max-h-[28rem] overflow-y-auto p-2">
              {error && (
                <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 ui-caption text-red-700 dark:border-red-800/70 dark:bg-red-950/30 dark:text-red-200">
                  {error}
                </div>
              )}
              {loading && notifications.length === 0 ? (
                <div className="rounded-md border border-[color:var(--shell-border-soft)] px-3 py-6 text-center ui-caption text-[var(--shell-muted)]">
                  Loading notifications...
                </div>
              ) : notifications.length === 0 ? (
                <div className="rounded-md border border-[color:var(--shell-border-soft)] px-3 py-6 text-center ui-caption text-[var(--shell-muted)]">
                  No notifications.
                </div>
              ) : (
                <ul className="space-y-2">{notifications.map(renderNotificationItem)}</ul>
              )}
            </div>
          </div>
        </AnchoredPortalMenu>
      )}
    </div>
  );
}
