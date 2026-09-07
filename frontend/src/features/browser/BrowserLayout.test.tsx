import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS } from "../../components/topbarControlWidths";
import type { SidebarBodyRenderArgs, SidebarLink } from "../../components/Sidebar";
import BrowserLayout, { useBrowserSidebarSlot } from "./BrowserLayout";

const useBrowserContextMock = vi.fn();
const fetchManagerContextMock = vi.hoisted(() => vi.fn(() => new Promise<never>(() => undefined)));
let capturedLayoutProps: {
  headerTitle?: string;
  hideSidebar?: boolean;
  navLinks?: SidebarLink[];
  renderSidebarBody?: (args: SidebarBodyRenderArgs) => ReactNode;
  topbarControlDescriptors?: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }>;
  mainClassName?: string;
  disableMainScroll?: boolean;
} = {};
let capturedSelectorProps: {
  selectedContextId?: string | null;
  selectedLabel?: string;
  triggerMode?: "icon" | "icon_label";
  widthClassName?: string;
} | null = null;

vi.mock("./BrowserContext", () => ({
  BrowserContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useBrowserContext: () => useBrowserContextMock(),
}));

vi.mock("../../api/managerContext", () => ({
  fetchManagerContext: fetchManagerContextMock,
}));

vi.mock("../../components/Layout", () => ({
  __esModule: true,
  default: (props: {
    headerTitle?: string;
    hideSidebar?: boolean;
    navLinks?: SidebarLink[];
    renderSidebarBody?: (args: SidebarBodyRenderArgs) => ReactNode;
    topbarControlDescriptors?: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }>;
    mainClassName?: string;
    disableMainScroll?: boolean;
    children?: ReactNode;
  }) => {
    capturedLayoutProps = props;
    return (
      <div>
        {props.topbarControlDescriptors?.map((descriptor) => (
          <div key={descriptor.id}>{descriptor.renderControl("icon_label")}</div>
        ))}
        {props.renderSidebarBody?.({
          compact: false,
          variant: "desktop",
          closeMobile: vi.fn(),
        })}
        {props.children}
      </div>
    );
  },
}));

vi.mock("../../components/TopbarContextAccountSelector", () => ({
  __esModule: true,
  default: (props: {
    selectedContextId?: string | null;
    selectedLabel?: string;
    triggerMode?: "icon" | "icon_label";
  }) => {
    capturedSelectorProps = props;
    return <button type="button">Browser account selector</button>;
  },
}));

vi.mock("../shared/storageEndpointLabel", () => ({
  formatAccountLabel: (account: { display_name?: string; name?: string }) => account.display_name ?? account.name ?? "Context",
}));

function buildBrowserContext(overrides?: Record<string, unknown>) {
  return {
    contexts: [
      { id: "ctx-1", display_name: "Main account" },
      { id: "ctx-2", display_name: "Archive account" },
    ],
    selectedContextId: "ctx-1",
    setSelectedContextId: vi.fn(),
    requiresContextSelection: true,
    contextsLoaded: true,
    sessionAccountName: null,
    accessError: null,
    ...overrides,
  };
}

function BrowserSidebarSlotConsumer() {
  const { setSidebarBody } = useBrowserSidebarSlot();
  useEffect(() => {
    setSidebarBody(({ compact }) => (
      <div>{compact ? "Compact browser sidebar" : "Browser sidebar body"}</div>
    ));
    return () => {
      setSidebarBody(null);
    };
  }, [setSidebarBody]);
  return (
    <div>
      Browser page content
      <Link to="/browser/profile">Open profile</Link>
    </div>
  );
}

function BrowserProfileConsumer() {
  return <div>User profile content</div>;
}

describe("BrowserLayout", () => {
  beforeEach(() => {
    capturedLayoutProps = {};
    capturedSelectorProps = null;
    useBrowserContextMock.mockReset();
    fetchManagerContextMock.mockClear();
  });

  it("keeps Browser on the shared topbar shell with a custom sidebar slot", async () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext());

    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <Routes>
          <Route path="/browser" element={<BrowserLayout />}>
            <Route index element={<BrowserSidebarSlotConsumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(capturedLayoutProps.headerTitle).toBe("Browser");
    await waitFor(() => {
      expect(capturedLayoutProps.hideSidebar).toBe(false);
    });
    expect(capturedLayoutProps.renderSidebarBody).toBeDefined();
    expect(screen.getByText("Browser sidebar body")).toBeInTheDocument();
    expect(capturedLayoutProps.topbarControlDescriptors?.map((descriptor) => descriptor.id)).toEqual(["account"]);
    expect(capturedLayoutProps.mainClassName).toBe("pb-0");
    expect(capturedLayoutProps.disableMainScroll).toBe(true);
    expect(screen.getByRole("button", { name: "Browser account selector" })).toBeInTheDocument();
    expect(capturedSelectorProps).toEqual(
      expect.objectContaining({
        selectedContextId: "ctx-1",
        selectedLabel: "Main account",
        widthClassName: TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
      })
    );
  });

  it("renders the only Browser account as a static topbar control", () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext({
      contexts: [{ id: "ctx-1", display_name: "Main account" }],
    }));

    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <Routes>
          <Route path="/browser" element={<BrowserLayout />}>
            <Route index element={<BrowserSidebarSlotConsumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: "Browser account selector" })).not.toBeInTheDocument();
    expect(screen.getByText("Main account")).toBeInTheDocument();
    expect(capturedSelectorProps).toBeNull();
  });

  it("keeps a single page-level Browser heading when no context is available", () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext({
      contexts: [],
      selectedContextId: null,
    }));

    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <Routes>
          <Route path="/browser" element={<BrowserLayout />}>
            <Route index element={<BrowserSidebarSlotConsumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Browser", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No private Browser connection", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Browser page content")).not.toBeInTheDocument();
  });

  it("replaces the workspace sidebar with standard Browser navigation on the profile route", async () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext());

    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <Routes>
          <Route path="/browser" element={<BrowserLayout />}>
            <Route index element={<BrowserSidebarSlotConsumer />} />
            <Route path="profile" element={<BrowserProfileConsumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Browser sidebar body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Open profile" }));

    expect(await screen.findByText("User profile content")).toBeInTheDocument();
    await waitFor(() => {
      expect(capturedLayoutProps.renderSidebarBody).toBeUndefined();
    });
    expect(capturedLayoutProps.hideSidebar).toBe(false);
    expect(capturedLayoutProps.navLinks).toEqual([
      { to: "/browser", label: "Browser", end: true, iconName: "folder" },
    ]);
    expect(capturedLayoutProps.topbarControlDescriptors).toBeUndefined();
    expect(capturedLayoutProps.mainClassName).toBeUndefined();
    expect(capturedLayoutProps.disableMainScroll).toBe(false);
  });

  it("renders the profile route without an available Browser context", () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext({
      contexts: [],
      selectedContextId: null,
      accessError: "Browser access unavailable",
    }));

    render(
      <MemoryRouter initialEntries={["/browser/profile"]}>
        <Routes>
          <Route path="/browser" element={<BrowserLayout />}>
            <Route path="profile" element={<BrowserProfileConsumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("User profile content")).toBeInTheDocument();
    expect(screen.queryByText("No private Browser connection")).not.toBeInTheDocument();
    expect(screen.queryByText("Browser access unavailable")).not.toBeInTheDocument();
    expect(capturedLayoutProps.hideSidebar).toBe(false);
    expect(capturedLayoutProps.topbarControlDescriptors).toBeUndefined();
    expect(fetchManagerContextMock).not.toHaveBeenCalled();
  });
});
