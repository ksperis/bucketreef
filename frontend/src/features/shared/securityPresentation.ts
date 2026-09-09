/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { SecuritySession } from "../../api/security";
import type { ProfileText } from "./profileMessages";

export function openSecuritySessions(sessions: SecuritySession[], now: number) {
  return sessions.filter((session) => !session.revoked_at && Date.parse(session.idle_expires_at) > now && Date.parse(session.absolute_expires_at) > now)
    .sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at));
}

export function sessionDevice(session: SecuritySession, text: ProfileText) {
  const ua = session.user_agent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /(?:Firefox|FxiOS)\//.test(ua) ? "Firefox" : /(?:Chrome|CriOS)\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh|Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return browser && os ? text("browserOnOs", { browser, os }) : browser ?? text("unknownBrowser");
}

export function securityDate(value: string | null | undefined, locale: string, fallback: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function sessionActivity(value: string, now: number, locale: string, text: ProfileText) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return text("unknown");
  if (minutes < 1) return text("activeNow");
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const time = minutes < 60 ? relative.format(-minutes, "minute") : minutes < 1440 ? relative.format(-Math.floor(minutes / 60), "hour") : securityDate(value, locale, text("unknown"));
  return text("activity", { time });
}
