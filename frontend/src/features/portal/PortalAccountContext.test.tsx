import { transferableAbortController } from "node:util";
import { useEffect, useState } from "react";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { setSessionUserCache } from "../../utils/workspaces";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalAccount } from "../../api/portalAccounts";
import { PortalAccountProvider, usePortalAccountContext } from "./PortalAccountContext";

const listPortalAccountsMock = vi.fn();

vi.mock("../../api/portalAccounts", () => ({
  listPortalAccounts: (...args: unknown[]) => listPortalAccountsMock(...args),
}));

vi.mock("../../i18n", () => {
  const t = (values: { en: string }) => values.en;
  return { useI18n: () => ({ t }) };
});

const ACCOUNTS = [
  {
    id: 101,
    name: "Project 101",
    rgw_account_id: "rgw-101",
    portal_role: "portal_user",
    storage_endpoint_name: "Primary",
    storage_endpoint_url: "https://s3.example.test",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: {},
  },
  {
    id: 102,
    name: "Project 102",
    rgw_account_id: "rgw-102",
    portal_role: "portal_manager",
    storage_endpoint_name: "Primary",
    storage_endpoint_url: "https://s3.example.test",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: {},
  },
] satisfies PortalAccount[];

function Probe() {
  const { selectedAccountId } = usePortalAccountContext();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="selected">{selectedAccountId ?? "null"}</div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <button type="button" onClick={() => navigate("/portal/storage-spaces")}>Navigate without project</button>
      <button type="button" onClick={() => navigate("/portal?project=102")}>Open project 102</button>
    </>
  );
}

function renderProvider(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="*" element={<PortalAccountProvider><Probe /></PortalAccountProvider>} />
      </Routes>
    </MemoryRouter>,
  );
}

function ReadinessProbe({ observe }: { observe: (value: { loading: boolean; selected: string | null; project: string | null; error: string | null }) => void }) {
  const { loading, selectedAccountId, error } = usePortalAccountContext();
  const location = useLocation();
  const project = new URLSearchParams(location.search).get("project");
  useEffect(() => {
    observe({ loading, selected: selectedAccountId, project, error });
  }, [loading, selectedAccountId, project, error, observe]);
  return <Probe />;
}

describe("PortalAccountProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    listPortalAccountsMock.mockReset();
    listPortalAccountsMock.mockResolvedValue(ACCOUNTS);
  });

  it.each(["/portal/history?view=access", "/portal/history?project=102&view=access"])(
    "keeps context pending until the URL project is resolved: %s",
    async (initialEntry) => {
      const observe = vi.fn();
      let resolveAccounts!: (value: PortalAccount[]) => void;
      listPortalAccountsMock.mockReturnValue(new Promise<PortalAccount[]>((resolve) => { resolveAccounts = resolve; }));
      render(<MemoryRouter initialEntries={[initialEntry]}><PortalAccountProvider><ReadinessProbe observe={observe} /></PortalAccountProvider></MemoryRouter>);

      expect(observe.mock.calls[0][0].loading).toBe(true);
      await act(async () => resolveAccounts(ACCOUNTS));
      await waitFor(() => expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false })));
      const ready = observe.mock.calls.map(([value]) => value).filter((value) => !value.loading);
      expect(ready.length).toBeGreaterThan(0);
      ready.forEach((value) => {
        expect(value.selected).not.toBeNull();
        expect(value.selected).toBe(value.project);
      });
      expect(screen.getByTestId("location")).toHaveTextContent("view=access");
    },
  );

  it.each(["empty", "error"])("finishes context loading for an %s catalogue", async (outcome) => {
    const observe = vi.fn();
    if (outcome === "empty") listPortalAccountsMock.mockResolvedValue([]);
    else listPortalAccountsMock.mockRejectedValue(new Error("Projects unavailable"));
    render(<MemoryRouter initialEntries={["/portal/history?project=102&view=access"]}><PortalAccountProvider><ReadinessProbe observe={observe} /></PortalAccountProvider></MemoryRouter>);
    await waitFor(() => expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, selected: null })));
    if (outcome === "error") expect(observe.mock.lastCall?.[0].error).toBe("Projects unavailable");
  });

  it("uses the project query parameter as the tab authority", async () => {
    localStorage.setItem("selectedPortalAccountId", "101");
    renderProvider("/portal?project=102");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("102"));
    expect(localStorage.getItem("selectedPortalAccountId")).toBe("102");
  });

  it("keeps the mounted tab project when another tab changes the preference", async () => {
    const user = userEvent.setup();
    renderProvider("/portal?project=101");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("101"));

    localStorage.setItem("selectedPortalAccountId", "102");
    await user.click(screen.getByRole("button", { name: "Navigate without project" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/portal/storage-spaces?project=101"));
    expect(screen.getByTestId("selected")).toHaveTextContent("101");
  });

  it("switches the mounted tab when its URL selects another project", async () => {
    const user = userEvent.setup();
    renderProvider("/portal?project=101");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("101"));

    await user.click(screen.getByRole("button", { name: "Open project 102" }));

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("102"));
  });
});

function GuardedSettings() {
  const { selectedAccountId, setSelectedAccountId } = usePortalAccountContext();
  const [dirty, setDirty] = useState(false);
  return <><div data-testid="active-project">{selectedAccountId}</div><button onClick={() => setDirty(true)}>Edit setting</button><button onClick={() => setSelectedAccountId("102")}>Select project 102</button><SettingsNavigationGuard dirty={dirty} onDiscard={() => setDirty(false)} /></>;
}

it("defers project context and storage until navigation is accepted once", async () => {
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  setSessionUserCache({ id: 1 });
  listPortalAccountsMock.mockResolvedValue(ACCOUNTS);
  const router = createMemoryRouter([{ path: "/portal/settings", element: <PortalAccountProvider><GuardedSettings /></PortalAccountProvider> }], { initialEntries: ["/portal/settings?project=101"] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByTestId("active-project")).toHaveTextContent("101"));
  const user = userEvent.setup();
  await user.click(screen.getByText("Edit setting"));
  await user.click(screen.getByText("Select project 102"));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByTestId("active-project")).toHaveTextContent("101");
  expect(localStorage.getItem("selectedPortalAccountId")).toBe("101");
  await user.click(screen.getByText("Keep editing"));
  expect(router.state.location.search).toBe("?project=101");
  await user.click(screen.getByText("Select project 102"));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(screen.getByTestId("active-project")).toHaveTextContent("102"));
  expect(localStorage.getItem("selectedPortalAccountId")).toBe("102");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => router.dispose());
  setSessionUserCache(null);
});
