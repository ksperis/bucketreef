import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StorageEndpointsPage from "./StorageEndpointsPage";
import { setSessionUserCache } from "../../utils/workspaces";

const listStorageEndpointsMock = vi.fn();
const fetchStorageEndpointsMetaMock = vi.fn();
const createStorageEndpointMock = vi.fn();
const updateStorageEndpointMock = vi.fn();
const updateStorageEndpointTagsMock = vi.fn();
const setDefaultStorageEndpointMock = vi.fn();
const deleteStorageEndpointMock = vi.fn();
const listAdminTagDefinitionsMock = vi.fn();

const makeTag = (id: number, label: string, color_key = "neutral", scope = "standard") => ({
  id,
  label,
  color_key,
  scope,
});

function expectBefore(first: Element, second: Element) {
  expect(Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
}

function renderPage(initialEntry = "/admin/storage-endpoints") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/storage-endpoints" element={<StorageEndpointsPage />} />
        <Route path="/admin/storage-endpoints/:endpointId" element={<StorageEndpointsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      ceph_admin_enabled: true,
    },
  }),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
  fetchStorageEndpointsMeta: () => fetchStorageEndpointsMetaMock(),
  updateStorageEndpointTags: (id: number, payload: unknown) => updateStorageEndpointTagsMock(id, payload),
  detectStorageEndpointFeatures: vi.fn(),
  createStorageEndpoint: (payload: unknown) => createStorageEndpointMock(payload),
  deleteStorageEndpoint: (id: number) => deleteStorageEndpointMock(id),
  getStorageEndpoint: vi.fn(),
  setDefaultStorageEndpoint: (id: number) => setDefaultStorageEndpointMock(id),
  updateStorageEndpoint: (id: number, payload: unknown) => updateStorageEndpointMock(id, payload),
}));

vi.mock("../../api/tags", () => ({
  listAdminTagDefinitions: (domain: unknown) => listAdminTagDefinitionsMock(domain),
  listPrivateConnectionTagDefinitions: vi.fn(),
}));

