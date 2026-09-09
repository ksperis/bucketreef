/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { describe, expect, it } from "vitest";
import type { SecuritySession } from "../../api/security";
import { profileMessages, type ProfileText } from "./profileMessages";
import { openSecuritySessions, securityDate, sessionActivity, sessionDevice } from "./securityPresentation";

const now = Date.parse("2026-09-09T12:00:00Z");
const session = (values: Partial<SecuritySession>): SecuritySession => ({ id: "current", current: true, auth_type: "password", principal_type: "user", created_at: "2026-09-08T10:00:00Z", last_activity_at: "2026-09-09T11:59:00Z", idle_expires_at: "2026-09-09T20:00:00Z", absolute_expires_at: "2026-09-15T12:00:00Z", ...values });
const text = (locale: "en" | "fr" | "de"): ProfileText => (key, values) => profileMessages[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match));

describe("security session presentation", () => {
  it("shows the current session first and excludes revoked, idle-expired and absolutely-expired sessions", () => {
    const sessions = [session({ id: "other", current: false }), session({}), session({ id: "revoked", revoked_at: "2026-09-09T11:00:00Z" }), session({ id: "idle-expired", idle_expires_at: new Date(now).toISOString() }), session({ id: "expired", absolute_expires_at: "2026-09-01T12:00:00Z" })];
    expect(openSecuritySessions(sessions, now).map(value => value.id)).toEqual(["current", "other"]);
    expect(sessions).toHaveLength(5);
  });
  it.each(["en", "fr", "de"] as const)("formats local dates and relative activity in %s", locale => {
    expect(securityDate(new Date(now).toISOString(), locale, "unknown")).toBe(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(now)));
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    expect(sessionActivity("2026-09-09T11:58:00Z", now, locale, text(locale))).toContain(relative.format(-2, "minute"));
    expect(securityDate("invalid", locale, "unknown")).toBe("unknown");
  });
  it("identifies browser and system from the user agent with an explicit fallback", () => {
    expect(sessionDevice(session({ user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/145.0 Safari/537.36 Edg/145.0" }), text("fr"))).toBe("Edge sur Windows");
    expect(sessionDevice(session({ user_agent: "custom-client" }), text("de"))).toBe("Unbekannter Browser");
  });
});
