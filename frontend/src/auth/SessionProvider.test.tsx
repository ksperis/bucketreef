/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  const { authenticated } = useSession();
  return <span>{authenticated ? "authenticated" : "signed out"}</span>;
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
