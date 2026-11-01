import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAdminDashboardResources } from "./useAdminDashboardResources";

const mocks = vi.hoisted(() => ({
  fetchAdminDashboardScope: vi.fn(),
  fetchAdminDashboardStorage: vi.fn(),
  fetchAdminDashboardTraffic: vi.fn(),
  fetchAdminSummary: vi.fn(),
  fetchHealthOverview: vi.fn(),
  fetchHealthWorkspaceOverview: vi.fn(),
  listAuditLogs: vi.fn(),
  listStorageEndpoints: vi.fn(),
}));

vi.mock("../../api/audit", () => ({
  listAuditLogs: mocks.listAuditLogs,
}));

vi.mock("../../api/healthchecks", () => ({
  fetchHealthOverview: mocks.fetchHealthOverview,
  fetchHealthWorkspaceOverview: mocks.fetchHealthWorkspaceOverview,
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: mocks.listStorageEndpoints,
}));

vi.mock("../../api/stats", () => ({
  fetchAdminDashboardScope: mocks.fetchAdminDashboardScope,
  fetchAdminDashboardStorage: mocks.fetchAdminDashboardStorage,
  fetchAdminDashboardTraffic: mocks.fetchAdminDashboardTraffic,
  fetchAdminSummary: mocks.fetchAdminSummary,
}));

describe("useAdminDashboardResources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAdminSummary.mockResolvedValue({ total_users: 0 });
    mocks.fetchAdminDashboardScope.mockResolvedValue({ endpoints: [] });
    mocks.fetchAdminDashboardStorage.mockResolvedValue({ storage_totals: {} });
    mocks.fetchAdminDashboardTraffic.mockResolvedValue({ series: [] });
    mocks.listAuditLogs.mockResolvedValue({ logs: [] });
    mocks.fetchHealthWorkspaceOverview.mockResolvedValue({ endpoints: [], incidents: [] });
    mocks.listStorageEndpoints.mockResolvedValue([]);
    mocks.fetchHealthOverview.mockResolvedValue({ endpoints: [] });
  });

  it("ignores a resource response from an obsolete refresh", async () => {
    let resolveFirstSummary: ((value: { total_users: number }) => void) | undefined;
    mocks.fetchAdminSummary
      .mockImplementationOnce(
        () => new Promise<{ total_users: number }>((resolve) => { resolveFirstSummary = resolve; }),
      )
      .mockResolvedValueOnce({ total_users: 2 });

    const { result, rerender } = renderHook(
      ({ refreshNonce }) => useAdminDashboardResources({ endpointStatusEnabled: false, refreshNonce }),
      { initialProps: { refreshNonce: 0 } },
    );

    await waitFor(() => expect(mocks.fetchAdminSummary).toHaveBeenCalledTimes(1));
    rerender({ refreshNonce: 1 });
    await waitFor(() => expect(result.current.summary).toEqual({ total_users: 2 }));

    await act(async () => resolveFirstSummary?.({ total_users: 1 }));

    expect(result.current.summary).toEqual({ total_users: 2 });
    expect(result.current.summaryError).toBeNull();
  });

  it("clears endpoint status resources when the feature is disabled", async () => {
    mocks.fetchHealthWorkspaceOverview.mockResolvedValue({ endpoints: [{ endpoint_id: 1 }], incidents: [] });
    mocks.listStorageEndpoints.mockResolvedValue([{ id: 1 }]);
    mocks.fetchHealthOverview.mockResolvedValue({ endpoints: [{ endpoint_id: 1 }] });

    const { result, rerender } = renderHook(
      ({ endpointStatusEnabled }) => useAdminDashboardResources({ endpointStatusEnabled, refreshNonce: 0 }),
      { initialProps: { endpointStatusEnabled: true } },
    );

    await waitFor(() => expect(result.current.workspaceHealth).not.toBeNull());
    expect(result.current.mapEndpoints).toEqual([{ id: 1 }]);
    expect(result.current.healthOverview).not.toBeNull();

    rerender({ endpointStatusEnabled: false });

    await waitFor(() => expect(result.current.workspaceHealth).toBeNull());
    expect(result.current.mapEndpoints).toEqual([]);
    expect(result.current.healthOverview).toBeNull();
    expect(result.current.workspaceHealthLoading).toBe(false);
    expect(result.current.mapEndpointsLoading).toBe(false);
    expect(result.current.healthOverviewLoading).toBe(false);
  });
});
