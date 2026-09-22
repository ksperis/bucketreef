import { transferableAbortController } from "node:util";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import AuthProviderPage from "./settings/AuthProviderPage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUserCache } from "../../utils/workspaces";
import type { AppSettings } from "../../api/appSettings";
import type {
  LdapProviderAdminItem,
  LdapProviderAdminPayload,
  OidcProviderAdminItem,
  OidcProviderAdminPayload,
} from "../../api/authSettings";
import { ApiError } from "../../api/client";
import AuthenticationSettingsPage from "./AuthenticationSettingsPage";

const setGeneralSettingsMock = vi.fn();
const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();
const fetchOidcAdminProvidersMock = vi.fn<() => Promise<OidcProviderAdminItem[]>>();
const createOidcAdminProviderMock = vi.fn<(payload: OidcProviderAdminPayload) => Promise<OidcProviderAdminItem>>();
const updateOidcAdminProviderMock = vi.fn<
  (providerId: string, payload: OidcProviderAdminPayload) => Promise<OidcProviderAdminItem>
>();
const deleteOidcAdminProviderMock = vi.fn<(providerId: string) => Promise<void>>();
const fetchLdapAdminProvidersMock = vi.fn<() => Promise<LdapProviderAdminItem[]>>();
const createLdapAdminProviderMock = vi.fn<(payload: LdapProviderAdminPayload) => Promise<LdapProviderAdminItem>>();
const updateLdapAdminProviderMock = vi.fn<
  (providerId: string, payload: LdapProviderAdminPayload) => Promise<LdapProviderAdminItem>
>();
const deleteLdapAdminProviderMock = vi.fn<(providerId: string) => Promise<void>>();
const beginRecentWebAuthnVerificationMock = vi.fn();
const finishRecentWebAuthnVerificationMock = vi.fn();
const authenticatePasskeyMock = vi.fn();

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    setGeneralSettings: setGeneralSettingsMock,
  }),
}));

vi.mock("../../api/appSettings", () => ({
  fetchAppSettings: () => fetchAppSettingsMock(),
  fetchDefaultAppSettings: () => fetchDefaultAppSettingsMock(),
  updateAppSettings: (payload: AppSettings) => updateAppSettingsMock(payload),
}));

vi.mock("../../api/authSettings", () => ({
  fetchOidcAdminProviders: () => fetchOidcAdminProvidersMock(),
  createOidcAdminProvider: (payload: OidcProviderAdminPayload) => createOidcAdminProviderMock(payload),
  updateOidcAdminProvider: (providerId: string, payload: OidcProviderAdminPayload) =>
    updateOidcAdminProviderMock(providerId, payload),
  deleteOidcAdminProvider: (providerId: string) => deleteOidcAdminProviderMock(providerId),
  fetchLdapAdminProviders: () => fetchLdapAdminProvidersMock(),
  createLdapAdminProvider: (payload: LdapProviderAdminPayload) => createLdapAdminProviderMock(payload),
  updateLdapAdminProvider: (providerId: string, payload: LdapProviderAdminPayload) =>
    updateLdapAdminProviderMock(providerId, payload),
  deleteLdapAdminProvider: (providerId: string) => deleteLdapAdminProviderMock(providerId),
}));

vi.mock("../../api/security", () => ({
  beginRecentWebAuthnVerification: (...args: unknown[]) => beginRecentWebAuthnVerificationMock(...args),
  finishRecentWebAuthnVerification: (...args: unknown[]) => finishRecentWebAuthnVerificationMock(...args),
}));

vi.mock("../../auth/webauthn", () => ({
  authenticatePasskey: (...args: unknown[]) => authenticatePasskeyMock(...args),
}));

function recentWebAuthnRequiredError() {
  return new ApiError("Request failed", {
    response: {
      status: 403,
      data: { detail: "Recent WebAuthn verification required" },
      headers: {},
    },
  });
}

