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
import { useI18n } from "../i18n";
import { BellIcon } from "./topbarIcons";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { useDismissibleLayer } from "./ui/useDismissibleLayer";
import TopbarUtilityHint from "./TopbarUtilityHint";

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

function formatDateTime(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TopbarNotifications({ enabled }: TopbarNotificationsProps) {
  const { locale, t } = useI18n();
  const intlLocale = locale === "fr" ? "fr-FR" : locale === "de" ? "de-DE" : locale === "zh" ? "zh-CN" : "en-US";
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
      setError(t({
        en: "Unable to load notifications.",
        fr: "Impossible de charger les notifications.",
        de: "Benachrichtigungen konnten nicht geladen werden.",
        zh: "无法加载通知。",
      }));
    } finally {
      setLoading(false);
    }
  }, [enabled, t]);

  const markAllRead = useCallback(async () => {
    if (!enabled || unreadCount <= 0) return;
    setError(null);
    try {
      const response = await markUserNotificationsRead({ all: true });
      setUnreadCount(response.unread_count);
      await loadNotifications();
    } catch (markError) {
      console.warn("Unable to mark notifications as read", markError);
      setError(t({
        en: "Unable to mark notifications as read.",
        fr: "Impossible de marquer les notifications comme lues.",
        de: "Benachrichtigungen konnten nicht als gelesen markiert werden.",
        zh: "无法将通知标记为已读。",
      }));
    }
  }, [enabled, loadNotifications, t, unreadCount]);

  const deleteNotification = useCallback(async (notificationId: number) => {
    setError(null);
    setDeleting(notificationId);
    try {
      const response = await deleteUserNotification(notificationId);
      setUnreadCount(response.unread_count);
      await loadNotifications();
    } catch (deleteError) {
      console.warn("Unable to delete notification", deleteError);
      setError(t({
        en: "Unable to delete notification.",
        fr: "Impossible de supprimer la notification.",
        de: "Die Benachrichtigung konnte nicht gelöscht werden.",
        zh: "无法删除通知。",
      }));
    } finally {
      setDeleting(null);
    }
  }, [loadNotifications, t]);

  const clearRead = useCallback(async () => {
    setError(null);
    setDeleting("read");
    try {
      const response = await clearReadUserNotifications();
      setUnreadCount(response.unread_count);
      await loadNotifications();
    } catch (clearError) {
      console.warn("Unable to clear read notifications", clearError);
      setError(t({
        en: "Unable to clear read notifications.",
        fr: "Impossible de supprimer les notifications lues.",
        de: "Gelesene Benachrichtigungen konnten nicht gelöscht werden.",
        zh: "无法清除已读通知。",
      }));
    } finally {
      setDeleting(null);
    }
  }, [loadNotifications, t]);

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
      (isOperationalCheck ? payload.checked_at as string | undefined : undefined) ?? item.created_at,
      intlLocale,
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
    const expiresAt = formatDateTime(typeof payload.expires_at === "string" ? payload.expires_at : null, intlLocale);
    const severityLabel = item.severity === "error"
      ? t({ en: "Error", fr: "Erreur", de: "Fehler", zh: "错误" })
      : item.severity === "warning"
        ? t({ en: "Warning", fr: "Avertissement", de: "Warnung", zh: "警告" })
        : t({ en: "Info", fr: "Info", de: "Info", zh: "信息" });
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
              aria-label={t({
                en: `Delete notification: ${item.title}`,
                fr: `Supprimer la notification : ${item.title}`,
                de: `Benachrichtigung löschen: ${item.title}`,
                zh: `删除通知：${item.title}`,
              })}
              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-[var(--shell-muted)] transition hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting === item.id
                ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird gelöscht...", zh: "正在删除..." })
                : t({ en: "Delete", fr: "Supprimer", de: "Löschen", zh: "删除" })}
            </button>
          </div>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 ui-caption text-[var(--shell-muted)]">
          {ratio && (
            <>
              <dt>{t({ en: "Usage", fr: "Utilisation", de: "Nutzung", zh: "使用量" })}</dt>
              <dd className="text-right font-semibold text-[var(--shell-text)]">{ratio}</dd>
            </>
          )}
          {usedBytes && (
            <>
              <dt>{t({ en: "Storage", fr: "Stockage", de: "Speicher", zh: "存储" })}</dt>
              <dd className="text-right text-[var(--shell-text)]">
                {usedBytes}
                {quotaBytes ? ` / ${quotaBytes}` : ""}
              </dd>
            </>
          )}
          {usedObjects && (
            <>
              <dt>{t({ en: "Objects", fr: "Objets", de: "Objekte", zh: "对象" })}</dt>
              <dd className="text-right text-[var(--shell-text)]">
                {usedObjects}
                {quotaObjects ? ` / ${quotaObjects}` : ""}
              </dd>
            </>
          )}
          {endpointName && (
            <>
              <dt>{t({ en: "Endpoint", fr: "Endpoint", de: "Endpunkt", zh: "端点" })}</dt>
              <dd className="truncate text-right text-[var(--shell-text)]">{endpointName}</dd>
            </>
          )}
          {targetUserEmail && (
            <>
              <dt>{t({ en: "User", fr: "Utilisateur", de: "Benutzer", zh: "用户" })}</dt>
              <dd className="truncate text-right text-[var(--shell-text)]">{targetUserEmail}</dd>
            </>
          )}
          {provider && (
            <>
              <dt>{t({ en: "Provider", fr: "Fournisseur", de: "Provider", zh: "提供方" })}</dt>
              <dd className="truncate text-right text-[var(--shell-text)]">{provider}</dd>
            </>
          )}
          {currentStatus && (
            <>
              <dt>{t({ en: "Status", fr: "État", de: "Status", zh: "状态" })}</dt>
              <dd className="text-right font-semibold capitalize text-[var(--shell-text)]">{currentStatus}</dd>
            </>
          )}
          {checkMode && (
            <>
              <dt>{t({ en: "Check", fr: "Vérification", de: "Prüfung", zh: "检查" })}</dt>
              <dd className="text-right uppercase text-[var(--shell-text)]">{checkMode}</dd>
            </>
          )}
          {latency && (
            <>
              <dt>{t({ en: "Latency", fr: "Latence", de: "Latenz", zh: "延迟" })}</dt>
              <dd className="text-right text-[var(--shell-text)]">{latency}</dd>
            </>
          )}
          {expiresAt && (
            <>
              <dt>{t({ en: "Expires", fr: "Expiration", de: "Ablauf", zh: "过期时间" })}</dt>
              <dd className="text-right text-[var(--shell-text)]">{expiresAt}</dd>
            </>
          )}
          {occurredAt && (
            <>
              <dt>
                {isOperationalCheck
                  ? t({ en: "Checked", fr: "Vérifié", de: "Geprüft", zh: "检查时间" })
                  : t({ en: "Created", fr: "Créé", de: "Erstellt", zh: "创建时间" })}
              </dt>
              <dd className="text-right text-[var(--shell-text)]">{occurredAt}</dd>
            </>
          )}
        </dl>
      </li>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <TopbarUtilityHint label={t({ en: "Notifications", fr: "Notifications", de: "Benachrichtigungen", zh: "通知" })} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={t({ en: "Notifications", fr: "Notifications", de: "Benachrichtigungen", zh: "通知" })}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className="shell-utility-button"
        >
          <BellIcon aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </TopbarUtilityHint>

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
            aria-label={t({ en: "Notifications", fr: "Notifications", de: "Benachrichtigungen", zh: "通知" })}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--shell-border-soft)] px-3 py-2">
              <div>
                <p className="ui-caption font-semibold text-[var(--shell-text)]">
                  {t({ en: "Notifications", fr: "Notifications", de: "Benachrichtigungen", zh: "通知" })}
                </p>
                <p className="shell-muted-text ui-caption">
                  {t({
                    en: `${unreadCount} unread`,
                    fr: `${unreadCount} non lue${unreadCount > 1 ? "s" : ""}`,
                    de: `${unreadCount} ungelesen`,
                    zh: `${unreadCount} 条未读`,
                  })}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void clearRead()}
                  disabled={notifications.length === 0 || deleting !== null}
                  className="rounded-md px-2 py-1 ui-caption font-semibold text-[var(--shell-muted)] transition hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleting === "read"
                    ? t({ en: "Clearing...", fr: "Suppression...", de: "Wird bereinigt...", zh: "正在清除..." })
                    : t({ en: "Clear read", fr: "Supprimer les lues", de: "Gelesene löschen", zh: "清除已读" })}
                </button>
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount <= 0 || deleting !== null}
                  className="rounded-md px-2 py-1 ui-caption font-semibold text-primary-700 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-primary-200 dark:hover:bg-white/[0.06]"
                >
                  {t({
                    en: "Mark all as read",
                    fr: "Tout marquer comme lu",
                    de: "Alle als gelesen markieren",
                    zh: "全部标记为已读",
                  })}
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
                  {t({
                    en: "Loading notifications...",
                    fr: "Chargement des notifications...",
                    de: "Benachrichtigungen werden geladen...",
                    zh: "正在加载通知...",
                  })}
                </div>
              ) : notifications.length === 0 ? (
                <div className="rounded-md border border-[color:var(--shell-border-soft)] px-3 py-6 text-center ui-caption text-[var(--shell-muted)]">
                  {t({
                    en: "No notifications.",
                    fr: "Aucune notification.",
                    de: "Keine Benachrichtigungen.",
                    zh: "暂无通知。",
                  })}
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
