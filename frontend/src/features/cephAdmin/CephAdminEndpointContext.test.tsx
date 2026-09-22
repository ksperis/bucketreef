import { render, screen, waitFor } from "@testing-library/react";
import { transferableAbortController } from "node:util";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CephAdminEndpointProvider, useCephAdminEndpoint } from "./CephAdminEndpointContext";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { setSessionUserCache } from "../../utils/workspaces";

const listCephAdminEndpointsMock = vi.fn();
const getCephAdminEndpointAccessMock = vi.fn();

vi.mock("../../api/cephAdminEndpoints", () => ({
  listCephAdminEndpoints: (...args: unknown[]) => listCephAdminEndpointsMock(...args),
  getCephAdminEndpointAccess: (...args: unknown[]) => getCephAdminEndpointAccessMock(...args),
}));

const ENDPOINTS = [
  { id: 1, name: "Primary", endpoint_url: "https://one.test", is_default: true, tags: [] },
  { id: 2, name: "Archive", endpoint_url: "https://two.test", is_default: false, tags: [] },
];

function Probe() {
  const { selectedEndpointId, setSelectedEndpointId } = useCephAdminEndpoint();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="selected">{selectedEndpointId ?? "null"}</div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <button type="button" onClick={() => navigate("/ceph-admin/buckets?ep=2")}>Open endpoint 2</button>
      <button type="button" onClick={() => navigate("/ceph-admin/users")}>Navigate without endpoint</button>
      <button type="button" onClick={() => setSelectedEndpointId(2)}>Select endpoint 2</button>
    </>
  );
}

function renderProvider(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="*" element={<CephAdminEndpointProvider><Probe /></CephAdminEndpointProvider>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CephAdminEndpointProvider", () => {
  afterEach(() => { vi.unstubAllGlobals(); setSessionUserCache(null); });
  beforeEach(() => {
    localStorage.clear();
    listCephAdminEndpointsMock.mockReset();
    getCephAdminEndpointAccessMock.mockReset();
    listCephAdminEndpointsMock.mockResolvedValue(ENDPOINTS);
    getCephAdminEndpointAccessMock.mockImplementation(async (endpointId: number) => ({
      endpoint_id: endpointId,
      can_admin: true,
      can_accounts: true,
      can_metrics: true,
    }));
  });

  it("treats the endpoint query parameter as authoritative", async () => {
    localStorage.setItem("selectedCephAdminEndpointId", "1");
    renderProvider("/ceph-admin/buckets?ep=2");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("2"));
    expect(localStorage.getItem("selectedCephAdminEndpointId")).toBe("2");
  });

  it("keeps the mounted endpoint when navigation omits the query parameter", async () => {
    const user = userEvent.setup();
    renderProvider("/ceph-admin/buckets?ep=1");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("1"));

    localStorage.setItem("selectedCephAdminEndpointId", "2");
    await user.click(screen.getByRole("button", { name: "Navigate without endpoint" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/ceph-admin/users?ep=1"));
    expect(screen.getByTestId("selected")).toHaveTextContent("1");
  });

  it("switches the mounted tab when its URL selects another endpoint", async () => {
    const user = userEvent.setup();
    renderProvider("/ceph-admin/buckets?ep=1");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("1"));

    await user.click(screen.getByRole("button", { name: "Open endpoint 2" }));

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("2"));
  });

  it("keeps the executor and stored endpoint unchanged until navigation is accepted", async () => {
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    setSessionUserCache({ role: "ui_admin", authType: "password" });
    const user = userEvent.setup();
    function GuardedProbe() {
      const { selectedEndpointId } = useCephAdminEndpoint();
      return <>
        <Probe />
        <SettingsNavigationGuard key={selectedEndpointId} dirty={selectedEndpointId === 1} />
      </>;
    }
    const router = createMemoryRouter([
      { path: "*", element: <CephAdminEndpointProvider><GuardedProbe /></CephAdminEndpointProvider> },
    ], { initialEntries: ["/ceph-admin/buckets?ep=1"] });
    render(<RouterProvider router={router} />);
    try {
      await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("1"));
      await user.click(screen.getByRole("button", { name: "Select endpoint 2" }));
      expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
      expect(screen.getByTestId("selected")).toHaveTextContent("1");
      expect(localStorage.getItem("selectedCephAdminEndpointId")).toBe("1");
      expect(getCephAdminEndpointAccessMock.mock.calls.some(([id]) => id === 2)).toBe(false);
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(router.state.location.search).toBe("?ep=1");
      await user.click(screen.getByRole("button", { name: "Select endpoint 2" }));
      await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
      await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("2"));
      expect(router.state.location.search).toBe("?ep=2");
      expect(localStorage.getItem("selectedCephAdminEndpointId")).toBe("2");
    } finally { router.dispose(); }
  });
});
