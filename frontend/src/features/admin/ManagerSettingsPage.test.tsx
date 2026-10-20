import { createAppSettings } from "./settings/settingsTestFixtures";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings } from "../../api/appSettings";
import ManagerSettingsPage from "./ManagerSettingsPage";

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
  settings.manager.feature_policies.ceph_s3_user_keys = "disabled";
  settings.manager.feature_policies.bucket_integrity_check = "disabled";
  return settings;
}

async function policyGroup(label: string) {
  return screen.findByRole("radiogroup", { name: label });
}

function expectPolicy(group: HTMLElement, label: "Disabled" | "Targeted activation" | "Enabled by default") {
  expect(within(group).getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
}

describe("ManagerSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAppSettingsMock.mockResolvedValue(buildSettings());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
  });

  it("renders Ceph access-key management and sends its kill switch in the save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Ceph S3 User access-key management");
    expectPolicy(toggle, "Disabled");
    await user.click(within(toggle).getByRole("radio", { name: "Targeted activation" }));
    expectPolicy(toggle, "Targeted activation");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.manager.feature_policies.ceph_s3_user_keys).toBe("targeted");
  });

  it("renders Manager activity history as enabled by default", async () => {
    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Manager activity history");

    expectPolicy(toggle, "Enabled by default");
  });

  it("renders Cost estimation as targeted by default", async () => {
    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Cost estimation");

    expectPolicy(toggle, "Targeted activation");
  });

  it("saves managed private connection provisioning from an experimental default-off toggle", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Provision managed private connections");
    expectPolicy(toggle, "Disabled");
    await user.click(within(toggle).getByRole("radio", { name: "Targeted activation" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.manager.feature_policies.managed_private_connection_provisioning).toBe("targeted");
    expect(screen.getAllByText("Experimental")).toHaveLength(2);
  });

  it("saves RGW metrics policy", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const rgwMetricsPolicy = await policyGroup("RGW traffic and usage metrics");
    expectPolicy(rgwMetricsPolicy, "Enabled by default");

    await user.click(within(rgwMetricsPolicy).getByRole("radio", { name: "Disabled" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.manager.feature_policies.rgw_usage_metrics).toBe("disabled");
  });

  it("renders bucket quota kill switch and sends it in save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Bucket quota management: information" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("buckets=write");
    const toggle = await policyGroup("Bucket quota management");
    expectPolicy(toggle, "Targeted activation");
    await user.click(within(toggle).getByRole("radio", { name: "Disabled" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.manager.feature_policies.bucket_quota_management).toBe("disabled");
  });

  it("renders bucket integrity toggle and sends it in save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Bucket integrity check tool");
    expectPolicy(toggle, "Disabled");
    await user.click(within(toggle).getByRole("radio", { name: "Targeted activation" }));
    expectPolicy(toggle, "Targeted activation");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.manager.feature_policies.bucket_integrity_check).toBe("targeted");
  });

  it("keeps shared feature-policy guidance at section level and only shows option-specific help", async () => {
    render(<ManagerSettingsPage />);

    await policyGroup("Bucket compare tool");
    expect(screen.getAllByText(/Choose whether features are blocked/)).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Bucket compare tool: information" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bucket quota management: information" })).toBeInTheDocument();
  });

  it("renders bucket purge toggle and sends it in save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Bucket purge tool");
    expectPolicy(toggle, "Disabled");
    await user.click(within(toggle).getByRole("radio", { name: "Targeted activation" }));
    expectPolicy(toggle, "Targeted activation");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.manager.feature_policies.bucket_purge).toBe("targeted");
  });

  it("resets Ceph access-key management from defaults", async () => {
    const user = userEvent.setup();
    const defaults = buildSettings();
    defaults.manager.feature_policies.ceph_s3_user_keys = "targeted";
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Ceph S3 User access-key management");
    expectPolicy(toggle, "Disabled");

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expectPolicy(toggle, "Targeted activation");
    });
  });

  it("resets managed private connection provisioning from defaults", async () => {
    const user = userEvent.setup();
    const current = buildSettings();
    current.manager.feature_policies.managed_private_connection_provisioning = "targeted";
    fetchAppSettingsMock.mockResolvedValue(current);

    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Provision managed private connections");
    expectPolicy(toggle, "Targeted activation");

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expectPolicy(toggle, "Disabled");
    });
  });

  it("resets RGW metrics from defaults", async () => {
    const user = userEvent.setup();
    const current = buildSettings();
    current.manager.feature_policies.rgw_usage_metrics = "default_on";
    fetchAppSettingsMock.mockResolvedValue(current);
    const defaults = buildSettings();
    defaults.manager.feature_policies.rgw_usage_metrics = "disabled";
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const rgwMetricsPolicy = await policyGroup("RGW traffic and usage metrics");
    expectPolicy(rgwMetricsPolicy, "Enabled by default");

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expectPolicy(rgwMetricsPolicy, "Disabled");
    });
  });

  it("resets bucket integrity toggle from defaults", async () => {
    const user = userEvent.setup();
    const defaults = buildSettings();
    defaults.manager.feature_policies.bucket_integrity_check = "targeted";
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Bucket integrity check tool");
    expectPolicy(toggle, "Disabled");

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expectPolicy(toggle, "Targeted activation");
    });
  });

  it("resets bucket purge toggle from defaults", async () => {
    const user = userEvent.setup();
    const defaults = buildSettings();
    defaults.manager.feature_policies.bucket_purge = "targeted";
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const toggle = await policyGroup("Bucket purge tool");
    expectPolicy(toggle, "Disabled");

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expectPolicy(toggle, "Targeted activation");
    });
  });


  it("shows Experimental badge on bucket migration tool toggle", async () => {
    render(<ManagerSettingsPage />);

    await policyGroup("Bucket migration tool");
    const badges = screen.getAllByText("Experimental");
    expect(badges).toHaveLength(2);
    badges.forEach((badge) => expect(badge).toHaveClass("ui-badge-base"));
  });

  it("groups Manager usage and tools without workspace policy wording", async () => {
    render(<ManagerSettingsPage />);

    await screen.findByLabelText("RGW traffic and usage metrics");
    expect(screen.getByText("Usage and metrics")).toBeInTheDocument();
    expect(screen.getByText("Manager tools")).toBeInTheDocument();
    expect(screen.queryByText("Optional administrative and operational tools available in Manager.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Workspace access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/non-admin/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("radiogroup").map(group => group.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining(["RGW traffic and usage metrics"]),
    );
    expect(screen.getAllByRole("radiogroup")).toHaveLength(13);
  });
});
