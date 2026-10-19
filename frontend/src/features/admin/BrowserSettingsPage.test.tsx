import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../api/appSettings";
import {
  DEFAULT_MANAGER_FEATURE_POLICIES,
  DEFAULT_PORTAL_FEATURE_POLICIES,
  DEFAULT_PROJECT_COLLECTION_POLICIES,
  DEFAULT_PROJECT_FEATURE_POLICIES,
} from "../../api/featurePolicies";
import BrowserSettingsPage from "./BrowserSettingsPage";

const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();

vi.mock("../../api/appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/appSettings")>()),
  fetchAppSettings: () => fetchAppSettingsMock(),
  fetchDefaultAppSettings: () => fetchDefaultAppSettingsMock(),
  updateAppSettings: (payload: AppSettings) => updateAppSettingsMock(payload),
}));

function buildSettings(overrides: Partial<AppSettings["general"]> = {}): AppSettings {
  return {
    general: {
      project_feature_policies: DEFAULT_PROJECT_FEATURE_POLICIES,
      project_collection_policies: DEFAULT_PROJECT_COLLECTION_POLICIES,
      rgw_account_id_prefix: "80",
      allow_managed_rgw_tenant_creation: false,
      documentation_base_url: "https://docs.bucketreef.ksperis.com",
      manager_enabled: true,
      ceph_admin_enabled: false,
      storage_ops_enabled: false,
      browser_enabled: true,
      browser_root_enabled: true,
      browser_manager_enabled: true,
      browser_portal_enabled: true,
      browser_ceph_admin_enabled: false,
      portal_enabled: true,
      billing_enabled: false,
      endpoint_status_enabled: false,
      quota_alerts_enabled: false,
      usage_history_enabled: false,
      allow_login_access_keys: false,
      allow_login_endpoint_list: false,
      allow_login_custom_endpoint: false,
      require_passkey_for_admins: false,
      require_passkey_for_users: false,
      allow_user_profile_name_edit: false,
      allow_user_external_identity_unlink: false,
      ...overrides,
    },
    portal: {
      feature_policies: DEFAULT_PORTAL_FEATURE_POLICIES,
      server_access_log_retention_days: 30,
      max_portal_user_access_keys: 2,
      bucket_defaults: {
        versioning: false,
        enable_cors: true,
        enable_lifecycle: false,
        noncurrent_version_expiration_days: 90,
        cors_allowed_origins: [],
      },
    },
    manager: {
      feature_policies: DEFAULT_MANAGER_FEATURE_POLICIES,
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
    onboarding: { dismissed: false },
    branding: {
      primary_color: "#0569f8",
      login_logo_url: null,
    },
  };
}

describe("BrowserSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAppSettingsMock.mockResolvedValue(buildSettings({ browser_portal_enabled: false }));
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings({ browser_portal_enabled: true }));
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
  });

  it("saves the Portal Browser workspace toggle", async () => {
    render(<BrowserSettingsPage />);

    const toggle = await screen.findByLabelText("Enable Browser in Portal Storage Spaces");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    expect(updateAppSettingsMock.mock.calls[0][0].general.browser_portal_enabled).toBe(true);
  });

  it("resets the Portal Browser workspace toggle from defaults", async () => {
    render(<BrowserSettingsPage />);

    const toggle = await screen.findByLabelText("Enable Browser in Portal Storage Spaces");
    expect(toggle).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(screen.getByRole("heading", { name: "Reset Browser settings draft?" })).toBeInTheDocument();
    expect(fetchDefaultAppSettingsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
  });
});
