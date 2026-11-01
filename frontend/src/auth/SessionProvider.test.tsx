/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, CurrentSessionResponse } from "../api/auth";
import { ApiError } from "../api/client";
import { readStoredUser } from "../utils/workspaces";
import { fetchCurrentSession } from "../api/auth";
import { SessionProvider, shouldBootstrapSession, useSession } from "./SessionProvider";
import { SESSION_ENDED_STORAGE_KEY } from "./sessionEvents";

vi.mock("../api/auth", () => ({
  fetchCurrentSession: vi.fn(),
}));

const NO_MANAGER_TOOLS = {
  bucket_compare: false,
  bucket_integrity_check: false,
  bucket_migration: false,
  bucket_purge: false,
  feature_rules: false,
};

function testUser(id: number, email: string, role: AuthUser["role"]): AuthUser {
  return {
    id,
    email,
    full_name: null,
    picture_url: null,
    avatar: {
      preference: "auto",
      source: "initials",
      url: null,
      initials: email.slice(0, 1).toUpperCase(),
      updated_at: null,
    },
    has_local_password: true,
    is_active: true,
    is_admin: role === "ui_admin" || role === "ui_superadmin",
    role,
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    allow_multisite_endpoint_switching: false,
    manager_tool_access: { ...NO_MANAGER_TOOLS },
    browser_advanced_features_enabled: false,
    ui_language: null,
    quota_alerts_enabled: false,
    quota_alerts_global_watch: false,
    ui_preferences: { theme: null, selected_portal_account_id: null },
    account_links: [],
    group_details: [],
    s3_user_links: [],
    s3_user_details: [],
    s3_connection_details: [],
    openstack_cloud_details: [],
    effective_access: {
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      can_create_manual_private_connections: false,
      can_provision_managed_private_connections: false,
      allow_multisite_endpoint_switching: false,
      group_can_provision_managed_private_connections: false,
      has_owned_private_connections: false,
      manager_tool_access: { ...NO_MANAGER_TOOLS },
      group_manager_tool_access: { ...NO_MANAGER_TOOLS },
      browser_advanced_features_enabled: false,
      account_links: [],
      s3_user_details: [],
      s3_connection_details: [],
    },
    last_login_at: null,
  };
}

function currentSession(user: AuthUser, id = "test-session"): CurrentSessionResponse {
  return {
    authenticated: true,
    user,
    session: null,
    auth_session: {
      id,
      principal_type: "user",
      auth_type: "password",
      created_at: "2026-09-27T17:00:00Z",
      last_activity_at: "2026-09-27T17:30:00Z",
      idle_expires_at: "2026-09-27T18:00:00Z",
      absolute_expires_at: "2026-09-28T18:00:00Z",
      mfa_verified_at: null,
      ip_address: null,
      user_agent: null,
      revoked_at: null,
      revoke_reason: null,
      current: true,
      user_id: user.id,
      s3_session_id: null,
    },
  };
}

function SessionState() {
  const { loading } = useSession();
  return <span>{loading ? "loading" : "ready"}</span>;
}

function AuthenticationState() {
  const { authenticated, bootstrapError, refresh } = useSession();
  return <><span>{authenticated ? "authenticated" : "signed out"}</span>
    {bootstrapError ? <span>Service unavailable</span> : null}
    <button onClick={() => { void refresh(); }}>Retry session</button></>;
}

describe("SessionProvider OIDC bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("recognizes only provider callback paths", () => {
    expect(shouldBootstrapSession("/oidc/google/callback")).toBe(false);
    expect(shouldBootstrapSession("/oidc/google/callback/")).toBe(false);
    expect(shouldBootstrapSession("/identity/link/attempt-1")).toBe(false);
    expect(shouldBootstrapSession("/identity/link/attempt-1/")).toBe(false);
    expect(shouldBootstrapSession("/setup/first-admin")).toBe(false);
    expect(shouldBootstrapSession("/oidc/google/start")).toBe(true);
    expect(shouldBootstrapSession("/login")).toBe(true);
  });

  it("does not restore a session before the OIDC code exchange", async () => {
    window.history.replaceState({}, "", "/oidc/google/callback?code=code&state=state");

    render(
      <SessionProvider>
        <SessionState />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    expect(fetchCurrentSession).not.toHaveBeenCalled();
  });

  it("clears the session when another tab broadcasts logout", async () => {
    vi.mocked(fetchCurrentSession).mockResolvedValueOnce(
      currentSession(testUser(1, "admin@example.test", "ui_admin"), "session-1"),
    );

    render(
      <SessionProvider>
        <AuthenticationState />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: SESSION_ENDED_STORAGE_KEY,
        newValue: "1727456400000:0.5",
      }),
    );

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
  });
});


describe("SessionProvider recovery", () => {
  const session = currentSession(testUser(42, "reader@example.test", "ui_user"));
  it("preserves an authenticated session after a temporary outage and retries", async () => {
    vi.mocked(fetchCurrentSession).mockReset().mockResolvedValueOnce(session)
      .mockRejectedValueOnce(new ApiError("Unavailable", { response: { status: 503, data: {}, headers: {} } }))
      .mockResolvedValueOnce(session);
    render(<SessionProvider><AuthenticationState /></SessionProvider>);
    await screen.findByText("authenticated");
    fireEvent.click(screen.getByText("Retry session"));
    await screen.findByText("Service unavailable");
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(readStoredUser()?.id).toBe(42);
    fireEvent.click(screen.getByText("Retry session"));
    await waitFor(() => expect(screen.queryByText("Service unavailable")).not.toBeInTheDocument());
    expect(readStoredUser()?.id).toBe(42);
  });
  it.each([401, 403, 419])("clears a session rejected with %s", async (status) => {
    vi.mocked(fetchCurrentSession).mockReset().mockResolvedValueOnce(session)
      .mockRejectedValueOnce(new ApiError("Denied", { response: { status, data: {}, headers: {} } }));
    render(<SessionProvider><AuthenticationState /></SessionProvider>);
    await screen.findByText("authenticated");
    fireEvent.click(screen.getByText("Retry session"));
    await screen.findByText("signed out");
    expect(readStoredUser()).toBeNull();
    expect(screen.queryByText("Service unavailable")).not.toBeInTheDocument();
  });
});
