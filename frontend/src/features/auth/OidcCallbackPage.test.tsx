/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationResponse } from "../../api/auth";
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
  runtimeSurfaces: {},
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
});
