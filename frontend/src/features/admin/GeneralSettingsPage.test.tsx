import { createAppSettings } from "./settings/settingsTestFixtures";
import { ThemeProvider } from "../../components/theme";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, GeneralFeatureLocks, QuotaNotificationSettings } from "../../api/appSettings";
import { ApiError } from "../../api/client";
import GeneralSettingsPage from "./GeneralSettingsPage";

const setGeneralSettingsMock = vi.fn();
const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchGeneralFeatureLocksMock = vi.fn<() => Promise<GeneralFeatureLocks>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();
const sendQuotaNotificationTestEmailMock = vi.fn<
  (payload: QuotaNotificationSettings) => Promise<{ recipient: string }>
>();
const applyBrandingMock = vi.fn();
const fetchOnboardingStatusMock = vi.fn();
const resumeOnboardingMock = vi.fn();

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    setGeneralSettings: setGeneralSettingsMock,
  }),
}));

vi.mock("../../api/onboarding", () => ({
  ONBOARDING_STATUS_EVENT: "bucketreef:onboarding-status",
  fetchOnboardingStatus: () => fetchOnboardingStatusMock(),
  resumeOnboarding: () => resumeOnboardingMock(),
}));

vi.mock("../../api/appSettings", () => ({
  fetchAppSettings: () => fetchAppSettingsMock(),
  fetchDefaultAppSettings: () => fetchDefaultAppSettingsMock(),
  fetchGeneralFeatureLocks: () => fetchGeneralFeatureLocksMock(),
  updateAppSettings: (payload: AppSettings) => updateAppSettingsMock(payload),
  sendQuotaNotificationTestEmail: (payload: QuotaNotificationSettings) => sendQuotaNotificationTestEmailMock(payload),
}));

vi.mock("../../components/ui/brandingRuntime", async () => {
  const actual = await vi.importActual<typeof import("../../components/ui/brandingRuntime")>(
    "../../components/ui/brandingRuntime"
  );
  return {
    ...actual,
    applyBranding: (primaryColor: string) => applyBrandingMock(primaryColor),
  };
});

function buildSettings(): AppSettings { return createAppSettings(); }

