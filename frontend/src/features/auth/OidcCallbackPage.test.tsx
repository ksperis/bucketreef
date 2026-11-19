/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationResponse } from "../../api/auth";
import { ApiError } from "../../api/client";
import { LanguageProvider } from "../../components/language";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";
import OidcCallbackPage from "./OidcCallbackPage";

const mocks = vi.hoisted(() => ({
  completeLogin: vi.fn(),
  fetchSettings: vi.fn(),
  workspaceAccess: vi.fn(),
  acceptAuthentication: vi.fn(),
  setGeneralSettings: vi.fn(),
  setTheme: vi.fn(),
  runtimeSurfaces: {
    admin: true,
    ceph_admin: true,
    storage_ops: true,
    manager: true,
    portal: true,
    browser: true,
  },
}));

vi.mock("../../api/auth", () => ({ completeOidcLogin: mocks.completeLogin }));
vi.mock("../../api/appSettings", () => ({ fetchGeneralSettings: mocks.fetchSettings }));
vi.mock("../../api/executionContexts", () => ({ getWorkspaceAccess: mocks.workspaceAccess }));
vi.mock("../../auth/SessionProvider", () => ({
  useSession: () => ({ acceptAuthentication: mocks.acceptAuthentication }),
}));
vi.mock("../../components/GeneralSettingsContext", () => ({
  DEFAULT_GENERAL_SETTINGS: {},
  useGeneralSettings: () => ({
    runtimeSurfaces: mocks.runtimeSurfaces,
    setGeneralSettings: mocks.setGeneralSettings,
  }),
}));
vi.mock("../../components/theme", () => ({ useTheme: () => ({ setTheme: mocks.setTheme }) }));
vi.mock("../../utils/routePrefetch", () => ({ prefetchWorkspaceBranch: vi.fn() }));
vi.mock("../../utils/workspaces", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../utils/workspaces")>(),
  resolvePostLoginPath: () => "/browser",
  resolvePostLoginPathWithWorkspaceAccess: () => "/browser",
}));

describe("OIDC callback localization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(CLIENT_STORAGE_KEYS.languagePreference, "en");
    mocks.runtimeSurfaces = {
      admin: true,
      ceph_admin: true,
      storage_ops: true,
      manager: true,
      portal: true,
      browser: true,
    };
    mocks.workspaceAccess.mockResolvedValue({});
  });

  it("exchanges the code once when the authenticated profile changes the UI language", async () => {
    let finishSettings!: (settings: object) => void;
    mocks.fetchSettings.mockReturnValue(new Promise((resolve) => { finishSettings = resolve; }));
    mocks.completeLogin.mockResolvedValue({
      status: "authenticated",
      user: { id: 1, email: "user@example.com", role: "ui_user", ui_language: "zh" },
    } as AuthenticationResponse);

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/auth/oidc/example/callback?code=test-code&state=locale-change"]}>
          <Routes>
            <Route path="/auth/oidc/:provider/callback" element={<OidcCallbackPage />} />
            <Route path="/browser" element={<p>Browser destination</p>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    await waitFor(() => expect(document.documentElement.lang).toBe("zh-Hans"));
    expect(screen.getByRole("heading", { name: "正在为你登录" })).toBeInTheDocument();
    expect(mocks.completeLogin).toHaveBeenCalledTimes(1);
    expect(mocks.acceptAuthentication).toHaveBeenCalledTimes(1);
    finishSettings({});
    expect(await screen.findByText("Browser destination")).toBeInTheDocument();
  });

  it("continues an email-collision login through the account-link flow without accepting a session", async () => {
    mocks.completeLogin.mockResolvedValue({
      status: "link_reauthentication_required",
      user: null,
      session: null,
      redirect_path: null,
      recovery_codes: null,
      link_attempt_id: "attempt-123",
    } satisfies AuthenticationResponse);

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/auth/oidc/example/callback?code=test-code&state=link-state"]}>
          <Routes>
            <Route path="/auth/oidc/:provider/callback" element={<OidcCallbackPage />} />
            <Route path="/identity/link/:attemptId" element={<p>Account link continuation</p>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText("Account link continuation")).toBeInTheDocument();
    expect(mocks.acceptAuthentication).not.toHaveBeenCalled();
    expect(mocks.fetchSettings).not.toHaveBeenCalled();
    expect(mocks.workspaceAccess).not.toHaveBeenCalled();
  });

  it("does not request workspace access after OIDC login on an Admin-only runtime", async () => {
    mocks.runtimeSurfaces = {
      admin: true,
      ceph_admin: false,
      storage_ops: false,
      manager: false,
      portal: false,
      browser: false,
    };
    mocks.fetchSettings.mockResolvedValue({});
    mocks.completeLogin.mockResolvedValue({
      status: "authenticated",
      user: { id: 1, email: "admin@example.com", role: "ui_admin" },
    } as AuthenticationResponse);

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/auth/oidc/example/callback?code=test-code&state=admin-only-state"]}>
          <Routes>
            <Route path="/auth/oidc/:provider/callback" element={<OidcCallbackPage />} />
            <Route path="/browser" element={<p>Browser destination</p>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText("Browser destination")).toBeInTheDocument();
    expect(mocks.workspaceAccess).not.toHaveBeenCalled();
  });

  it("does not log expected OIDC callback denials as application errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.completeLogin.mockRejectedValue(new ApiError("Request failed", {
      response: { status: 403, data: { detail: "Forbidden" }, headers: {} },
    }));

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/auth/oidc/example/callback?code=test-code&state=denied-state"]}>
          <Routes>
            <Route path="/auth/oidc/:provider/callback" element={<OidcCallbackPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText("Unable to complete the sign-in. Please try again.")).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("still logs unexpected OIDC callback failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new ApiError("Request failed", {
      response: { status: 503, data: { detail: "Unavailable" }, headers: {} },
    });
    mocks.completeLogin.mockRejectedValue(failure);

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/auth/oidc/example/callback?code=test-code&state=unavailable-state"]}>
          <Routes>
            <Route path="/auth/oidc/:provider/callback" element={<OidcCallbackPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText("Unable to complete the sign-in. Please try again.")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(failure);
    consoleError.mockRestore();
  });
});