function makeEndpoint(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 7,
    name: "Ceph Endpoint",
    endpoint_url: "https://ceph.example.test",
    provider: "ceph",
    is_default: true,
    is_editable: true,
    force_path_style: false,
    verify_tls: true,
    latitude: null,
    longitude: null,
    tags: [makeTag(801, "prod")],
    capabilities: {
      admin: true,
      account: true,
      usage: true,
      metrics: true,
      iam: true,
      sts: false,
      static_website: false,
      sns: false,
      sse: false,
      replication: false,
    },
    features: {
      admin: { enabled: true, endpoint: "https://admin.ceph.example.test" },
      account: { enabled: true },
      sts: { enabled: false },
      usage: { enabled: true },
      metrics: { enabled: true },
      static_website: { enabled: false },
      iam: { enabled: true },
      sns: { enabled: false },
      sse: { enabled: false },
      replication: { enabled: false },
      healthcheck: { enabled: true, mode: "http" },
    },
    has_admin_secret: false,
    has_supervision_secret: false,
    has_ceph_admin_secret: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StorageEndpointsPage tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionUserCache(null);
    fetchStorageEndpointsMetaMock.mockResolvedValue({ managed_by_env: false });
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint()]);
    createStorageEndpointMock.mockResolvedValue(makeEndpoint({ id: 8, name: "AWS Regional", provider: "aws", endpoint_url: "https://s3.us-east-1.amazonaws.com" }));
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(801, "prod"), makeTag(802, "rgw-a")]);
    updateStorageEndpointTagsMock.mockResolvedValue(makeEndpoint({ tags: [makeTag(801, "prod"), makeTag(802, "rgw-a")] }));
    updateStorageEndpointMock.mockResolvedValue(makeEndpoint());
    setDefaultStorageEndpointMock.mockResolvedValue(makeEndpoint());
    deleteStorageEndpointMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setSessionUserCache(null);
    localStorage.clear();
  });

  it("renders storage endpoints as a compact table listing", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listStorageEndpointsMock.mockResolvedValue([
      makeEndpoint({
        force_path_style: true,
        latitude: 43.6047,
        longitude: 1.4442,
        admin_access_key: "admin-key",
        has_admin_secret: true,
        supervision_access_key: "supervision-key",
        has_supervision_secret: true,
        ceph_admin_access_key: "ceph-admin-key",
        has_ceph_admin_secret: true,
        features: {
          admin: { enabled: true, endpoint: "https://admin.ceph.example.test" },
          account: { enabled: true },
          usage: { enabled: true },
          metrics: { enabled: true },
          sns: { enabled: false },
          sts: { enabled: false },
          static_website: { enabled: false },
          iam: { enabled: true },
          sse: { enabled: false },
          replication: { enabled: false },
          healthcheck: { enabled: true, mode: "s3", url: "https://health.ceph.example.test" },
        },
      }),
    ]);

    renderPage();
    await screen.findByText("Ceph Endpoint");

    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    ["Endpoint", "Provider", "Connection", "Enabled services", "Actions"].forEach((name) => {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    });

    const row = screen.getByText("Ceph Endpoint").closest("tr");
    expect(row).not.toBeNull();
    const endpointRow = within(row as HTMLElement);

    expect(endpointRow.getByText("Ceph Endpoint").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(endpointRow.getByText("https://ceph.example.test")).toBeInTheDocument();
    expect(endpointRow.queryByText("https://admin.ceph.example.test")).not.toBeInTheDocument();
    expect(endpointRow.getAllByText("Default")).toHaveLength(1);
    expect(endpointRow.getByText("Not specified")).toBeInTheDocument();
    expect(endpointRow.getByText("prod")).toBeInTheDocument();
    expect(endpointRow.getByText("Ceph").closest("td")).toHaveAttribute("data-label", "Provider");
    expect(endpointRow.getByText("Path style").closest("td")).toHaveAttribute("data-label", "Connection");
    expect(endpointRow.getByText("TLS verification on")).toBeInTheDocument();
    expect(endpointRow.getByText("Admin")).toBeInTheDocument();
    expect(endpointRow.getByText("+3")).toBeInTheDocument();
    for (const hidden of ["43.6047, 1.4442", "https://health.ceph.example.test", "SNS off", "admin-key", "supervision-key", "ceph-admin-key", "(secret stored)"]) {
      expect(endpointRow.queryByText(hidden)).not.toBeInTheDocument();
    }
    expect(endpointRow.queryByRole("button", { name: "Open endpoint Ceph Endpoint" })).not.toBeInTheDocument();
    expect(endpointRow.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    const actionCell = endpointRow.getByRole("button", { name: "Edit" }).closest("td");
    expect(actionCell).toHaveAttribute("data-mobile-actions", "true");
    expect(actionCell).not.toHaveAttribute("data-table-actions");
    expect(within(table).getByRole("columnheader", { name: "Actions" })).not.toHaveAttribute("data-table-actions");
    expect(endpointRow.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    fireEvent.click(endpointRow.getByText("https://ceph.example.test"));
    expect(await screen.findByRole("heading", { name: "Edit storage endpoint · Ceph Endpoint" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Manage connection settings, operational credentials, capabilities, and health checks for this endpoint."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Credentials" }));
    const opsHelp = screen.getByText("What are Admin Ops and Supervision Ops?").parentElement;
    expect(opsHelp).not.toBeNull();
    expect(within(opsHelp as HTMLElement).getByText(/keys let BucketReef create RGW accounts and S3 users/)).toBeVisible();
    expect(within(opsHelp as HTMLElement).getByText("Ceph (radosgw-admin) examples")).toBeVisible();
    expect(within(opsHelp as HTMLElement).queryByRole("button", { name: /show|hide/i })).not.toBeInTheDocument();
  });

  it("lets superadmin edit endpoint tags even when endpoints are env-managed", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    fetchStorageEndpointsMetaMock.mockResolvedValue({ managed_by_env: true });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    await screen.findByRole("heading", { name: "Storage endpoint · Ceph Endpoint" });
    fireEvent.focus(await screen.findByRole("textbox", { name: "Add a tag for this endpoint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add tag rgw-a" }));
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));

    await waitFor(() => {
      expect(updateStorageEndpointTagsMock).toHaveBeenCalledWith(7, {
        tags: [
          expect.objectContaining({ label: "prod", color_key: "neutral" }),
          expect.objectContaining({ label: "rgw-a", color_key: "neutral" }),
        ],
      });
    });
  });

  it("opens an env-managed endpoint as a tabbed read-only page while keeping tags editable", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    fetchStorageEndpointsMetaMock.mockResolvedValue({ managed_by_env: true });
    listStorageEndpointsMock.mockResolvedValue([
      makeEndpoint({
        admin_access_key: "admin-key",
        has_admin_secret: true,
        supervision_access_key: "supervision-key",
        has_supervision_secret: true,
      }),
    ]);

    renderPage("/admin/storage-endpoints/7");

    expect(await screen.findByRole("heading", { name: "Storage endpoint · Ceph Endpoint" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Loading existing endpoint tags...")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Connection" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Endpoint name")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Endpoint name")).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Add a tag for this endpoint" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save tags" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "Credentials" }));
    expect(screen.getByLabelText("Admin access key")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Admin access key")).toBeEnabled();
    expect(screen.getAllByText("Stored — value hidden", { selector: "div" })).toHaveLength(2);
    expect(screen.queryByLabelText("Admin secret key")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Supervision access key")).toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("tab", { name: "Capabilities & health" }));
    expect(screen.getByLabelText("SNS topics enabled")).toBeDisabled();
    expect(screen.getByLabelText("Healthcheck mode")).toBeDisabled();
  });

  it("keeps tags read-only for a non-superadmin on the endpoint page", async () => {
    setSessionUserCache({ id: 2, role: "ui_admin" });
    fetchStorageEndpointsMetaMock.mockResolvedValue({ managed_by_env: true });

    renderPage("/admin/storage-endpoints/7");

    expect(await screen.findByRole("heading", { name: "Storage endpoint · Ceph Endpoint" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Add a tag for this endpoint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to endpoints" })).toBeInTheDocument();
  });

  it("keeps endpoint tags visible but hides editing from ui_admin", async () => {
    setSessionUserCache({ id: 2, role: "ui_admin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("prod").parentElement?.className).toContain("text-[10px]");
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
  });

  it("keeps endpoint tag editing visible on the identity row", async () => {
    setSessionUserCache({ id: 3, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());

    const dialog = screen.getByRole("heading", { name: "New storage endpoint" }).closest(".workflow-page");
    if (!dialog) {
      throw new Error("New storage endpoint workflow page not found");
    }
    const storageName = within(dialog).getByLabelText("Endpoint name");
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this endpoint" });
    expect(tagInput).toBeInTheDocument();
    expect(tagInput.parentElement?.parentElement?.className).toContain("min-h-10");
    expect(within(dialog).getByText("Endpoint tags")).toBeInTheDocument();
    expectBefore(storageName, tagInput);
    expectBefore(tagInput, within(dialog).getByText("Provider"));
    expectBefore(within(dialog).getByText("Provider"), within(dialog).getByText("S3 endpoint URL"));
  });

  it("submits Ceph bucket replication feature when enabled", async () => {
    setSessionUserCache({ id: 4, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Endpoint name"), { target: { value: "Ceph Replication" } });
    fireEvent.change(screen.getByLabelText("S3 endpoint URL"), { target: { value: "https://ceph-repl.example.test" } });
    fireEvent.click(screen.getByRole("tab", { name: "Capabilities & health" }));
    fireEvent.click(screen.getByLabelText("Bucket replication enabled"));
    fireEvent.click(screen.getByRole("button", { name: "Create endpoint" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Ceph Replication",
          endpoint_url: "https://ceph-repl.example.test",
          provider: "ceph",
        })
      );
    });
    const payload = createStorageEndpointMock.mock.calls[0][0] as { features_config?: string };
    expect(payload.features_config).toContain("replication:\n    enabled: true");
  });

  it("preconfigures AWS endpoint defaults and submits AWS features", async () => {
    setSessionUserCache({ id: 5, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Endpoint name"), { target: { value: "AWS Regional" } });
    fireEvent.click(screen.getByLabelText("AWS"));

    expect(screen.getByLabelText("S3 endpoint URL")).toHaveValue("https://s3.us-east-1.amazonaws.com");
    expect(screen.getByLabelText("Region (optional)")).toHaveValue("us-east-1");
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(39.0438);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(-77.4874);
    expect(screen.queryByText("Management")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create endpoint" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AWS Regional",
          endpoint_url: "https://s3.us-east-1.amazonaws.com",
          region: "us-east-1",
          provider: "aws",
          force_path_style: false,
          verify_tls: true,
          latitude: 39.0438,
          longitude: -77.4874,
        })
      );
    });
    const payload = createStorageEndpointMock.mock.calls[0][0] as { features_config?: string };
    expect(payload.features_config).toContain("sts:\n    enabled: true\n    endpoint: https://sts.us-east-1.amazonaws.com");
    expect(payload.features_config).toContain("iam:\n    enabled: true\n    endpoint: https://iam.amazonaws.com");
    expect(payload.features_config).toContain("static_website:\n    enabled: true");
    expect(payload.features_config).toContain("sse:\n    enabled: true");
    expect(payload.features_config).toContain("sns:\n    enabled: false");
    expect(payload.features_config).toContain("replication:\n    enabled: false");
  });

  it("syncs AWS generated endpoints when the region changes", async () => {
    setSessionUserCache({ id: 5, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("AWS"));
    fireEvent.change(screen.getByLabelText("Region (optional)"), { target: { value: "eu-west-3" } });

    expect(screen.getByLabelText("S3 endpoint URL")).toHaveValue("https://s3.eu-west-3.amazonaws.com");
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(48.8566);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(2.3522);
    fireEvent.click(screen.getByRole("tab", { name: "Capabilities & health" }));
    expect(screen.getByLabelText("STS endpoint")).toHaveValue("https://sts.eu-west-3.amazonaws.com");
    expect(screen.getByLabelText("IAM endpoint")).toHaveValue("https://iam.amazonaws.com");
  });

  it("keeps AWS endpoint fields read-only and submits computed values", async () => {
    setSessionUserCache({ id: 6, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Endpoint name"), { target: { value: "AWS Locked" } });
    fireEvent.click(screen.getByLabelText("AWS"));
    expect(screen.getByLabelText("S3 endpoint URL")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("Region (optional)"), { target: { value: "eu-west-3" } });
    fireEvent.click(screen.getByRole("tab", { name: "Capabilities & health" }));
    expect(screen.getByLabelText("STS endpoint")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("IAM endpoint")).toHaveAttribute("readonly");

    fireEvent.change(screen.getByLabelText("STS endpoint"), {
      target: { value: "https://sts.proxy.example.test" },
    });
    fireEvent.change(screen.getByLabelText("IAM endpoint"), {
      target: { value: "https://iam.proxy.example.test" },
    });
    expect(screen.getByLabelText("STS endpoint")).toHaveValue("https://sts.eu-west-3.amazonaws.com");
    expect(screen.getByLabelText("IAM endpoint")).toHaveValue("https://iam.amazonaws.com");
    fireEvent.click(screen.getByRole("tab", { name: "Connection" }));
    fireEvent.change(screen.getByLabelText("S3 endpoint URL"), { target: { value: "https://s3.proxy.example.test" } });
    expect(screen.getByLabelText("S3 endpoint URL")).toHaveValue("https://s3.eu-west-3.amazonaws.com");
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(48.8566);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(2.3522);

    fireEvent.click(screen.getByRole("button", { name: "Create endpoint" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AWS Locked",
          endpoint_url: "https://s3.eu-west-3.amazonaws.com",
          region: "eu-west-3",
          provider: "aws",
          force_path_style: false,
          latitude: 48.8566,
          longitude: 2.3522,
        })
      );
    });
    const payload = createStorageEndpointMock.mock.calls[0][0] as { features_config?: string };
    expect(payload.features_config).toContain("endpoint: https://sts.eu-west-3.amazonaws.com");
    expect(payload.features_config).toContain("endpoint: https://iam.amazonaws.com");
  });

  it("clears AWS coordinates when the region is unknown", async () => {
    setSessionUserCache({ id: 6, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Endpoint name"), { target: { value: "AWS Unknown" } });
    fireEvent.click(screen.getByLabelText("AWS"));
    fireEvent.change(screen.getByLabelText("Region (optional)"), { target: { value: "moon-west-1" } });

    expect(screen.getByLabelText("S3 endpoint URL")).toHaveValue("https://s3.moon-west-1.amazonaws.com");
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(null);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(null);

    fireEvent.click(screen.getByRole("button", { name: "Create endpoint" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AWS Unknown",
          region: "moon-west-1",
          latitude: null,
          longitude: null,
        })
      );
    });
  });

  it("does not auto-fill coordinates for non-AWS providers", async () => {
    setSessionUserCache({ id: 6, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Latitude (optional)"), { target: { value: "12.34" } });
    fireEvent.change(screen.getByLabelText("Longitude (optional)"), { target: { value: "56.78" } });
    fireEvent.click(screen.getByLabelText("Other"));

    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(12.34);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(56.78);
  });

  it("submits force path style when creating an endpoint", async () => {
    setSessionUserCache({ id: 6, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Endpoint name"), { target: { value: "Path Style" } });
    fireEvent.change(screen.getByLabelText("S3 endpoint URL"), { target: { value: "https://path-style.example.test" } });
    fireEvent.click(screen.getByLabelText("Force path style"));
    fireEvent.click(screen.getByRole("button", { name: "Create endpoint" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Path Style",
          endpoint_url: "https://path-style.example.test",
          force_path_style: true,
        })
      );
    });
  });

  it("submits GPS coordinates when creating an endpoint", async () => {
    setSessionUserCache({ id: 6, role: "ui_superadmin" });

    renderPage();
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Endpoint name"), { target: { value: "Geo Endpoint" } });
    fireEvent.change(screen.getByLabelText("S3 endpoint URL"), { target: { value: "https://geo.example.test" } });
    fireEvent.change(screen.getByLabelText("Latitude (optional)"), { target: { value: "48.8566" } });
    fireEvent.change(screen.getByLabelText("Longitude (optional)"), { target: { value: "2.3522" } });
    fireEvent.click(screen.getByRole("button", { name: "Create endpoint" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Geo Endpoint",
          endpoint_url: "https://geo.example.test",
          latitude: 48.8566,
          longitude: 2.3522,
        })
      );
    });
  });

  it("preloads and updates force path style when editing an endpoint", async () => {
    setSessionUserCache({ id: 7, role: "ui_superadmin" });
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint({ force_path_style: true })]);

    renderPage();
    await screen.findByText("Ceph Endpoint");
    expect(screen.getByText("Path style")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Force path style")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Force path style"));
    fireEvent.click(screen.getByRole("button", { name: "Update endpoint" }));

    await waitFor(() => {
      expect(updateStorageEndpointMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          force_path_style: false,
        })
      );
    });
  });

  it("preloads and clears GPS coordinates when editing an endpoint", async () => {
    setSessionUserCache({ id: 8, role: "ui_superadmin" });
    listStorageEndpointsMock.mockResolvedValue([
      makeEndpoint({ latitude: 43.6047, longitude: 1.4442 }),
    ]);

    renderPage();
    await screen.findByText("Ceph Endpoint");
    expect(screen.queryByText("43.6047, 1.4442")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(43.6047);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(1.4442);
    fireEvent.change(screen.getByLabelText("Latitude (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Longitude (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Update endpoint" }));

    await waitFor(() => {
      expect(updateStorageEndpointMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          latitude: null,
          longitude: null,
        })
      );
    });
  });

  it("filters the complete inventory without searching technical access keys", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listStorageEndpointsMock.mockResolvedValue([
      makeEndpoint({ name: "Primary Ceph", admin_access_key: "private-search-marker", region: "paris" }),
      makeEndpoint({ id: 8, name: "Archive", provider: "aws", endpoint_url: "https://archive.example.test", region: "eu-west-3", tags: [makeTag(2, "backup")], is_default: false }),
    ]);
    renderPage();
    await screen.findByText("Primary Ceph");
    const search = screen.getByRole("searchbox", { name: "Search" });
    for (const query of ["Archive", "archive.example", "aws", "eu-west-3", "backup"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByText("1 of 2 endpoints")).toBeInTheDocument();
      expect(screen.queryByText("Primary Ceph")).not.toBeInTheDocument();
    }
    fireEvent.change(search, { target: { value: "private-search-marker" } });
    expect(screen.getByText("No endpoints match these filters.")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "arch" } });
    fireEvent.click(screen.getByRole("button", { name: "Toggle filter match mode" }));
    expect(screen.getByText("No endpoints match these filters.")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: " ARCHIVE " } });
    expect(screen.getByText("1 of 2 endpoints")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), { target: { value: "ceph" } });
    expect(screen.getByText("No endpoints match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveValue("all");
    expectBefore(screen.getByText("Primary Ceph"), screen.getByText("Archive"));
  });

  it("keeps filters when returning from an endpoint and after setting its default", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint({ is_default: false })]);
    renderPage();
    await screen.findByText("Ceph Endpoint");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "prod" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), { target: { value: "ceph" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    await screen.findByRole("heading", { name: "Edit storage endpoint · Ceph Endpoint" });
    fireEvent.change(screen.getByLabelText("Endpoint name"), { target: { value: "Unsaved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to endpoints" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("searchbox")).toHaveValue("prod");
    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveValue("ceph");
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint()]);
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
    await screen.findByText("Default endpoint updated.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Set as default" })).not.toBeInTheDocument());
    expect(screen.getByRole("searchbox")).toHaveValue("prod");
    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveValue("ceph");
  });

  it("distinguishes a failed list from an empty inventory and supports Retry", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listStorageEndpointsMock.mockRejectedValueOnce(new Error("Inventory unavailable"));
    renderPage();
    expect(screen.getAllByText("Loading endpoints...").length).toBeGreaterThan(0);
    expect(screen.queryByText("No endpoints configured yet.")).not.toBeInTheDocument();
    await screen.findByText("Inventory unavailable");
    expect(screen.getByText("Endpoints unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No endpoints configured yet.")).not.toBeInTheDocument();
    listStorageEndpointsMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No endpoints configured yet.");
    expect(screen.getByText("0 endpoints")).toBeInTheDocument();
  });

  it("keeps configuration mutations unavailable when management metadata fails", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint({ is_default: false })]);
    fetchStorageEndpointsMetaMock.mockRejectedValueOnce(new Error("Metadata unavailable"));
    renderPage();
    await screen.findByText(/Unable to load endpoint management mode/);
    expect(screen.getByText("Ceph Endpoint")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New endpoint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit", exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete", exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set as default" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    await screen.findByRole("heading", { name: "Storage endpoint · Ceph Endpoint" });
    expect(screen.getByRole("button", { name: "Save tags" })).toBeDisabled();
    expect(screen.getByText(/Management mode is unavailable. Return to endpoints/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Back to endpoints" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Edit", exact: true })).toBeEnabled();
    expect(setDefaultStorageEndpointMock).not.toHaveBeenCalled();
  });

  it.each([["ui_admin", false], ["ui_superadmin", true]] as const)("keeps listing read-only for %s with environment management %s", async (role, managed) => {
    setSessionUserCache({ id: 1, role });
    fetchStorageEndpointsMetaMock.mockResolvedValue({ managed_by_env: managed });
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint({ is_default: false })]);
    renderPage();
    await screen.findByRole("button", { name: "View" });
    expect(screen.queryByRole("button", { name: "New endpoint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set as default" })).toBeDisabled();
  });

  it("allows a protected endpoint as default without duplicate requests or automatic retries", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint({ is_default: false, is_editable: false })]);
    let reject!: (reason: Error) => void;
    setDefaultStorageEndpointMock.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    renderPage();
    const button = await screen.findByRole("button", { name: "Set as default" });
    expectBefore(button, screen.getByRole("button", { name: "View" }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(setDefaultStorageEndpointMock).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Default update failed")));
    expect(screen.getByText("Default update failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set as default" })).toBeEnabled();
    expect(setDefaultStorageEndpointMock).toHaveBeenCalledTimes(1);
    expect(listStorageEndpointsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps deletion errors in the confirmation and protects an in-flight deletion", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    deleteStorageEndpointMock.mockRejectedValueOnce(new Error("Endpoint is in use"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
    let dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Delete", exact: true }));
    expect(await dialog.findByText("Endpoint is in use")).toBeInTheDocument();
    expect(deleteStorageEndpointMock).toHaveBeenCalledTimes(1);
    let resolve!: () => void;
    deleteStorageEndpointMock.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const button = dialog.getByRole("button", { name: "Delete", exact: true });
    fireEvent.click(button);
    fireEvent.click(button);
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(dialog.getByRole("button", { name: "Close modal" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteStorageEndpointMock).toHaveBeenCalledTimes(2);
    listStorageEndpointsMock.mockResolvedValue([]);
    await act(async () => resolve());
    await screen.findByText("Endpoint deleted.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await screen.findByText("No endpoints configured yet.");
  });

  it("shows at most two tags and never opens the editor from tag interaction", async () => {
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint({ tags: [makeTag(1, "prod"), makeTag(2, "west"), makeTag(3, "internal")] })]);
    renderPage();
    await screen.findByText("prod");
    expect(screen.getByText("west")).toBeInTheDocument();
    expect(screen.queryByText("internal")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("prod"));
    expect(screen.getByRole("heading", { name: "S3 Endpoints" })).toBeInTheDocument();
  });

  it("keeps disabled TLS verification explicit without inventing service or health state", async () => {
    const endpoint = makeEndpoint({ verify_tls: false, tags: [] });
    listStorageEndpointsMock.mockResolvedValue([{ ...endpoint,
      features: Object.fromEntries(Object.keys(endpoint.features).map((key) => [key, { enabled: false }])),
    }]);
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    renderPage();
    expect(await screen.findByText("TLS verification off")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Enabled services: None" })).toHaveTextContent("None enabled");
    expect(screen.queryByText("No tags")).not.toBeInTheDocument();
  });

});