function unlockedFeatureLocks(): GeneralFeatureLocks {
  return {
    manager_enabled: { forced: false, value: null, source: null },
    openstack_enabled: { forced: false, value: null, source: null },
    ceph_admin_enabled: { forced: false, value: null, source: null },
    storage_ops_enabled: { forced: false, value: null, source: null },
    browser_enabled: { forced: false, value: null, source: null },
    portal_enabled: { forced: false, value: null, source: null },
    cost_enabled: { forced: false, value: null, source: null },
    endpoint_status_enabled: { forced: false, value: null, source: null },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GeneralSettingsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("GeneralSettingsPage branding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const initialSettings = buildSettings();
    fetchAppSettingsMock.mockResolvedValue(initialSettings);
    fetchGeneralFeatureLocksMock.mockResolvedValue(unlockedFeatureLocks());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
    fetchOnboardingStatusMock.mockResolvedValue({
      dismissed: false,
      complete: false,
      journeys: [],
      can_configure: true,
      source: "standard",
    });
    resumeOnboardingMock.mockResolvedValue({
      dismissed: false,
      complete: false,
      journeys: [],
      can_configure: true,
      source: "standard",
    });
    sendQuotaNotificationTestEmailMock.mockResolvedValue({
      recipient: "superadmin@example.com",
    });
  });

  it("only shows color picker (no hex input)", async () => {
    renderPage();
    expect(await screen.findByLabelText("Primary color picker")).toBeInTheDocument();
    expect(screen.queryByLabelText("Primary color hex")).not.toBeInTheDocument();
    expect(screen.getByText(/BucketReef branding always remains visible/i)).toBeInTheDocument();
  });

  it("offers presets that avoid semantic success, warning, and danger colors", async () => {
    renderPage();
    await screen.findByLabelText("Primary color picker");

    const presetLabels = screen
      .getAllByRole("button", { name: /Use preset color/i })
      .map((button) => button.getAttribute("aria-label"));
    expect(presetLabels).toEqual([
      "Use preset color #0569f8",
      "Use preset color #2563eb",
      "Use preset color #0369a1",
      "Use preset color #0e7490",
      "Use preset color #4f46e5",
      "Use preset color #4338ca",
      "Use preset color #7c3aed",
      "Use preset color #9333ea",
    ]);
  });

  it("warns without blocking a custom accent color that overlaps semantic status colors", async () => {
    renderPage();
    const picker = await screen.findByLabelText("Primary color picker");

    fireEvent.change(picker, { target: { value: "#dc2626" } });
    expect(screen.getByText(/close to a semantic status color/i)).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "#7c3aed" } });
    expect(screen.queryByText(/close to a semantic status color/i)).not.toBeInTheDocument();
  });

  it("saves branding color and applies it immediately", async () => {
    const user = userEvent.setup();
    renderPage();

    const picker = (await screen.findByLabelText("Primary color picker")) as HTMLInputElement;
    fireEvent.change(picker, { target: { value: "#0057b8" } });

    expect(applyBrandingMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.branding.primary_color).toBe("#0057b8");
    expect(applyBrandingMock).toHaveBeenCalledWith("#0057b8");
  });

  it("saves a valid RGW account ID prefix", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("RGW account ID prefix");
    await user.clear(input);
    await user.type(input, "123");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateAppSettingsMock.mock.calls[0][0].general.rgw_account_id_prefix).toBe("123");
  });

  it("keeps managed RGW tenant creation disabled by default and saves an explicit opt-in", async () => {
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByRole("switch", {
      name: "Managed RGW tenant creation",
    });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledTimes(1));
    expect(
      updateAppSettingsMock.mock.calls[0][0].general.allow_managed_rgw_tenant_creation
    ).toBe(true);
  });

  it("configures bucket composition availability and automatic collection independently", async () => {
    const user = userEvent.setup();
    renderPage();

    const statistics = await screen.findByRole("radiogroup", { name: "Bucket composition statistics" });
    const collection = screen.getByRole("radiogroup", { name: "Automatic bucket composition collection" });
    expect(within(statistics).getByRole("radio", { name: "Enabled by default" })).toBeChecked();
    expect(within(collection).getByRole("radio", { name: "Targeted activation" })).toBeChecked();

    await user.click(within(statistics).getByRole("radio", { name: "Disabled" }));
    await user.click(within(collection).getByRole("radio", { name: "Enabled by default" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledTimes(1));
    const payload = updateAppSettingsMock.mock.calls[0][0];
    expect(payload.general.project_feature_policies.bucket_usage_stats).toBe("disabled");
    expect(payload.general.project_collection_policies.bucket_usage_stats).toBe("default_on");
  });

  it("saves a custom documentation base URL", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("Documentation base URL");
    await user.clear(input);
    await user.type(input, "https://docs.example.com/bucketreef");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateAppSettingsMock.mock.calls[0][0].general.documentation_base_url).toBe(
      "https://docs.example.com/bucketreef",
    );
  });

  it("rejects a documentation base URL with a query string", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("Documentation base URL");
    await user.clear(input);
    await user.type(input, "https://docs.example.com/bucketreef?tenant=1");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(
      await screen.findByText(
        "Use an HTTP(S) or root-relative URL without a query string or fragment.",
      ),
    ).toBeInTheDocument();
    expect(updateAppSettingsMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid RGW account ID prefix", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("RGW account ID prefix");
    await user.clear(input);
    await user.type(input, "ab");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("RGW account ID prefix must contain 1 to 3 digits.")).toBeInTheDocument();
    expect(updateAppSettingsMock).not.toHaveBeenCalled();
  });

  it("does not render authentication options", async () => {
    renderPage();

    await screen.findByLabelText("Primary color picker");
    expect(screen.queryByLabelText("Access-key login")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access-key endpoint list")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Custom login endpoint")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Private S3 connections for UI users")).not.toBeInTheDocument();
  });

  it("links the setup assistant to production readiness", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/admin/settings/general"]}>
        <ThemeProvider>
          <Routes>
            <Route path="/admin/settings/general" element={<GeneralSettingsPage />} />
            <Route path="/admin/production-readiness" element={<div>Production readiness destination</div>} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Production hardening");
    await user.click(screen.getByRole("button", { name: "Review production readiness" }));

    expect(await screen.findByText("Production readiness destination")).toBeInTheDocument();
  });

  it("does not render manager extra tools toggles", async () => {
    renderPage();

    await screen.findByLabelText("Primary color picker");
    expect(screen.queryByLabelText("Bucket migration tool")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bucket compare tool")).not.toBeInTheDocument();
  });

  it("shows Experimental badges on OpenStack, Portal, and Cost feature toggles", async () => {
    renderPage();

    const openStackToggle = await screen.findByLabelText("OpenStack feature");
    const portalToggle = await screen.findByLabelText("Portal feature");
    const costToggle = screen.getByLabelText("Cost feature");
    const openStackRow = openStackToggle.closest(".settings-item-compact");
    const portalRow = portalToggle.closest(".settings-item-compact");
    const costRow = costToggle.closest(".settings-item-compact");

    expect(openStackRow).not.toBeNull();
    expect(portalRow).not.toBeNull();
    expect(costRow).not.toBeNull();
    expect(within(openStackRow as HTMLElement).getByText("Experimental")).toBeInTheDocument();
    expect(within(portalRow as HTMLElement).getByText("Experimental")).toBeInTheDocument();
    expect(within(costRow as HTMLElement).getByText("Experimental")).toBeInTheDocument();
  });

  it("sends a quota SMTP test email with current quota notification settings", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText("Primary color picker");
    await user.click(screen.getByRole("button", { name: "Configure SMTP" }));
    await user.click(screen.getByRole("button", { name: /send test email/i }));

    await waitFor(() => {
      expect(sendQuotaNotificationTestEmailMock).toHaveBeenCalledTimes(1);
    });
    expect(sendQuotaNotificationTestEmailMock.mock.calls[0][0]).toEqual(buildSettings().quota_notifications);
    expect(await screen.findByText(/test email sent to superadmin@example.com/i)).toBeInTheDocument();
  });

  it("preserves authentication fields when resetting general settings", async () => {
    const user = userEvent.setup();
    const initialSettings = buildSettings();
    initialSettings.branding.primary_color = "#0057b8";
    initialSettings.general.allow_login_access_keys = true;
    initialSettings.general.allow_login_endpoint_list = true;
    initialSettings.general.allow_login_custom_endpoint = true;
    initialSettings.general.rgw_account_id_prefix = "123";
    const defaultSettings = buildSettings();
    defaultSettings.general.allow_login_access_keys = false;
    defaultSettings.general.allow_login_endpoint_list = false;
    defaultSettings.general.allow_login_custom_endpoint = false;
    fetchAppSettingsMock.mockResolvedValue(initialSettings);
    fetchDefaultAppSettingsMock.mockResolvedValueOnce(defaultSettings);

    renderPage();

    await screen.findByLabelText("Primary color picker");
    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(screen.getByRole("heading", { name: "Reset general settings draft?" })).toBeInTheDocument();
    expect(fetchDefaultAppSettingsMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Load defaults" }));
    await waitFor(() => {
      expect(fetchDefaultAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    expect(applyBrandingMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.allow_login_access_keys).toBe(true);
    expect(payload.general.allow_login_endpoint_list).toBe(true);
    expect(payload.general.allow_login_custom_endpoint).toBe(true);
    expect(payload.general.rgw_account_id_prefix).toBe("80");
    expect(payload.general).not.toHaveProperty("allow_user_private_connections");
    expect(payload.branding.primary_color).toBe("#0569f8");
  });

  it("shows backend detail when initial settings load fails with detail", async () => {
    fetchAppSettingsMock.mockRejectedValueOnce(new ApiError("Request failed", {
      response: { status: 403, data: { detail: "Forbidden by policy" }, headers: {} },
    }));

    renderPage();

    expect(await screen.findByText("Forbidden by policy")).toBeInTheDocument();
  });

  it("shows a public fallback when initial settings load fails without detail", async () => {
    fetchAppSettingsMock.mockRejectedValueOnce(new ApiError("Network Error"));

    renderPage();

    expect(await screen.findByText("Unable to load settings.")).toBeInTheDocument();
    expect(screen.queryByText("Network Error")).not.toBeInTheDocument();
  });
  it("keeps forced workspace values when loading defaults", async () => {
    const current = buildSettings(); current.general.portal_enabled = false;
    fetchAppSettingsMock.mockResolvedValue(current);
    const locks = unlockedFeatureLocks(); locks.portal_enabled = { forced: true, value: false, source: "FEATURE_PORTAL_ENABLED" };
    fetchGeneralFeatureLocksMock.mockResolvedValue(locks);
    renderPage();
    const toggle = await screen.findByRole("switch", { name: "Portal feature" });
    expect(toggle).toBeDisabled(); expect(toggle).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    fireEvent.click(screen.getByRole("button", { name: "Load defaults" }));
    await waitFor(() => expect(fetchDefaultAppSettingsMock).toHaveBeenCalledOnce());
    expect(toggle).not.toBeChecked(); expect(updateAppSettingsMock).not.toHaveBeenCalled();
  });
  it("validates SMTP before testing and keeps SMTP edits inside its draft", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Configure SMTP" }));
    const port = screen.getByRole("spinbutton", { name: "SMTP port" });
    fireEvent.change(port, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await waitFor(() => expect(port).toHaveFocus());
    expect(port).toHaveAttribute("aria-invalid", "true"); expect(sendQuotaNotificationTestEmailMock).not.toHaveBeenCalled();
    fireEvent.change(port, { target: { value: "2525" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(updateAppSettingsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledOnce());
    expect(updateAppSettingsMock.mock.calls[0][0].quota_notifications.smtp_port).toBe(2525);
  });
  it("does not apply global branding on a failed save", async () => {
    updateAppSettingsMock.mockRejectedValueOnce(new ApiError("Network Error"));
    renderPage();
    const picker = await screen.findByLabelText("Primary color picker");
    fireEvent.change(picker, { target: { value: "#0057b8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Unable to save settings.");
    expect(picker).toHaveValue("#0057b8"); expect(applyBrandingMock).not.toHaveBeenCalled();
  });

  it("saves Ceph Admin availability through the standard settings form without an activation dialog", async () => {
    renderPage();
    const toggle = await screen.findByRole("switch", { name: "Ceph Admin feature" });
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage endpoints" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      general: expect.objectContaining({ ceph_admin_enabled: true }),
    })));
  });

});
