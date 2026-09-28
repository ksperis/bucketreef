/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { readStoredUser } from "../utils/workspaces";
import { fetchCurrentSession } from "../api/auth";
import { SessionProvider, shouldBootstrapSession, useSession } from "./SessionProvider";
import { SESSION_ENDED_STORAGE_KEY } from "./sessionEvents";

vi.mock("../api/auth", () => ({
  fetchCurrentSession: vi.fn(),
}));

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
    vi.mocked(fetchCurrentSession).mockResolvedValueOnce({
      authenticated: true,
      user: {
        id: 1,
        email: "admin@example.test",
        role: "ui_admin",
      },
      auth_session: {
        id: "session-1",
        auth_type: "password",
        idle_expires_at: "2026-09-27T18:00:00Z",
        absolute_expires_at: "2026-09-28T18:00:00Z",
      },
    });

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
  const session = {
    authenticated: true as const,
    user: { id: 42, email: "reader@example.test", role: "ui_user" as const },
    auth_session: { id: "test-session", auth_type: "password", idle_expires_at: "2026-09-28T18:00:00Z", absolute_expires_at: "2026-09-29T18:00:00Z" },
  };
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
