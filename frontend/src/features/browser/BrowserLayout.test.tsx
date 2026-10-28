import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS } from "../../components/topbarControlWidths";
import type { SidebarBodyRenderArgs, SidebarLink } from "../../components/Sidebar";
import BrowserLayout, { useBrowserSidebarSlot } from "./BrowserLayout";

const useBrowserContextMock = vi.fn();
const useOpenStackProjectSelectorMock = vi.fn();
const fetchManagerContextMock = vi.hoisted(() => vi.fn(() => new Promise<never>(() => undefined)));
const canAccessPrivateConnectionsSectionMock = vi.hoisted(() => vi.fn(() => false));
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
  additionalOptions?: Array<{ value: string; label: string }>;
} | null = null;

vi.mock("./BrowserContext", () => ({
  BrowserContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useBrowserContext: () => useBrowserContextMock(),
}));

vi.mock("../../api/managerContext", () => ({
  fetchManagerContext: fetchManagerContextMock,
}));

vi.mock("../shared/useOpenStackProjectSelector", () => ({
  useOpenStackProjectSelector: (options: unknown) => useOpenStackProjectSelectorMock(options),
}));

vi.mock("../../utils/workspaces", () => ({
  canAccessPrivateConnectionsSection: canAccessPrivateConnectionsSectionMock,
  readStoredUser: () => ({ id: 1 }),
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
    additionalOptions?: Array<{ value: string; label: string }>;
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
    refreshContexts: vi.fn(async () => []),
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
    useOpenStackProjectSelectorMock.mockReset();
    useOpenStackProjectSelectorMock.mockImplementation(() => ({
      candidateCount: 0,
      candidatesLoaded: true,
      selectorOptions: [],
      handleContextChange: (value: string, fallback: (selected: string) => void) => fallback(value),
      dialog: null,
      reloadOptions: vi.fn(),
      region: {
        visible: false,
        currentRegion: null,
        currentTargetId: "",
        options: [],
        loading: false,
        onChange: vi.fn(),
      },
    }));
    fetchManagerContextMock.mockClear();
    canAccessPrivateConnectionsSectionMock.mockReset();
    canAccessPrivateConnectionsSectionMock.mockReturnValue(false);
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

  it("offers a discovered OpenStack project when no executable Browser context exists yet", () => {
    const selectorOptions = [{
      value: "openstack-project-option:conn-1:project-a",
      label: "Project A · OpenStack",
    }];
    useOpenStackProjectSelectorMock.mockReturnValue({
      candidateCount: 1,
      candidatesLoaded: true,
      selectorOptions,
      handleContextChange: (value: string, fallback: (selected: string) => void) => fallback(value),
      dialog: null,
      reloadOptions: vi.fn(),
      region: {
        visible: false,
        currentRegion: null,
        currentTargetId: "",
        options: [],
        loading: false,
        onChange: vi.fn(),
      },
    });
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

    expect(screen.getByRole("button", { name: "Browser account selector" })).toBeInTheDocument();
    expect(capturedSelectorProps?.additionalOptions).toEqual(selectorOptions);
    expect(screen.getByRole("heading", { name: "Select a Browser context", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("No private Browser connection")).not.toBeInTheDocument();
  });

  it("does not load Manager context for a Browser-only private connection", async () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext({
      contexts: [{
        id: "conn-1",
        kind: "connection",
        display_name: "Private Browser connection",
        capabilities: {
          can_manage_iam: false,
          sts_capable: false,
          admin_api_capable: false,
        },
      }],
      selectedContextId: "conn-1",
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

    await waitFor(() => {
      expect(screen.getByText("Private Browser connection")).toBeInTheDocument();
    });
    expect(fetchManagerContextMock).not.toHaveBeenCalled();
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
    expect(screen.getByText(/Ask your administrator to allow manual private connections/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage private connections" })).not.toBeInTheDocument();
    expect(screen.queryByText("Browser page content")).not.toBeInTheDocument();
  });

  it("links to private connection management when the user can access it", () => {
    canAccessPrivateConnectionsSectionMock.mockReturnValue(true);
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

    expect(screen.getByRole("link", { name: "Manage private connections" })).toHaveAttribute(
      "href",
      "/browser/profile?tab=connections",
    );
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
