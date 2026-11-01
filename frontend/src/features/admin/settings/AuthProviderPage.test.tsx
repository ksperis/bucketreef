import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../api/client";
import { ThemeProvider } from "../../../components/theme";
import AuthProviderPage from "./AuthProviderPage";

const mocks = vi.hoisted(() => ({
  fetchOidc: vi.fn(),
  createOidc: vi.fn(),
  updateOidc: vi.fn(),
  fetchLdap: vi.fn(),
  createLdap: vi.fn(),
  updateLdap: vi.fn(),
}));

vi.mock("../../../api/authSettings", () => ({
  fetchOidcAdminProviders: (...args: unknown[]) => mocks.fetchOidc(...args),
  createOidcAdminProvider: (...args: unknown[]) => mocks.createOidc(...args),
  updateOidcAdminProvider: (...args: unknown[]) => mocks.updateOidc(...args),
  fetchLdapAdminProviders: (...args: unknown[]) => mocks.fetchLdap(...args),
  createLdapAdminProvider: (...args: unknown[]) => mocks.createLdap(...args),
  updateLdapAdminProvider: (...args: unknown[]) => mocks.updateLdap(...args),
}));

vi.mock("../../../auth/useRecentWebAuthnStepUp", () => ({
  isRecentWebAuthnVerificationCancelled: () => false,
  useRecentWebAuthnStepUp: () => ({
    runWithStepUp: async (operation: () => Promise<unknown>) => operation(),
    verificationDialog: null,
  }),
}));

const provider = {
  provider_id: "corp",
  display_name: "Corporate OIDC",
  discovery_url: "https://id.example.test/.well-known/openid-configuration",
  client_id: "bucketreef",
  redirect_uri: "https://bucketreef.example.test/auth/oidc/callback",
  scopes: ["openid", "email", "profile"],
  prompt: null,
  enabled: true,
  icon_url: null,
  use_pkce: true,
  use_nonce: true,
  linking_policy: "reauthenticate" as const,
  trusted_email_domains: [],
  source: "ui" as const,
  editable: true,
  field_locks: {},
  has_client_secret: true,
};

function renderPage(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/authentication-settings/oidc/new"
            element={<AuthProviderPage kind="oidc" />}
          />
          <Route
            path="/admin/authentication-settings/oidc/providers/:providerId"
            element={<AuthProviderPage kind="oidc" />}
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("AuthProviderPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOidc.mockResolvedValue([provider]);
  });

  it("does not load the provider catalogue on the create route", async () => {
    renderPage("/admin/authentication-settings/oidc/new");

    expect(await screen.findByRole("heading", { name: "Add OIDC provider" })).toBeInTheDocument();
    expect(mocks.fetchOidc).not.toHaveBeenCalled();
  });

  it("loads the selected provider into the edit form", async () => {
    renderPage("/admin/authentication-settings/oidc/providers/corp");

    expect(await screen.findByRole("heading", { name: "Edit OIDC provider" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Corporate OIDC");
    expect(mocks.fetchOidc).toHaveBeenCalledOnce();
  });

  it("keeps the raw HTTP error classification", async () => {
    mocks.fetchOidc
      .mockRejectedValue(new ApiError("Request failed", {
        response: { status: 403, data: { detail: "Provider access denied." }, headers: {} },
      }));
    renderPage("/admin/authentication-settings/oidc/providers/corp");

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="forbidden"]')).not.toBeNull(),
    );
  });

  it("retries retryable load failures through the shared loader", async () => {
    mocks.fetchOidc
      .mockRejectedValueOnce(new ApiError("Request failed", {
        response: { status: 503, data: {}, headers: {} },
      }))
      .mockResolvedValueOnce([provider]);
    renderPage("/admin/authentication-settings/oidc/providers/corp");

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="unavailable"]')).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Display name")).toHaveValue("Corporate OIDC");
    expect(mocks.fetchOidc).toHaveBeenCalledTimes(2);
  });

  it("shows not found when the provider catalogue has no matching id", async () => {
    mocks.fetchOidc.mockResolvedValue([]);
    renderPage("/admin/authentication-settings/oidc/providers/missing");

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="not_found"]')).not.toBeNull(),
    );
  });
});
