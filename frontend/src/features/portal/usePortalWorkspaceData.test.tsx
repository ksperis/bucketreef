import { act, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../components/language";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const mocks = vi.hoisted(() => ({
  accountId: "101",
  fetchPortalActivityMock: vi.fn(),
  fetchPortalAlertsMock: vi.fn(),
  fetchPortalCollaboratorsMock: vi.fn(),
  fetchPortalStateMock: vi.fn(),
  fetchPortalUsageMock: vi.fn(),
  fetchPortalUsageTrendsMock: vi.fn(),
  fetchPortalTrafficMock: vi.fn(),
  listPortalStorageSpacesMock: vi.fn(),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => ({
    accountIdForApi: mocks.accountId,
    selectedAccount: { id: mocks.accountId, name: "Account 1", tags: [] },
    hasAccountContext: true,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/portal", () => ({
  listPortalStorageSpaces: (...args: unknown[]) => mocks.listPortalStorageSpacesMock(...args),
}));

vi.mock("../../api/portalAccounts", () => ({
  fetchPortalState: (...args: unknown[]) => mocks.fetchPortalStateMock(...args),
}));

vi.mock("../../api/portalCollaborators", () => ({
  fetchPortalCollaborators: (...args: unknown[]) => mocks.fetchPortalCollaboratorsMock(...args),
}));

vi.mock("../../api/portalActivity", () => ({
  fetchPortalActivity: (...args: unknown[]) => mocks.fetchPortalActivityMock(...args),
  fetchPortalAlerts: (...args: unknown[]) => mocks.fetchPortalAlertsMock(...args),
}));

vi.mock("../../api/portalUsage", () => ({
  fetchPortalUsage: (...args: unknown[]) => mocks.fetchPortalUsageMock(...args),
  fetchPortalUsageTrends: (...args: unknown[]) => mocks.fetchPortalUsageTrendsMock(...args),
  fetchPortalTraffic: (...args: unknown[]) => mocks.fetchPortalTrafficMock(...args),
}));

vi.mock("../../api/healthchecks", () => ({
  fetchPortalWorkspaceHealthOverview: vi.fn(),
}));

function Probe({ includeArchived = false }: { includeArchived?: boolean }) {
  usePortalWorkspaceData({ includeArchived });
  return null;
}

describe("usePortalWorkspaceData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountId = "101";
    mocks.fetchPortalActivityMock.mockResolvedValue([]);
    mocks.fetchPortalAlertsMock.mockResolvedValue([]);
    mocks.fetchPortalCollaboratorsMock.mockResolvedValue({
      summary: { collaborator_count: 0, external_access_key_count: 0, trend: null },
      collaborators: [],
    });
    mocks.fetchPortalStateMock.mockResolvedValue({});
    mocks.fetchPortalUsageMock.mockResolvedValue(null);
    mocks.fetchPortalUsageTrendsMock.mockResolvedValue(null);
    mocks.fetchPortalTrafficMock.mockResolvedValue(null);
    mocks.listPortalStorageSpacesMock.mockResolvedValue([]);
  });

  it("keeps state pending and hides the previous project's state during a switch", async () => {
    const firstState = { portal_role: "portal_manager", server_access_logging_enabled: true };
    mocks.fetchPortalStateMock.mockResolvedValueOnce(firstState);
    const { result, rerender } = renderHook(() => usePortalWorkspaceData(), { wrapper: LanguageProvider });
    await waitFor(() => expect(result.current.state).toEqual(firstState));

    let resolveState!: (value: unknown) => void;
    mocks.fetchPortalStateMock.mockReturnValueOnce(new Promise((resolve) => { resolveState = resolve; }));
    mocks.accountId = "102";
    rerender();

    expect(result.current.state).toBeNull();
    expect(result.current.stateLoading).toBe(true);
    await act(async () => resolveState({ portal_role: "portal_user", server_access_logging_enabled: false }));
    expect(result.current.state).toEqual({ portal_role: "portal_user", server_access_logging_enabled: false });
    expect(result.current.stateLoading).toBe(false);
  });

  it("ignores a late failure from the previous project", async () => {
    let rejectPrevious!: (reason: Error) => void;
    mocks.fetchPortalStateMock.mockReturnValueOnce(new Promise((_, reject) => { rejectPrevious = reject; }));
    const { result, rerender } = renderHook(() => usePortalWorkspaceData(), { wrapper: LanguageProvider });
    mocks.accountId = "102";
    mocks.fetchPortalStateMock.mockResolvedValueOnce({ portal_role: "portal_user" });
    rerender();
    await waitFor(() => expect(result.current.state).toEqual({ portal_role: "portal_user" }));
    await act(async () => rejectPrevious(new Error("Previous project failed")));
    expect(result.current.state).toEqual({ portal_role: "portal_user" });
    expect(result.current.stateError).toBeNull();
  });

  it("requests archived Storage Spaces when the caller needs them", async () => {
    render(
      <LanguageProvider>
        <Probe includeArchived />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(mocks.listPortalStorageSpacesMock).toHaveBeenCalledWith("101", { includeArchived: true });
    });
  });

  it("keeps archived Storage Spaces out of default workspace loads", async () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(mocks.listPortalStorageSpacesMock).toHaveBeenCalledWith("101", undefined);
    });
  });
});