function buildSettings(): AppSettings {
  return {
    general: {
      manager_enabled: true,
      ceph_admin_enabled: false,
      storage_ops_enabled: false,
      browser_enabled: true,
      browser_root_enabled: true,
      browser_manager_enabled: false,
      browser_portal_enabled: true,
      browser_ceph_admin_enabled: true,
      portal_enabled: true,
      billing_enabled: false,
      endpoint_status_enabled: false,
      quota_alerts_enabled: false,
      usage_history_enabled: false,
      bucket_migration_enabled: true,
      bucket_purge_enabled: false,
      bucket_compare_enabled: true,
      bucket_integrity_check_enabled: false,
      bucket_usage_stats_enabled: true,
      bucket_quota_management_enabled: true,
      manager_ceph_s3_user_keys_enabled: false,
      allow_login_access_keys: false,
      allow_login_endpoint_list: false,
      allow_login_custom_endpoint: false,
      require_passkey_for_admins: true,
      require_passkey_for_users: false,
      allow_user_profile_name_edit: false,
      allow_user_external_identity_unlink: false,
    },
    manager: {
      manager_rgw_usage_metrics_enabled: true,
      bucket_migration_parallelism_default: 8,
      bucket_migration_parallelism_max: 16,
      bucket_migration_max_active_per_endpoint: 2,
    },
    quota_notifications: {
      threshold_percent: 85,
      include_subject_contact_email: false,
      smtp_host: null,
      smtp_port: 587,
      smtp_username: null,
      smtp_from_email: null,
      smtp_from_name: null,
      smtp_starttls: true,
      smtp_timeout_seconds: 15,
    },
    browser: {
      allow_proxy_transfers: true,
      direct_upload_parallelism: 5,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 5,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 3,
      streaming_zip_threshold_mb: 200,
    },
    onboarding: {
      dismissed: false,
    },
    branding: {
      primary_color: "#0569f8",
      login_logo_url: null,
    },
  };
}

function buildOidcProvider(overrides: Partial<OidcProviderAdminItem> = {}): OidcProviderAdminItem {
  return {
    provider_id: "ui",
    display_name: "UI Provider",
    discovery_url: "https://issuer.example.test/.well-known/openid-configuration",
    client_id: "client-id",
    redirect_uri: "https://app.example.test/auth/callback",
    scopes: ["openid", "email", "profile"],
    prompt: null,
    enabled: true,
    icon_url: null,
    use_pkce: true,
    use_nonce: true,
    linking_policy: "manual",
    trusted_email_domains: [],
    source: "ui",
    editable: true,
    field_locks: {},
    has_client_secret: false,
    ...overrides,
  };
}

function buildEnvOidcProvider(): OidcProviderAdminItem {
  const field_locks = Object.fromEntries(
    [
      "provider_id",
      "display_name",
      "discovery_url",
      "client_id",
      "redirect_uri",
      "scopes",
      "prompt",
      "enabled",
      "icon_url",
      "use_pkce",
      "use_nonce",
      "linking_policy",
      "trusted_email_domains",
      "client_secret",
    ].map((field) => [field, { forced: true, source: `OIDC_PROVIDERS__GOOGLE__${field.toUpperCase()}` }])
  );
  return buildOidcProvider({
    provider_id: "google",
    display_name: "Google",
    source: "environment",
    editable: false,
    field_locks,
    has_client_secret: true,
  });
}

function buildLdapProvider(overrides: Partial<LdapProviderAdminItem> = {}): LdapProviderAdminItem {
  return {
    provider_id: "corp",
    display_name: "Corporate LDAP",
    url: "ldaps://ldap.example.test",
    bind_dn: "cn=bucketreef,ou=svc,dc=example,dc=test",
    user_base_dn: "ou=people,dc=example,dc=test",
    user_filter: "(uid={username})",
    email_attribute: "mail",
    name_attribute: "displayName",
    subject_attribute: null,
    start_tls: false,
    tls_verify: true,
    tls_ca_file: null,
    allow_legacy_tls: false,
    timeout_seconds: 5,
    enabled: true,
    allow_insecure: false,
    allow_email_linking: false,
    source: "ui",
    editable: true,
    field_locks: {},
    has_bind_password: false,
    ...overrides,
  };
}

function buildEnvLdapProvider(): LdapProviderAdminItem {
  const field_locks = Object.fromEntries(
    [
      "provider_id",
      "display_name",
      "url",
      "bind_dn",
      "bind_password",
      "user_base_dn",
      "user_filter",
      "email_attribute",
      "name_attribute",
      "subject_attribute",
      "start_tls",
      "tls_verify",
      "tls_ca_file",
      "allow_legacy_tls",
      "timeout_seconds",
      "enabled",
      "allow_insecure",
      "allow_email_linking",
    ].map((field) => [field, { forced: true, source: `LDAP_PROVIDERS__CORP__${field.toUpperCase()}` }])
  );
  return buildLdapProvider({
    source: "environment",
    editable: false,
    field_locks,
    has_bind_password: true,
  });
}

function firstButton(name: string): HTMLElement {
  const buttons = screen.getAllByRole("button", { name });
  const button = buttons[0];
  if (!button) {
    throw new Error(`Unable to find button ${name}`);
  }
  return button;
}

