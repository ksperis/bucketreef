import { createAppSettings } from "./settings/settingsTestFixtures";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings } from "../../api/appSettings";
import PortalSettingsPage from "./PortalSettingsPage";

const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();

vi.mock("../../api/appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/appSettings")>()),
  fetchAppSettings: () => fetchAppSettingsMock(),
  fetchDefaultAppSettings: () => fetchDefaultAppSettingsMock(),
  updateAppSettings: (payload: AppSettings) => updateAppSettingsMock(payload),
}));

function buildSettings(): AppSettings {
  const settings = createAppSettings();
  settings.portal.feature_policies.browser_access = "default_on";
  settings.portal.bucket_defaults.versioning = true;
  settings.portal.bucket_defaults.enable_lifecycle = true;
  return settings;
}

describe("PortalSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAppSettingsMock.mockResolvedValue(buildSettings());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
  });

  it("sends max portal user keys in save payload", async () => {
    render(<PortalSettingsPage />);

    expect(
      await screen.findByText("Platform capabilities and defaults for Portal projects.")
    ).toBeInTheDocument();
    const input = (await screen.findByLabelText("Max S3 access keys per portal user")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.portal.max_portal_user_access_keys).toBe(5);
  });

  it("saves standalone Browser workspace access enabled by default", async () => {
    render(<PortalSettingsPage />);

    const toggle = await screen.findByLabelText("Portal Browser workspace access");
    expect(toggle).toHaveValue("default_on");
    fireEvent.change(toggle, { target: { value: "disabled" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateAppSettingsMock.mock.calls[0][0].portal.feature_policies.browser_access).toBe("disabled");
  });

  it("keeps Portal-user external sharing disabled by default and saves an explicit opt-in", async () => {
    render(<PortalSettingsPage />);

    const toggle = await screen.findByLabelText("External sharing by Portal users");
    expect(toggle).toHaveValue("targeted");
    fireEvent.change(toggle, { target: { value: "default_on" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledTimes(1));
    expect(
      updateAppSettingsMock.mock.calls[0][0].portal.feature_policies.user_external_sharing,
    ).toBe("default_on");
  });

  it("sends server access log retention in save payload", async () => {
    render(<PortalSettingsPage />);

    const input = (await screen.findByLabelText("Server access log retention")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "45" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.portal.server_access_log_retention_days).toBe(45);
  });

  it("sends version history retention days in save payload", async () => {
    render(<PortalSettingsPage />);

    const input = (await screen.findByLabelText("Version history retention")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "45" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.portal.bucket_defaults.noncurrent_version_expiration_days).toBe(45);
  });

  it("rejects a non-positive version history retention", async () => {
    render(<PortalSettingsPage />);

    const input = (await screen.findByLabelText("Version history retention")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Version history retention must be a whole number of at least 1.")).toBeInTheDocument();
    expect(updateAppSettingsMock).not.toHaveBeenCalled();
  });

  it("saves named storage creation setting without override policy controls", async () => {
    render(<PortalSettingsPage />);

    fireEvent.change(await screen.findByLabelText("Named storage creation"), { target: { value: "default_on" } });
    fireEvent.change(screen.getByLabelText("Server access logging"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("Storage Space history cleanup"), { target: { value: "targeted" } });
    expect(screen.queryByRole("checkbox", { name: "Allow override" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.portal.feature_policies.named_bucket_create).toBe("default_on");
    expect(payload.portal.feature_policies.server_access_logging).toBe("disabled");
    expect(payload.portal.feature_policies.storage_space_version_cleanup).toBe("targeted");
    expect("override_policy" in payload.portal).toBe(false);
  });

  it("labels portal user Storage Space creation without bucket management wording", async () => {
    render(<PortalSettingsPage />);

    expect(await screen.findByText("Private Storage Space creation")).toBeInTheDocument();
    expect(screen.queryByText("Bucket management")).not.toBeInTheDocument();
    expect(screen.queryByText("Policy bucket access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Space access policy")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Private Storage Space creation")).toBeInTheDocument();
  });
});
