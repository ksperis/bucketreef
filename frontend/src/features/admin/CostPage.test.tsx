import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CostPage from "./CostPage";

const mocks = vi.hoisted(() => ({
  collectCostDaily: vi.fn(),
  downloadCostCsv: vi.fn(),
  getCostAnalytics: vi.fn(),
  getCostSubjects: vi.fn(),
  getCostSummary: vi.fn(),
  listStorageEndpoints: vi.fn(),
}));

vi.mock("../../api/cost", () => ({
  collectCostDaily: (...args: unknown[]) => mocks.collectCostDaily(...args),
  downloadCostCsv: (...args: unknown[]) => mocks.downloadCostCsv(...args),
  getCostAnalytics: (...args: unknown[]) => mocks.getCostAnalytics(...args),
  getCostSubjects: (...args: unknown[]) => mocks.getCostSubjects(...args),
  getCostSummary: (...args: unknown[]) => mocks.getCostSummary(...args),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => mocks.listStorageEndpoints(),
}));

vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const BarChart = ({
    children,
    data,
    onClick,
  }: {
    children?: ReactNode;
    data?: Array<Record<string, unknown>>;
    onClick?: (state: unknown) => void;
  }) => (
    <div
      data-testid="bar-chart"
      onClick={() => onClick?.({ activePayload: data?.length ? [{ payload: data[0] }] : [] })}
    >
      {children}
    </div>
  );
  const Chart = ({ children }: { children?: ReactNode }) => <div data-testid="cost-chart">{children}</div>;
  return {
    Area: () => null,
    AreaChart: Chart,
    Bar: () => null,
    BarChart,
    CartesianGrid: () => null,
    Cell: () => null,
    Pie: Passthrough,
    PieChart: Chart,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(initialEntry = "/admin/cost") {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CostPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function summary(overrides = {}) {
  return {
    month: "2026-07",
    storage_endpoint_id: null,
    usage: { bytes_in: 1024, bytes_out: 2048, ops_total: 1500 },
    storage: { avg_bytes: 4096, avg_gb_month: 0.0000038, total_objects: 10 },
    coverage: {
      days_collected: 24,
      days_in_month: 31,
      coverage_ratio: 24 / 31,
      storage_days_collected: 24,
      usage_days_collected: 24,
    },
    cost: {
      storage_cost: 5,
      egress_cost: 4,
      ingress_cost: 1,
      requests_cost: 2.5,
      total_cost: 12.5,
      currency: "EUR",
      pricing_source: "mixed",
    },
    ...overrides,
  };
}

function subject(
  id: number,
  name: string,
  {
    endpointId = 7,
    endpointName = "Ceph main",
    subjectType = "account",
    cost = 3.75,
  }: {
    endpointId?: number;
    endpointName?: string;
    subjectType?: "account" | "s3_user";
    cost?: number;
  } = {},
) {
  return {
    storage_endpoint_id: endpointId,
    storage_endpoint_name: endpointName,
    subject_type: subjectType,
    subject_id: id,
    name,
    rgw_identifier: `rgw-${id}`,
    storage: { avg_bytes: 2048, avg_gb_month: 0.0000019, total_objects: 4 },
    usage: { bytes_in: 512, bytes_out: 1024, ops_total: 250 },
    cost: {
      storage_cost: cost / 2,
      egress_cost: cost / 3,
      ingress_cost: 0,
      requests_cost: cost / 6,
      total_cost: cost,
      currency: "EUR",
      pricing_source: "global",
    },
  };
}

function analytics() {
  const topA = subject(42, "Tenant A", { cost: 8 });
  const topB = subject(99, "User B", {
    endpointId: 9,
    endpointName: "Ceph secondary",
    subjectType: "s3_user",
    cost: 4,
  });
  return {
    month: "2026-07",
    storage_endpoint_id: null,
    subject_type: "all",
    summary: summary(),
    by_endpoint: [
      {
        storage_endpoint_id: 7,
        storage_endpoint_name: "Ceph main",
        coverage: summary().coverage,
        cost: { ...summary().cost, total_cost: 8, pricing_source: "global" },
      },
      {
        storage_endpoint_id: 9,
        storage_endpoint_name: "Ceph secondary",
        coverage: summary().coverage,
        cost: { ...summary().cost, total_cost: 4.5, pricing_source: "endpoint_override" },
      },
    ],
    top_subjects: [topA, topB],
    concentration: {
      top_five_cost: 12,
      other_cost: 0.5,
      top_five_ratio: 0.96,
    },
    history: Array.from({ length: 12 }, (_, index) => ({
      month: `2025-${String(index + 8).padStart(2, "0")}`.replace("2025-13", "2026-01")
        .replace("2025-14", "2026-02")
        .replace("2025-15", "2026-03")
        .replace("2025-16", "2026-04")
        .replace("2025-17", "2026-05")
        .replace("2025-18", "2026-06")
        .replace("2025-19", "2026-07"),
      coverage: summary().coverage,
      cost: summary().cost,
    })),
  };
}

describe("CostPage", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    vi.restoreAllMocks();
    vi.clearAllMocks();

    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:cost");
    vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    mocks.listStorageEndpoints.mockResolvedValue([
      { id: 7, name: "Ceph main", provider: "ceph", endpoint_url: "https://rgw.example.test", is_default: true },
      { id: 9, name: "Ceph secondary", provider: "ceph", endpoint_url: "https://rgw2.example.test", is_default: false },
      { id: 8, name: "MinIO lab", provider: "minio", endpoint_url: "https://minio.example.test", is_default: false },
    ]);
    mocks.getCostSummary.mockResolvedValue(summary());
    mocks.getCostSubjects.mockImplementation((_month, _endpointId, _subjectType, page) => {
      const item = page === 2
        ? subject(43, "Tenant B", { endpointId: 9, endpointName: "Ceph secondary" })
        : subject(42, "Tenant A");
      return Promise.resolve({ items: [item], total: 30, page, page_size: 25, has_next: page === 1 });
    });
    mocks.getCostAnalytics.mockResolvedValue(analytics());
    mocks.collectCostDaily.mockResolvedValue({
      day: "2026-07-14",
      endpoints: 2,
      storage_records: 1,
      usage_records: 0,
      errors: [{ stage: "usage", endpoint_id: 7, subject: "account", subject_id: 42 }],
      retention: {
        quota_history: {
          hourly_retention_days: 30,
          daily_retention_days: 365,
          deleted_hourly: 0,
          deleted_daily: 0,
        },
        cost_history: {
          daily_retention_days: 365,
          deleted_usage_daily: 0,
          deleted_storage_daily: 0,
        },
      },
    });
    mocks.downloadCostCsv.mockResolvedValue(new Blob(["subject_type\n"], { type: "text/csv" }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to all endpoints and all subjects, paginates globally, links to dedicated detail, and exports the scope", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Cost" })).toBeInTheDocument();
    expect(await screen.findByText("Tenant A")).toBeInTheDocument();
    expect(mocks.getCostSummary).toHaveBeenCalledWith("2026-07", null);
    expect(mocks.getCostSubjects).toHaveBeenCalledWith("2026-07", null, "all", 1, 25, "name", "asc", "");
    expect(screen.getByRole("combobox", { name: "Endpoint" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Subject" })).toHaveValue("all");
    expect(screen.getByText(/Monthly totals.*All endpoints.*2026-07/)).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByText("RGW Account")).toBeInTheDocument();
    expect(within(table).getByText("Ceph main")).toBeInTheDocument();
    const detailLink = within(table).getByRole("link", { name: "View" });
    expect(detailLink).toHaveAttribute(
      "href",
      expect.stringContaining("/admin/cost/subject/account/42?"),
    );
    expect(detailLink.getAttribute("href")).toContain("endpoint_id=7");
    expect(detailLink.getAttribute("href")).toContain("return_to=");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Tenant B")).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.getCostSubjects).toHaveBeenLastCalledWith(
        "2026-07",
        null,
        "all",
        2,
        25,
        "name",
        "asc",
        "",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(mocks.downloadCostCsv).toHaveBeenCalledWith("2026-07", null, "all"));
  });

  it("applies endpoint, subject type, search, and sorting to the global subject list", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Tenant A");

    await user.selectOptions(screen.getByRole("combobox", { name: "Endpoint" }), "9");
    await user.selectOptions(screen.getByRole("combobox", { name: "Subject" }), "s3_user");
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "user b");
    fireEvent.click(screen.getByRole("button", { name: /^Cost$/ }));

    await waitFor(() =>
      expect(mocks.getCostSubjects).toHaveBeenLastCalledWith(
        "2026-07",
        9,
        "s3_user",
        1,
        25,
        "cost",
        "desc",
        "user b",
      ),
    );
    expect(mocks.getCostSummary).toHaveBeenLastCalledWith("2026-07", 9);
  });

  it("sorts the Ingress column through the global subject query", async () => {
    renderPage();
    await screen.findByText("Tenant A");

    fireEvent.click(screen.getByRole("button", { name: /^Ingress$/ }));

    await waitFor(() =>
      expect(mocks.getCostSubjects).toHaveBeenLastCalledWith(
        "2026-07",
        null,
        "all",
        1,
        25,
        "ingress",
        "desc",
        "",
      ),
    );
  });

  it("loads analytics lazily and drills down from endpoint and subject charts", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Tenant A");

    expect(mocks.getCostAnalytics).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Analytics" }));

    expect(await screen.findByRole("heading", { name: "Cost by component" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cost by endpoint" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "12-month cost trend" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Top 10 subjects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cost concentration" })).toBeInTheDocument();
    expect(mocks.getCostAnalytics).toHaveBeenCalledWith("2026-07", null, "all");

    const barCharts = screen.getAllByTestId("bar-chart");
    fireEvent.click(barCharts[0]);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Endpoint" })).toHaveValue("7"));
    await waitFor(() => expect(mocks.getCostAnalytics).toHaveBeenLastCalledWith("2026-07", 7, "all"));

    fireEvent.click(screen.getAllByTestId("bar-chart")[1]);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("/admin/cost/subject/account/42?"),
    );
  });

  it("restores list state from the URL and keeps subject filters out of the summary request", async () => {
    renderPage("/admin/cost?month=2026-06&endpoint_id=9&type=s3_user&search=needle&sort=endpoint&direction=desc&page=2&page_size=50&tab=subjects");

    await screen.findByText("Tenant B");
    expect(screen.getByLabelText("Month")).toHaveValue("2026-06");
    expect(screen.getByRole("combobox", { name: "Endpoint" })).toHaveValue("9");
    expect(screen.getByRole("combobox", { name: "Subject" })).toHaveValue("s3_user");
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("needle");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("endpoint");
    expect(screen.getByRole("combobox", { name: "Direction" })).toHaveValue("desc");
    expect(mocks.getCostSubjects).toHaveBeenCalledWith("2026-06", 9, "s3_user", 2, 50, "endpoint", "desc", "needle");
    expect(mocks.getCostSummary).toHaveBeenCalledWith("2026-06", 9);
  });

  it("shows manual collection details and reloads current data", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Tenant A");

    const disclosure = screen.getByText("Manual daily collection");
    await user.click(disclosure);
    await user.click(screen.getByRole("button", { name: "Collect daily" }));

    expect(await screen.findByText(/Collection finished with issues for/)).toBeInTheDocument();
    expect(screen.getByText("Usage: account #42 · endpoint #7")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getCostSummary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.getCostSubjects).toHaveBeenCalledTimes(2));
  });

  it("disables export when the selected month has no cost data", async () => {
    mocks.getCostSummary.mockResolvedValue(summary({
      usage: { bytes_in: 0, bytes_out: 0, ops_total: 0 },
      storage: { avg_bytes: null, avg_gb_month: null, total_objects: null },
      coverage: {
        days_collected: 0,
        days_in_month: 31,
        coverage_ratio: 0,
        storage_days_collected: 0,
        usage_days_collected: 0,
      },
      cost: null,
    }));
    mocks.getCostSubjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25, has_next: false });

    renderPage();

    expect(await screen.findByText("No subjects for this scope.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("keeps subject query errors inside the Subjects view", async () => {
    mocks.getCostSubjects.mockRejectedValue(new Error("subject query failed"));

    renderPage();

    expect(await screen.findByText("Unable to load subjects.")).toBeInTheDocument();
    expect(screen.getByText("subject query failed")).toBeInTheDocument();
  });
});