function renderPage(initialEntries = ["/admin/authentication-settings"]) {
  const router = createMemoryRouter([
    { path: "/admin", element: <h1>Admin destination</h1> },
    { path: "/admin/authentication-settings", element: <AuthenticationSettingsPage /> },
    ...(["oidc", "ldap"] as const).flatMap(kind => [
      { path: `/admin/authentication-settings/${kind}/new`, element: <AuthProviderPage kind={kind} /> },
      { path: `/admin/authentication-settings/${kind}/providers/:providerId`, element: <AuthProviderPage kind={kind} /> },
    ]),
  ], { initialEntries, initialIndex: initialEntries.length - 1 });
  render(<RouterProvider router={router} />);
  return router;
}

describe("AuthenticationSettingsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setSessionUserCache(null);
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    fetchAppSettingsMock.mockResolvedValue(buildSettings());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
    fetchOidcAdminProvidersMock.mockResolvedValue([]);
    fetchLdapAdminProvidersMock.mockResolvedValue([]);
    createOidcAdminProviderMock.mockImplementation(async (payload: OidcProviderAdminPayload) =>
      buildOidcProvider({
        provider_id: payload.provider_id,
        display_name: payload.display_name,
        has_client_secret: Boolean(payload.client_secret),
      })
    );
    updateOidcAdminProviderMock.mockImplementation(async (_providerId, payload: OidcProviderAdminPayload) =>
      buildOidcProvider({
        provider_id: payload.provider_id,
        display_name: payload.display_name,
        has_client_secret: Boolean(payload.client_secret),
      })
    );
    deleteOidcAdminProviderMock.mockResolvedValue();
    createLdapAdminProviderMock.mockImplementation(async (payload: LdapProviderAdminPayload) =>
      buildLdapProvider({
        provider_id: payload.provider_id,
        display_name: payload.display_name,
        has_bind_password: Boolean(payload.bind_password),
      })
    );
    updateLdapAdminProviderMock.mockImplementation(async (_providerId, payload: LdapProviderAdminPayload) =>
      buildLdapProvider({
        provider_id: payload.provider_id,
        display_name: payload.display_name,
        has_bind_password: Boolean(payload.bind_password),
      })
    );
    deleteLdapAdminProviderMock.mockResolvedValue();
    beginRecentWebAuthnVerificationMock.mockResolvedValue({ challenge: "challenge" });
    authenticatePasskeyMock.mockResolvedValue({ id: "credential" });
    finishRecentWebAuthnVerificationMock.mockResolvedValue({ mfa_verified_at: "2026-09-02T10:00:00Z" });
  });

  afterEach(() => { vi.unstubAllGlobals(); setSessionUserCache(null); });

  it("renders the authentication toggles", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Authentication settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Access-key login")).toBeInTheDocument();
    expect(screen.getByLabelText("Access-key endpoint list")).toBeInTheDocument();
    expect(screen.getByLabelText("Custom login endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("Require passkeys for administrators")).toBeChecked();
    expect(screen.getByLabelText("Require passkeys for standard users")).not.toBeChecked();
    expect(screen.getByLabelText("Allow users to edit their profile name")).not.toBeChecked();
    expect(screen.getByLabelText("Allow users to unlink external identities")).not.toBeChecked();
    expect(screen.queryByLabelText("Private S3 connections for UI users")).not.toBeInTheDocument();
  });

  it("warns explicitly before disabling required administrator passkeys", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByLabelText("Require passkeys for administrators"));

    const dialog = screen.getByRole("dialog", { name: "Disable required admin passkeys?" });
    expect(within(dialog).getByText(/weakens protection for every administrator account/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Disable protection" }));
    expect(screen.getByLabelText("Require passkeys for administrators")).not.toBeChecked();
  });

  it("saves authentication changes and refreshes general settings context", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByLabelText("Access-key login"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.allow_login_access_keys).toBe(true);
    expect(payload.general).not.toHaveProperty("allow_user_private_connections");
    expect(setGeneralSettingsMock).toHaveBeenLastCalledWith(payload.general);
  });

  it("preserves the settings draft and retries the save once after step-up", async () => {
    const user = userEvent.setup();
    updateAppSettingsMock
      .mockRejectedValueOnce(recentWebAuthnRequiredError())
      .mockImplementationOnce(async (payload: AppSettings) => payload);
    renderPage();

    await user.click(await screen.findByLabelText("Access-key login"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    expect(screen.getByLabelText("Access-key login")).toBeChecked();
    await user.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledTimes(2));
    expect(beginRecentWebAuthnVerificationMock).toHaveBeenCalledOnce();
    expect(screen.getByText("Settings saved.")).toBeInTheDocument();
  });

  it("explains custom endpoint restrictions and requires access-key login", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByLabelText("Custom login endpoint")).toBeDisabled();
    expect(screen.getByText(/Public HTTPS targets only/)).toBeInTheDocument();
    await user.click(screen.getByLabelText("Access-key login"));
    await user.click(screen.getByLabelText("Custom login endpoint"));
    expect(screen.getByLabelText("Custom login endpoint")).toBeChecked();
  });

  it("resets only authentication fields to defaults", async () => {
    const user = userEvent.setup();
    const initialSettings = buildSettings();
    initialSettings.general.manager_enabled = false;
    initialSettings.branding.primary_color = "#2563eb";
    const defaultSettings = buildSettings();
    defaultSettings.general.allow_login_access_keys = true;
    defaultSettings.general.allow_login_endpoint_list = true;
    defaultSettings.general.allow_login_custom_endpoint = true;
    defaultSettings.general.manager_enabled = true;
    defaultSettings.branding.primary_color = "#dc2626";
    fetchAppSettingsMock.mockResolvedValue(initialSettings);
    fetchDefaultAppSettingsMock.mockResolvedValueOnce(defaultSettings);

    renderPage();

    await screen.findByLabelText("Access-key login");
    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(fetchDefaultAppSettingsMock).not.toHaveBeenCalled();
    const resetDialog = screen.getByRole("dialog", { name: "Reset authentication settings draft?" });
    await user.click(within(resetDialog).getByRole("button", { name: "Load defaults" }));
    await waitFor(() => {
      expect(fetchDefaultAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.allow_login_access_keys).toBe(true);
    expect(payload.general.allow_login_endpoint_list).toBe(true);
    expect(payload.general.allow_login_custom_endpoint).toBe(true);
    expect(payload.general.manager_enabled).toBe(false);
    expect(payload.branding.primary_color).toBe("#2563eb");
  });

  it("renders OIDC providers with source and status badges", async () => {
    fetchOidcAdminProvidersMock.mockResolvedValueOnce([
      buildEnvOidcProvider(),
      buildOidcProvider({ provider_id: "ui", display_name: "UI Provider" }),
    ]);

    renderPage();

    expect(await screen.findByText("OIDC providers")).toBeInTheDocument();
    expect(screen.getAllByText("Google").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UI Provider").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Environment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enabled").length).toBeGreaterThanOrEqual(2);
  });

  it("shows environment providers as locked read-only fields", async () => {
    const user = userEvent.setup();
    fetchOidcAdminProvidersMock.mockResolvedValue([buildEnvOidcProvider()]);

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "View OIDC provider google" }).length).toBeGreaterThan(0);
    });
    await user.click(firstButton("View OIDC provider google"));

    expect(await screen.findByRole("heading", { name: "View OIDC provider" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByLabelText("Client secret")).toHaveTextContent("Stored — value hidden");
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText("Forced by OIDC_PROVIDERS__GOOGLE__DISPLAY_NAME.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save OIDC provider" })).not.toBeInTheDocument();
  });

  it("creates an OIDC provider with a write-only client secret", async () => {
    const user = userEvent.setup();
    fetchOidcAdminProvidersMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      buildOidcProvider({ provider_id: "google", display_name: "Google", has_client_secret: true }),
    ]);

    renderPage();

    await screen.findByText("OIDC providers");
    await user.click(screen.getByRole("button", { name: "Add OIDC provider" }));
    await user.type(screen.getByLabelText("Provider ID"), "google");
    await user.type(screen.getByLabelText("Display name"), "Google");
    await user.type(
      screen.getByLabelText("Discovery URL"),
      "https://issuer.example.test/.well-known/openid-configuration"
    );
    await user.type(screen.getByLabelText("Client ID"), "client-id");
    await user.type(screen.getByLabelText("Redirect URI"), "https://app.example.test/auth/callback");
    await user.type(screen.getByLabelText("Client secret"), "super-secret");
    await user.selectOptions(screen.getByLabelText("Identity linking policy"), "trusted_email");
    await user.type(screen.getByLabelText("Trusted email domains"), "Example.COM\ncorp.example.com");
    await user.click(screen.getByRole("button", { name: "Save OIDC provider" }));

    await waitFor(() => {
      expect(createOidcAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    const payload = createOidcAdminProviderMock.mock.calls[0][0];
    expect(payload.provider_id).toBe("google");
    expect(payload.client_secret).toBe("super-secret");
    expect(payload.scopes).toEqual(["openid", "email", "profile"]);
    expect(payload.linking_policy).toBe("trusted_email");
    expect(payload.trusted_email_domains).toEqual(["example.com", "corp.example.com"]);
    expect(screen.queryByDisplayValue("super-secret")).not.toBeInTheDocument();
  });

  it("edits an OIDC provider while preserving a blank client secret", async () => {
    const user = userEvent.setup();
    const provider = buildOidcProvider({ has_client_secret: true });
    fetchOidcAdminProvidersMock.mockResolvedValue([provider]);

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Edit OIDC provider ui" }).length).toBeGreaterThan(0);
    });
    await user.click(firstButton("Edit OIDC provider ui"));
    const displayName = await screen.findByLabelText("Display name");
    await user.clear(displayName);
    await user.type(displayName, "Updated Provider");
    expect(screen.getByLabelText("Client secret")).toHaveAccessibleDescription("A secret is stored. Leave this field empty to keep it.");
    expect(screen.getByLabelText("Client secret")).not.toHaveAttribute("placeholder");
    await user.click(screen.getByRole("button", { name: "Save OIDC provider" }));

    await waitFor(() => {
      expect(updateOidcAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    expect(updateOidcAdminProviderMock.mock.calls[0][0]).toBe("ui");
    expect(updateOidcAdminProviderMock.mock.calls[0][1].display_name).toBe("Updated Provider");
    expect(updateOidcAdminProviderMock.mock.calls[0][1].client_secret).toBeNull();
    expect(updateOidcAdminProviderMock.mock.calls[0][1].clear_client_secret).toBe(false);
  });

  it("deletes only UI-managed OIDC providers", async () => {
    const user = userEvent.setup();
    fetchOidcAdminProvidersMock.mockResolvedValueOnce([
      buildEnvOidcProvider(),
      buildOidcProvider({ provider_id: "ui", display_name: "UI Provider" }),
    ]).mockResolvedValueOnce([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText("Google").length).toBeGreaterThan(0);
    });
    const googleRow = screen.getAllByText("Google")[0].closest(".settings-item-compact") as HTMLElement;
    const uiProviderRow = screen.getAllByText("UI Provider")[0].closest(".settings-item-compact") as HTMLElement;
    expect(within(googleRow).queryByRole("button", { name: "Delete OIDC provider google" })).toBeNull();
    await user.click(within(uiProviderRow).getByRole("button", { name: "Delete OIDC provider ui" }));
    expect(deleteOidcAdminProviderMock).not.toHaveBeenCalled();
    const deleteDialog = screen.getByRole("dialog", { name: "Delete OIDC provider?" });
    await user.click(within(deleteDialog).getByRole("button", { name: "Delete provider" }));

    await waitFor(() => {
      expect(deleteOidcAdminProviderMock).toHaveBeenCalledWith("ui");
    });
  });

  it("renders LDAP providers with source and status badges", async () => {
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([
      buildEnvLdapProvider(),
      buildLdapProvider({ provider_id: "ui-ldap", display_name: "UI LDAP" }),
    ]);

    renderPage();

    expect(await screen.findByText("LDAP providers")).toBeInTheDocument();
    expect(screen.getAllByText("Corporate LDAP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UI LDAP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Environment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enabled").length).toBeGreaterThanOrEqual(2);
  });

  it("shows environment LDAP providers as locked read-only fields", async () => {
    const user = userEvent.setup();
    fetchLdapAdminProvidersMock.mockResolvedValue([buildEnvLdapProvider()]);

    renderPage();

    await screen.findByText("LDAP providers");
    await user.click(screen.getAllByRole("button", { name: "View LDAP provider corp" })[0]);

    expect(await screen.findByRole("heading", { name: "View LDAP provider" })).toBeInTheDocument();
    expect(screen.getByLabelText("LDAP Display name")).toBeDisabled();
    expect(screen.getByLabelText("LDAP Bind password")).toHaveTextContent("Stored — value hidden");
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText("Forced by LDAP_PROVIDERS__CORP__URL.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save LDAP provider" })).not.toBeInTheDocument();
  });

  it("creates an LDAP provider with a write-only bind password", async () => {
    const user = userEvent.setup();
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      buildLdapProvider({ provider_id: "corp", display_name: "Corporate LDAP", has_bind_password: true }),
    ]);

    renderPage();

    await screen.findByText("LDAP providers");
    await user.click(screen.getByRole("button", { name: "Add LDAP provider" }));
    await user.type(screen.getByLabelText("LDAP Provider ID"), "corp");
    await user.type(screen.getByLabelText("LDAP Display name"), "Corporate LDAP");
    const urlInput = screen.getByLabelText("LDAP URL");
    await user.clear(urlInput);
    await user.type(urlInput, "ldaps://ldap.example.test");
    await user.type(screen.getByLabelText("LDAP Bind DN"), "cn=bucketreef,ou=svc,dc=example,dc=test");
    await user.type(screen.getByLabelText("LDAP Bind password"), "ldap-secret");
    await user.type(screen.getByLabelText("LDAP User base DN"), "ou=people,dc=example,dc=test");
    await user.click(screen.getByRole("button", { name: "Save LDAP provider" }));

    await waitFor(() => {
      expect(createLdapAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    const payload = createLdapAdminProviderMock.mock.calls[0][0];
    expect(payload.provider_id).toBe("corp");
    expect(payload.bind_password).toBe("ldap-secret");
    expect(payload.url).toBe("ldaps://ldap.example.test");
    expect(screen.queryByDisplayValue("ldap-secret")).not.toBeInTheDocument();
  });

  it("creates an LDAP provider without bind credentials for anonymous search", async () => {
    const user = userEvent.setup();
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      buildLdapProvider({ bind_dn: null, has_bind_password: false }),
    ]);

    renderPage();

    await screen.findByText("LDAP providers");
    await user.click(screen.getByRole("button", { name: "Add LDAP provider" }));
    await user.type(screen.getByLabelText("LDAP Provider ID"), "anonymous");
    await user.type(screen.getByLabelText("LDAP Display name"), "Anonymous LDAP");
    const urlInput = screen.getByLabelText("LDAP URL");
    await user.clear(urlInput);
    await user.type(urlInput, "ldaps://ldap.example.test");
    await user.type(screen.getByLabelText("LDAP User base DN"), "ou=people,dc=example,dc=test");
    await user.click(screen.getByLabelText("Allow legacy LDAP TLS ciphers"));

    expect(screen.getByText(/search the directory anonymously/i)).toBeInTheDocument();
    expect(screen.getByText(/Prefer enabling modern ECDHE/i)).toBeInTheDocument();
    expect(screen.getByLabelText("LDAP Bind DN")).not.toBeRequired();
    expect(screen.getByLabelText("LDAP Bind password")).not.toBeRequired();
    await user.click(screen.getByRole("button", { name: "Save LDAP provider" }));

    await waitFor(() => {
      expect(createLdapAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    const payload = createLdapAdminProviderMock.mock.calls[0][0];
    expect(payload.bind_dn).toBeNull();
    expect(payload.bind_password).toBeNull();
    expect(payload.clear_bind_password).toBe(true);
    expect(payload.allow_legacy_tls).toBe(true);
  });

  it("edits an LDAP provider while preserving a blank bind password", async () => {
    const user = userEvent.setup();
    const provider = buildLdapProvider({ has_bind_password: true });
    fetchLdapAdminProvidersMock.mockResolvedValue([provider]);

    renderPage();

    await screen.findByText("LDAP providers");
    await user.click(screen.getAllByRole("button", { name: "Edit LDAP provider corp" })[0]);
    const displayName = await screen.findByLabelText("LDAP Display name");
    await user.clear(displayName);
    await user.type(displayName, "Updated LDAP");
    expect(screen.getByLabelText("LDAP Bind password")).toHaveAccessibleDescription("A secret is stored. Leave this field empty to keep it.");
    expect(screen.getByLabelText("LDAP Bind password")).not.toHaveAttribute("placeholder");
    await user.click(screen.getByRole("button", { name: "Save LDAP provider" }));

    await waitFor(() => {
      expect(updateLdapAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    expect(updateLdapAdminProviderMock.mock.calls[0][0]).toBe("corp");
    expect(updateLdapAdminProviderMock.mock.calls[0][1].display_name).toBe("Updated LDAP");
    expect(updateLdapAdminProviderMock.mock.calls[0][1].bind_password).toBeNull();
  });

  it("deletes only UI-managed LDAP providers", async () => {
    const user = userEvent.setup();
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([
      buildEnvLdapProvider(),
      buildLdapProvider({ provider_id: "ui-ldap", display_name: "UI LDAP" }),
    ]).mockResolvedValueOnce([]);

    renderPage();

    await screen.findByText("LDAP providers");
    expect(
      within(screen.getAllByText("Corporate LDAP")[0].closest(".settings-item-compact") as HTMLElement).queryByRole("button", {
        name: "Delete LDAP provider corp",
      })
    ).toBeNull();
    await user.click(
      within(screen.getAllByText("UI LDAP")[0].closest(".settings-item-compact") as HTMLElement).getByRole("button", {
        name: "Delete LDAP provider ui-ldap",
      })
    );
    expect(deleteLdapAdminProviderMock).not.toHaveBeenCalled();
    const deleteDialog = screen.getByRole("dialog", { name: "Delete LDAP provider?" });
    await user.click(within(deleteDialog).getByRole("button", { name: "Delete provider" }));

    await waitFor(() => {
      expect(deleteLdapAdminProviderMock).toHaveBeenCalledWith("ui-ldap");
    });
  });
  it("validates an OIDC draft beside required fields before saving", async () => {
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole("button", { name: "Add OIDC provider" }));
    await user.type(screen.getByLabelText("Provider ID"), "draft");
    await user.click(screen.getByRole("button", { name: "Save OIDC provider" }));
    expect(screen.getByLabelText("Display name")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("Display name")).toHaveFocus());
    expect(createOidcAdminProviderMock).not.toHaveBeenCalled();
  });
  it("keeps provider secrets and draft after cancelled WebAuthn, without saving global policy", async () => {
    const user = userEvent.setup();
    fetchOidcAdminProvidersMock.mockResolvedValue([buildOidcProvider({ has_client_secret: true, field_locks: { client_id: { forced: true, source: "ENV_CLIENT_ID" } } })]);
    updateOidcAdminProviderMock.mockRejectedValueOnce(recentWebAuthnRequiredError());
    renderPage(); await user.click(await screen.findByRole("button", { name: "Edit OIDC provider ui" }));
    expect(await screen.findByLabelText("Client ID")).toBeDisabled();
    await user.clear(screen.getByLabelText("Display name")); await user.type(screen.getByLabelText("Display name"), "Pending provider");
    await user.click(screen.getByRole("button", { name: "Save OIDC provider" }));
    const verify = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(verify).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Display name")).toHaveValue("Pending provider");
    expect(screen.getByLabelText("Client secret")).toHaveValue("");
    expect(updateOidcAdminProviderMock).toHaveBeenCalledOnce(); expect(updateAppSettingsMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back to authentication" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("heading", { name: "Authentication settings" })).toBeInTheDocument();
  });

  it.each([
    { kind: "oidc", id: "ui", name: "Display name", secret: "Client secret" },
    { kind: "ldap", id: "corp", name: "LDAP Display name", secret: "LDAP Bind password" },
  ])("locks $kind submission by Enter and navigation until a failed save can be retried", async ({ kind, id, name, secret }) => {
    const user = userEvent.setup();
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    fetchOidcAdminProvidersMock.mockResolvedValue([buildOidcProvider({ has_client_secret: true })]);
    fetchLdapAdminProvidersMock.mockResolvedValue([buildLdapProvider({ has_bind_password: true })]);
    let reject!: (error: Error) => void;
    const operation = new Promise<never>((_resolve, fail) => { reject = fail; });
    const saveMock = kind === "oidc" ? updateOidcAdminProviderMock : updateLdapAdminProviderMock;
    saveMock.mockImplementationOnce(() => operation);
    const path = `/admin/authentication-settings/${kind}/providers/${id}`;
    const router = renderPage([path]);
    const nameField = await screen.findByLabelText(name);
    await user.clear(nameField);
    await user.type(screen.getByLabelText(secret), "replacement-fixture");
    await user.type(nameField, "Retained draft{Enter}");
    const form = screen.getByRole("form", { name: `${kind.toUpperCase()} provider configuration` });
    fireEvent.submit(form);
    expect(saveMock).toHaveBeenCalledOnce();
    expect(nameField).toBeDisabled();
    expect(screen.getByLabelText(secret)).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Enabled", exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to authentication" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Admin", exact: true }));
    const busyDialog = screen.getByRole("dialog", { name: "Operation in progress" });
    expect(within(busyDialog).getByRole("button", { name: "Discard changes" })).toBeDisabled();
    await user.click(within(busyDialog).getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe(path);
    await act(async () => reject(new Error("Provider write failed")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider write failed");
    expect(nameField).toHaveValue("Retained draft");
    expect(screen.getByLabelText(secret)).toHaveValue("replacement-fixture");
    expect(nameField).toBeEnabled();
    await user.click(screen.getByRole("button", { name: `Save ${kind.toUpperCase()} provider` }));
    await screen.findByRole("heading", { name: "Authentication settings" });
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1][0]).toBe(id);
    expect(updateAppSettingsMock).not.toHaveBeenCalled();
    router.dispose();
  });

  it("keeps the provider draft on cancelled navigation and preserves history destinations on discard", async () => {
    const user = userEvent.setup();
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    fetchOidcAdminProvidersMock.mockResolvedValue([buildOidcProvider(), buildOidcProvider({ provider_id: "second", display_name: "Second" })]);
    const path = "/admin/authentication-settings/oidc/providers/ui";
    const router = renderPage(["/admin", path]);
    await user.type(await screen.findByLabelText("Display name"), " changed");
    await act(async () => { await router.navigate("/admin/authentication-settings/oidc/providers/second"); });
    expect(screen.getByLabelText("Display name")).toHaveValue("UI Provider changed");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe(path);
    await act(async () => { await router.navigate(-1); });
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("heading", { name: "Admin destination" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/admin");
    expect(updateOidcAdminProviderMock).not.toHaveBeenCalled();
    router.dispose();
  });

  it("retries provider loading without offering an empty editable configuration", async () => {
    fetchLdapAdminProvidersMock.mockRejectedValueOnce(new Error("Directory configuration unavailable"))
      .mockResolvedValueOnce([buildLdapProvider()]);
    renderPage(["/admin/authentication-settings/ldap/providers/corp"]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Directory configuration unavailable");
    expect(screen.queryByLabelText("LDAP Provider ID")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save LDAP provider" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("LDAP Display name")).toHaveValue("Corporate LDAP");
    expect(screen.getByRole("button", { name: "Save LDAP provider" })).toBeDisabled();
    expect(fetchLdapAdminProvidersMock).toHaveBeenCalledTimes(2);
  });

  it("locks all provider controls through explicit passkey verification and retries the same draft once", async () => {
    const user = userEvent.setup();
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    fetchOidcAdminProvidersMock.mockResolvedValue([buildOidcProvider()]);
    updateOidcAdminProviderMock.mockRejectedValueOnce(recentWebAuthnRequiredError());
    let finish!: (value: { mfa_verified_at: string }) => void;
    finishRecentWebAuthnVerificationMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage(["/admin/authentication-settings/oidc/providers/ui"]);
    await user.type(await screen.findByLabelText("Display name"), " verified");
    await user.click(screen.getByRole("button", { name: "Save OIDC provider" }));
    const prompt = await screen.findByRole("dialog", { name: "Verify with passkey" });
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to authentication" })).toBeDisabled();
    expect(beginRecentWebAuthnVerificationMock).not.toHaveBeenCalled();
    await user.click(within(prompt).getByRole("button", { name: "Verify with passkey" }));
    await waitFor(() => expect(finishRecentWebAuthnVerificationMock).toHaveBeenCalledOnce());
    expect(within(prompt).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "OIDC provider configuration" }));
    expect(updateOidcAdminProviderMock).toHaveBeenCalledOnce();
    await act(async () => finish({ mfa_verified_at: "2026-09-21T20:00:00Z" }));
    await screen.findByRole("heading", { name: "Authentication settings" });
    expect(updateOidcAdminProviderMock).toHaveBeenCalledTimes(2);
    expect(updateOidcAdminProviderMock.mock.calls[1]).toEqual(updateOidcAdminProviderMock.mock.calls[0]);
    expect(updateAppSettingsMock).not.toHaveBeenCalled();
  });

  it("associates forced switch and textarea hints and prevents clearing a locked secret", async () => {
    fetchOidcAdminProvidersMock.mockResolvedValue([buildOidcProvider({ has_client_secret: true, field_locks: {
      scopes: { forced: true, source: "ENV_SCOPES" }, use_pkce: { forced: true, source: "ENV_PKCE" },
      client_secret: { forced: true, source: "ENV_SECRET" },
    } })]);
    renderPage(["/admin/authentication-settings/oidc/providers/ui"]);
    const scopes = await screen.findByLabelText("Scopes");
    expect(scopes).toBeDisabled();
    expect(scopes).toHaveAccessibleDescription("Separate scopes with new lines or commas. Forced by ENV_SCOPES.");
    expect(screen.getByRole("switch", { name: "Use PKCE" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Use PKCE" })).toHaveAccessibleDescription("Forced by ENV_PKCE.");
    expect(screen.getByLabelText("Client secret")).toHaveTextContent("Stored — value hidden");
    expect(screen.queryByRole("checkbox", { name: "Clear stored client secret" })).not.toBeInTheDocument();
  });

  it("validates the LDAP timeout against the server maximum and focuses its field", async () => {
    fetchLdapAdminProvidersMock.mockResolvedValue([buildLdapProvider()]);
    renderPage(["/admin/authentication-settings/ldap/providers/corp"]);
    const timeout = await screen.findByLabelText("LDAP Timeout seconds");
    fireEvent.change(timeout, { target: { value: "61" } });
    fireEvent.submit(screen.getByRole("form", { name: "LDAP provider configuration" }));
    await waitFor(() => expect(timeout).toHaveFocus());
    expect(timeout).toHaveAccessibleDescription("Timeout must be greater than zero and no more than 60 seconds.");
    expect(updateLdapAdminProviderMock).not.toHaveBeenCalled();
    fireEvent.change(timeout, { target: { value: "60" } });
    fireEvent.submit(screen.getByRole("form", { name: "LDAP provider configuration" }));
    await waitFor(() => expect(updateLdapAdminProviderMock).toHaveBeenCalledOnce());
    expect(updateLdapAdminProviderMock.mock.calls[0][1].timeout_seconds).toBe(60);
  });
});
