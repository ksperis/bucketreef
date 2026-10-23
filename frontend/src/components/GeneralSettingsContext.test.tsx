import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GENERAL_SETTINGS, GeneralSettingsProvider, useGeneralSettings } from "./GeneralSettingsContext";
import * as appSettingsApi from "../api/appSettings";
import { isFeaturePolicyAvailable } from "../api/featurePolicies";
import { CLIENT_STORAGE_KEYS } from "../utils/clientStorage";

const sessionState = vi.hoisted(() => ({ authenticated: false }));

vi.mock("../auth/SessionProvider", () => ({
  useSession: () => ({ authenticated: sessionState.authenticated, loading: false }),
}));

vi.mock("../api/appSettings", async () => {
  const actual = await vi.importActual<typeof import("../api/appSettings")>("../api/appSettings");
  return {
    ...actual,
    fetchGeneralSettings: vi.fn(),
    fetchRuntimeSurfaces: vi.fn(),
  };
});

function Probe() {
  const { generalSettings, loading, runtimeSurfaces, runtimeSurfacesLoading, setGeneralSettings } = useGeneralSettings();
  return (
    <div>
      <span data-testid="migration">{String(isFeaturePolicyAvailable(generalSettings.manager_feature_policies.bucket_migration))}</span>
      <span data-testid="compare">{String(isFeaturePolicyAvailable(generalSettings.manager_feature_policies.bucket_compare))}</span>
      <span data-testid="endpoint-status">{String(generalSettings.endpoint_status_enabled)}</span>
      <span data-testid="usage-history">{String(generalSettings.usage_history_enabled)}</span>
      <span data-testid="portal-browser">{String(generalSettings.browser_portal_enabled)}</span>
      <span data-testid="bucket-quota-management">{String(isFeaturePolicyAvailable(generalSettings.manager_feature_policies.bucket_quota_management))}</span>
      <span data-testid="usage-policy">{generalSettings.project_feature_policies.bucket_usage_stats}</span>
      <span data-testid="activity-policy">{generalSettings.manager_feature_policies.activity_history}</span>
      <span data-testid="compare-policy">{generalSettings.manager_feature_policies.bucket_compare}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="runtime-loading">{String(runtimeSurfacesLoading)}</span>
      <span data-testid="runtime-admin">{String(runtimeSurfaces.admin)}</span>
      <button
        type="button"
        onClick={() => setGeneralSettings({
          ...generalSettings,
          manager_feature_policies: {
            ...generalSettings.manager_feature_policies,
            bucket_migration: "targeted",
          },
        })}
      >
        Save locally
      </button>
    </div>
  );
}

describe("GeneralSettingsProvider fallbacks", () => {
  beforeEach(() => {
    sessionState.authenticated = false;
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(appSettingsApi.fetchGeneralSettings).mockReset();
    vi.mocked(appSettingsApi.fetchRuntimeSurfaces).mockReset();
    vi.mocked(appSettingsApi.fetchRuntimeSurfaces).mockResolvedValue({
      admin: false,
      ceph_admin: false,
      storage_ops: false,
      manager: true,
      portal: true,
      browser: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses local defaults when no token is available", async () => {
    const fetchGeneralSettings = vi.mocked(appSettingsApi.fetchGeneralSettings);
    fetchGeneralSettings.mockResolvedValueOnce({
      ...DEFAULT_GENERAL_SETTINGS,
      ceph_admin_enabled: true,
      storage_ops_enabled: true,
      browser_manager_enabled: true,
      browser_ceph_admin_enabled: true,
      portal_enabled: true,
      cost_enabled: true,
      quota_alerts_enabled: true,
      allow_login_access_keys: true,
      allow_login_endpoint_list: true,
      allow_login_custom_endpoint: true,
      manager_feature_policies: {
        ...DEFAULT_GENERAL_SETTINGS.manager_feature_policies,
        bucket_migration: "targeted",
        bucket_quota_management: "targeted",
      },
    });

    render(
      <GeneralSettingsProvider>
        <Probe />
      </GeneralSettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("migration").textContent).toBe("false");
    expect(screen.getByTestId("compare").textContent).toBe("true");
    expect(screen.getByTestId("endpoint-status").textContent).toBe("true");
    expect(screen.getByTestId("usage-history").textContent).toBe("true");
    expect(screen.getByTestId("portal-browser").textContent).toBe("true");
    expect(screen.getByTestId("bucket-quota-management").textContent).toBe("false");
    expect(fetchGeneralSettings).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("runtime-loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("runtime-admin").textContent).toBe("false");
  });

  it("falls back to local defaults when settings fetch fails", async () => {
    sessionState.authenticated = true;
    const fetchGeneralSettings = vi.mocked(appSettingsApi.fetchGeneralSettings);
    fetchGeneralSettings.mockRejectedValueOnce(new Error("network down"));

    render(
      <GeneralSettingsProvider>
        <Probe />
      </GeneralSettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
      expect(fetchGeneralSettings).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId("migration").textContent).toBe("false");
    expect(screen.getByTestId("compare").textContent).toBe("true");
    expect(screen.getByTestId("endpoint-status").textContent).toBe("true");
    expect(screen.getByTestId("usage-history").textContent).toBe("true");
    expect(screen.getByTestId("portal-browser").textContent).toBe("true");
    expect(screen.getByTestId("bucket-quota-management").textContent).toBe("false");
  });

  it("keeps current-schema cached settings when refresh fails", async () => {
    sessionState.authenticated = true;
    window.localStorage.setItem(CLIENT_STORAGE_KEYS.generalSettingsCache, JSON.stringify({
      ...DEFAULT_GENERAL_SETTINGS,
      manager_feature_policies: {
        ...DEFAULT_GENERAL_SETTINGS.manager_feature_policies,
        bucket_compare: "disabled",
      },
    }));
    vi.mocked(appSettingsApi.fetchGeneralSettings).mockRejectedValueOnce(new Error("offline"));

    render(<GeneralSettingsProvider><Probe /></GeneralSettingsProvider>);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("compare-policy")).toHaveTextContent("disabled");
  });

  it("writes saved settings to the local cache immediately", async () => {
    render(
      <GeneralSettingsProvider>
        <Probe />
      </GeneralSettingsProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save locally" }));

    expect(screen.getByTestId("migration").textContent).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(CLIENT_STORAGE_KEYS.generalSettingsCache) ?? "{}")).toEqual(
      expect.objectContaining({
        manager_feature_policies: expect.objectContaining({ bucket_migration: "targeted" }),
      })
    );
  });

  it("ignores settings cached with the previous schema", async () => {
    sessionState.authenticated = true;
    window.localStorage.setItem("settings:general:v2", JSON.stringify({
      ...DEFAULT_GENERAL_SETTINGS,
      portal_enabled: true,
      project_feature_policies: undefined,
      manager_feature_policies: { bucket_compare: "disabled" },
    }));
    vi.mocked(appSettingsApi.fetchGeneralSettings).mockRejectedValueOnce(new Error("offline"));

    render(<GeneralSettingsProvider><Probe /></GeneralSettingsProvider>);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("usage-policy")).toHaveTextContent("default_on");
    expect(screen.getByTestId("activity-policy")).toHaveTextContent("default_on");
    expect(screen.getByTestId("compare-policy")).toHaveTextContent("targeted");
    expect(screen.getByTestId("portal-browser")).toHaveTextContent("true");
    expect(window.localStorage.getItem(CLIENT_STORAGE_KEYS.generalSettingsCache)).toBeNull();
  });
});
