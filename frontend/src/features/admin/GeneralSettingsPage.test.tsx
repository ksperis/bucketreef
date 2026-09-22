import { ThemeProvider } from "../../components/theme";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
  (payload: QuotaNotificationSettings) => Promise<{ status: string; recipient: string; sent_at: string }>
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

function unlockedFeatureLocks(): GeneralFeatureLocks {
  return {
    manager_enabled: { forced: false, value: null, source: null },
    ceph_admin_enabled: { forced: false, value: null, source: null },
    storage_ops_enabled: { forced: false, value: null, source: null },
    browser_enabled: { forced: false, value: null, source: null },
    portal_enabled: { forced: false, value: null, source: null },
    billing_enabled: { forced: false, value: null, source: null },
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
      endpoint_configured: false,
      storage_access_configured: false,
      journeys: [],
      can_configure: true,
      actor_id: 1,
      source: "standard",
    });
    resumeOnboardingMock.mockResolvedValue({
      dismissed: false,
      complete: false,
      endpoint_configured: false,
      storage_access_configured: false,
      journeys: [],
      can_configure: true,
      actor_id: 1,
      source: "standard",
    });
    sendQuotaNotificationTestEmailMock.mockResolvedValue({
      status: "sent",
      recipient: "superadmin@example.com",
      sent_at: "2026-01-01T00:00:00",
    });
  });

  it("only shows color picker (no hex input)", async () => {
    renderPage();
    expect(await screen.findByLabelText("Primary color picker")).toBeInTheDocument();
    expect(screen.queryByLabelText("Primary color hex")).not.toBeInTheDocument();
    expect(screen.getByText(/BucketReef branding always remains visible/i)).toBeInTheDocument();
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

  it("does not render authentication options", async () => {
    renderPage();

    await screen.findByLabelText("Primary color picker");
    expect(screen.queryByLabelText("Access-key login")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access-key endpoint list")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Custom login endpoint")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Private S3 connections for UI users")).not.toBeInTheDocument();
  });

  it("does not render manager extra tools toggles", async () => {
    renderPage();

    await screen.findByLabelText("Primary color picker");
    expect(screen.queryByLabelText("Bucket migration tool")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bucket compare tool")).not.toBeInTheDocument();
  });

  it("shows Experimental badge on portal feature toggle", async () => {
    renderPage();

    await screen.findByLabelText("Portal feature");
    expect(screen.getByText("Experimental")).toBeInTheDocument();
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

});
