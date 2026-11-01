import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "../../api/executionContexts";
import { buildExecutionContext } from "../../test/executionContexts";
import {
  clearExecutionDestinationState,
  getExecutionDestinationForContext,
} from "../../api/executionDestinationState";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";
import { BrowserContextProvider, useBrowserContext } from "./BrowserContext";

const listExecutionContextsMock = vi.fn();

vi.mock("../../api/executionContexts", () => ({
  listExecutionContexts: (...args: unknown[]) => listExecutionContextsMock(...args),
}));

const CONTEXTS: ExecutionContext[] = [
  buildExecutionContext("conn-1", {
    kind: "connection",
    display_name: "Connection 1",
    connection_scope: "shared",
    endpoint_name: "Connection endpoint",
    endpoint_id: 10,
    endpoint_is_default: false,
    endpoint_url: "https://connection.example.test",
    storage_endpoint_capabilities: { metrics: true },
    destination_switching_allowed: true,
    execution_destinations: [
      {
        endpoint_id: 10,
        name: "Zone A",
        endpoint_url: "https://connection.example.test",
        provider: "ceph",
        region: null,
        realm_id: "realm-a",
        zonegroup_id: "zonegroup-a",
        zone_id: "zone-a",
        is_default: true,
        storage_endpoint_capabilities: { metrics: true },
      },
      {
        endpoint_id: 11,
        name: "Zone B",
        endpoint_url: "https://connection-zone-b.example.test",
        provider: "ceph",
        region: null,
        realm_id: "realm-a",
        zonegroup_id: "zonegroup-a",
        zone_id: "zone-b",
        is_default: false,
        storage_endpoint_capabilities: { metrics: false },
      },
    ],
    capabilities: { can_manage_iam: true, sts_capable: true, admin_api_capable: true },
  }),
  buildExecutionContext("s3u-2", {
    kind: "s3_user",
    display_name: "S3 User 2",
    endpoint_name: "Ceph endpoint",
    endpoint_is_default: true,
    endpoint_url: "https://ceph.example.test",
    storage_endpoint_capabilities: {},
    capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
  }),
];

function Probe() {
  const {
    selectedContextId,
    selectedExecutionEndpointId,
    selectedStorageEndpointCapabilities,
    setExecutionEndpointId,
    accessError,
  } = useBrowserContext();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="selected">{selectedContextId ?? "null"}</div>
      <div data-testid="selected-endpoint">{selectedExecutionEndpointId ?? "null"}</div>
      <div data-testid="selected-metrics">{String(selectedStorageEndpointCapabilities?.metrics ?? "none")}</div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <div data-testid="access-error">{accessError ?? "none"}</div>
      <button type="button" onClick={() => setExecutionEndpointId(11)}>Use Zone B</button>
      <button type="button" onClick={() => navigate("/browser/next")}>Navigate without context</button>
    </>
  );
}

function renderProvider(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="*"
          element={
            <BrowserContextProvider>
              <Probe />
            </BrowserContextProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("BrowserContextProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    clearExecutionDestinationState();
    listExecutionContextsMock.mockReset();
    listExecutionContextsMock.mockResolvedValue(CONTEXTS);
  });

  it("ignores legacy localStorage keys and falls back to the first context", async () => {
    localStorage.setItem("selectedS3AccountId", "conn-legacy");
    localStorage.setItem("selectedBrowserContextId", "s3u-legacy");
    localStorage.setItem("selectedExecutionContextId", "s3u-2");

    renderProvider("/browser");

    await waitFor(() => {
      expect(screen.getByTestId("selected")).toHaveTextContent("conn-1");
      expect(localStorage.getItem("selectedBrowserExecutionContextId")).toBe("conn-1");
      expect(screen.getByTestId("location")).toHaveTextContent("/browser?ctx=conn-1");
    });
  });

  it("uses the Browser-specific preference when present", async () => {
    localStorage.setItem("selectedBrowserExecutionContextId", "s3u-2");
    localStorage.setItem("selectedBrowserContextId", "conn-legacy");

    renderProvider("/browser");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("s3u-2"));
  });

  it("tracks and registers the selected multisite destination for an eligible connection", async () => {
    const user = userEvent.setup();
    renderProvider("/browser?ctx=conn-1");

    await waitFor(() => {
      expect(screen.getByTestId("selected-endpoint")).toHaveTextContent("10");
      expect(getExecutionDestinationForContext("conn-1")).toBe(10);
    });
    expect(screen.getByTestId("selected-metrics")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: "Use Zone B" }));

    await waitFor(() => {
      expect(screen.getByTestId("selected-endpoint")).toHaveTextContent("11");
      expect(getExecutionDestinationForContext("conn-1")).toBe(11);
    });
    expect(screen.getByTestId("selected-metrics")).toHaveTextContent("false");
  });

  it("prefers ctx query param over the Browser-specific preference", async () => {
    localStorage.setItem("selectedBrowserExecutionContextId", "s3u-2");

    renderProvider("/browser?ctx=conn-1");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(localStorage.getItem("selectedBrowserExecutionContextId")).toBe("conn-1");
  });

  it("accepts a Portal account returned by the Browser catalogue", async () => {
    listExecutionContextsMock.mockResolvedValueOnce([
      ...CONTEXTS,
      {
        kind: "portal_account",
        id: "101",
        display_name: "Portal project",
        role: "portal_user",
        capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
      },
    ]);

    renderProvider("/browser?ctx=101");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("101"));
    expect(localStorage.getItem("selectedBrowserExecutionContextId")).toBe("101");
  });

  it("replaces a forbidden remembered selection with the first authorized context", async () => {
    localStorage.setItem("selectedBrowserExecutionContextId", "conn-forbidden");

    renderProvider("/browser?ctx=conn-forbidden");

    await waitFor(() => {
      expect(screen.getByTestId("selected")).toHaveTextContent("conn-1");
      expect(localStorage.getItem("selectedBrowserExecutionContextId")).toBe("conn-1");
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/browser?ctx=conn-1");
    expect(screen.getByTestId("access-error")).toHaveTextContent("none");
  });

  it("keeps the mounted tab context when another tab changes the preference", async () => {
    const user = userEvent.setup();
    renderProvider("/browser?ctx=conn-1");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));

    localStorage.setItem("selectedBrowserExecutionContextId", "s3u-2");
    await user.click(screen.getByRole("button", { name: "Navigate without context" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/browser/next?ctx=conn-1"));
    expect(screen.getByTestId("selected")).toHaveTextContent("conn-1");
  });

  it("reloads execution contexts when refresh event is emitted", async () => {
    listExecutionContextsMock
      .mockResolvedValueOnce(CONTEXTS)
      .mockResolvedValueOnce([
        ...CONTEXTS,
        {
          kind: "connection",
          id: "conn-9",
          display_name: "Connection 9",
          capabilities: { can_manage_iam: true, sts_capable: true, admin_api_capable: true },
        },
      ]);

    renderProvider("/browser");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(listExecutionContextsMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event(EXECUTION_CONTEXTS_REFRESH_EVENT));
    });

    await waitFor(() => expect(listExecutionContextsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("selected")).toHaveTextContent("conn-1");
    expect(screen.getByTestId("location")).toHaveTextContent("/browser?ctx=conn-1");
  });
});
