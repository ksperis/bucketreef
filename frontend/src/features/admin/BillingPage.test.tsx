import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillingPage from "./BillingPage";

const mocks = vi.hoisted(() => ({
  collectBillingDaily: vi.fn(),
  downloadBillingCsv: vi.fn(),
  getBillingSubjectDetail: vi.fn(),
  getBillingSubjects: vi.fn(),
  getBillingSummary: vi.fn(),
  getBillingAnalysis: vi.fn(),
  listBillingStatements: vi.fn(),
  generateBillingStatements: vi.fn(),
  finalizeBillingStatement: vi.fn(),
  downloadBillingStatementSnapshot: vi.fn(),
  getBillingFinalizedPeriod: vi.fn(),
  getBillingStatement: vi.fn(),
  listBillingEntities: vi.fn(),
  listBillingEntityGroups: vi.fn(),
  listStorageEndpoints: vi.fn(),
}));

vi.mock("../../api/billing", () => ({
  collectBillingDaily: (...args: unknown[]) => mocks.collectBillingDaily(...args),
  downloadBillingCsv: (...args: unknown[]) => mocks.downloadBillingCsv(...args),
  getBillingSubjectDetail: (...args: unknown[]) => mocks.getBillingSubjectDetail(...args),
  getBillingSubjects: (...args: unknown[]) => mocks.getBillingSubjects(...args),
  getBillingSummary: (...args: unknown[]) => mocks.getBillingSummary(...args),
  getBillingAnalysis: (...args: unknown[]) => mocks.getBillingAnalysis(...args),
  listBillingStatements: (...args: unknown[]) => mocks.listBillingStatements(...args),
  generateBillingStatements: (...args: unknown[]) => mocks.generateBillingStatements(...args),
  finalizeBillingStatement: (...args: unknown[]) => mocks.finalizeBillingStatement(...args),
  downloadBillingStatementSnapshot: (...args: unknown[]) => mocks.downloadBillingStatementSnapshot(...args),
  getBillingFinalizedPeriod: (...args: unknown[]) => mocks.getBillingFinalizedPeriod(...args),
  getBillingStatement: (...args: unknown[]) => mocks.getBillingStatement(...args),
  listBillingEntities: (...args: unknown[]) => mocks.listBillingEntities(...args),
  listBillingEntityGroups: (...args: unknown[]) => mocks.listBillingEntityGroups(...args),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => mocks.listStorageEndpoints(),
}));

vi.mock("recharts", () => {
  const Chart = () => <div data-testid="billing-chart" />;
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Area: () => null,
    AreaChart: Chart,
    Bar: () => null,
    BarChart: Chart,
    CartesianGrid: () => null,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function renderPage() {
  render(
    <MemoryRouter>
      <BillingPage />
    </MemoryRouter>
  );
}

function rateResolution(overrides = {}) {
  return {
    status: "resolved",
    layer: "endpoint",
    rate_plan_id: 4,
    rate_plan_name: "default",
    rate_card_id: 9,
    rate_card_effective_from: "2026-01-01",
    rate_card_effective_to: null,
    source_assignment_id: null,
    billing_entity_id: null,
    billing_entity_name: null,
    conflicting_billing_entity_ids: [],
    conflicting_billing_entity_names: [],
    currency: "EUR",
    storage_charge_basis: "actual_usage",
    issues: [],
    ...overrides,
  };
}

function summary(overrides = {}) {
  return {
    month: "2026-06",
    storage_endpoint_id: 7,
    usage: { bytes_in: 1024, bytes_out: 2048, ops_total: 1500 },
    storage: { avg_bytes: 4096, avg_gb_month: 0.0000038, total_objects: 10 },
    coverage: {
      days_collected: 24,
      days_in_month: 30,
      coverage_ratio: 0.8,
      storage_days_collected: 24,
      usage_days_collected: 24,
    },
    cost: { total_cost: 12.5, currency: "EUR", rate_card_name: "default" },
    rate_resolution: rateResolution(),
    ...overrides,
  };
}

function subject(id: number, name: string) {
  return {
    subject_type: "account",
    subject_id: id,
    name,
    rgw_identifier: `rgw-${id}`,
    storage: { avg_bytes: 2048, avg_gb_month: 0.0000019, total_objects: 4 },
    usage: { bytes_in: 512, bytes_out: 1024, ops_total: 250 },
    cost: { total_cost: 3.75, currency: "EUR", rate_card_name: "default" },
    rate_resolution: rateResolution(),
  };
}

function detail(id: number, name: string) {
  return {
    month: "2026-06",
    subject_type: "account",
    subject_id: id,
    name,
    rgw_identifier: `rgw-${id}`,
    daily: [{ day: "2026-06-01", storage_bytes: 2048, bytes_in: 512, bytes_out: 1024, ops_total: 250 }],
    usage: { bytes_in: 512, bytes_out: 1024, ops_total: 250 },
    storage: { avg_bytes: 2048, avg_gb_month: 0.0000019, total_objects: 4 },
    coverage: {
      days_collected: 2,
      days_in_month: 30,
      coverage_ratio: 0.07,
      storage_days_collected: 1,
      usage_days_collected: 2,
    },
    cost: { total_cost: 3.75, currency: "EUR", rate_card_name: "default" },
    rate_resolution: rateResolution(),
  };
}

function analysis() {
  const commonCoverage = {
    member_count: 1,
    expected_daily_observations: 31,
    storage_observations: 31,
    usage_observations: 31,
    storage_coverage_ratio: "1.000000",
    usage_coverage_ratio: "1.000000",
    quota_observations_collected: 31,
    quota_observations_expected: 31,
    quota_coverage_ratio: "1.000000",
  };
  const quotaLine = {
    billing_entity_id: 10,
    billing_entity_name: "Research",
    subject_type: "account",
    subject_id: 42,
    subject_name: "Lab A",
    rgw_identifier: "RGW-LAB-A",
    storage_endpoint_id: 7,
    storage_endpoint_name: "Ceph main",
    membership_reasons: [{ kind: "tag", tag_definition_id: 3, label: "research" }],
    membership_conflict: false,
    included_in_total: true,
    usage: { bytes_in: 1024, bytes_out: 2048, ops_total: 200 },
    storage: { avg_bytes: 1073741824, avg_gb_month: "1.000000000000", total_objects: 12 },
    coverage: {
      days_collected: 31,
      days_in_month: 31,
      coverage_ratio: 1,
      storage_days_collected: 31,
      usage_days_collected: 31,
    },
    cost: {
      currency: "EUR",
      total_cost: "2.000000",
      complete: true,
      storage_quantity: {
        basis: "allocated_quota",
        quantity_gib_month: "2.000000000000",
        observations_collected: 31,
        observations_expected: 31,
        calendar_days: 31,
        coverage_ratio: "1.000000",
        status: "complete",
        issues: [],
      },
    },
    rate_resolution: rateResolution({
      layer: "billing_entity",
      billing_entity_id: 10,
      billing_entity_name: "Research",
      rate_plan_name: "reserved-capacity",
      storage_charge_basis: "allocated_quota",
    }),
    complete: true,
    issues: [],
  };
  const usageLine = {
    ...quotaLine,
    billing_entity_id: 11,
    billing_entity_name: "Platform",
    subject_id: 43,
    subject_name: "Platform A",
    rgw_identifier: "RGW-PLATFORM-A",
    storage_endpoint_id: 9,
    storage_endpoint_name: "Ceph secondary",
    membership_reasons: [{ kind: "explicit_include" }],
    cost: {
      currency: "USD",
      total_cost: "1.500000",
      complete: true,
      storage_quantity: {
        basis: "actual_usage",
        quantity_gib_month: "1.000000000000",
        observations_collected: 31,
        observations_expected: 31,
        calendar_days: 31,
        coverage_ratio: "1.000000",
        status: "complete",
        issues: [],
      },
    },
    rate_resolution: rateResolution({
      layer: "endpoint",
      rate_plan_name: "platform-usage",
      currency: "USD",
      storage_charge_basis: "actual_usage",
    }),
  };
  return {
    month: "2026-07",
    days_in_month: 31,
    entities: [
      {
        billing_entity_id: 10,
        billing_entity_name: "Research",
        billing_entity_code: "RES",
        subject_type: "account",
        member_count: 1,
        conflict_count: 0,
        currency_totals: [{ currency: "EUR", total_cost: "2.000000", complete: true }],
        storage_charge_bases: ["allocated_quota"],
        coverage: commonCoverage,
        complete: true,
        issues: [],
        lines: [quotaLine],
      },
      {
        billing_entity_id: 11,
        billing_entity_name: "Platform",
        billing_entity_code: "PLAT",
        subject_type: "account",
        member_count: 1,
        conflict_count: 0,
        currency_totals: [{ currency: "USD", total_cost: "1.500000", complete: true }],
        storage_charge_bases: ["actual_usage"],
        coverage: { ...commonCoverage, quota_observations_collected: 0, quota_observations_expected: 0, quota_coverage_ratio: null },
        complete: true,
        issues: [],
        lines: [usageLine],
      },
    ],
    groups: [
      {
        billing_entity_group_id: 20,
        billing_entity_group_name: "DSI",
        billing_entity_group_code: "DSI",
        active: true,
        member_entity_ids: [10, 11],
        currency_totals: [
          { currency: "EUR", total_cost: "2.000000", billing_entity_ids: [10], complete: true },
          { currency: "USD", total_cost: "1.500000", billing_entity_ids: [11], complete: true },
        ],
        missing_entity_ids: [],
        conflict_count: 0,
        storage_charge_bases: ["actual_usage", "allocated_quota"],
        coverage: {
          member_count: 2,
          expected_daily_observations: 62,
          storage_observations: 62,
          usage_observations: 62,
          storage_coverage_ratio: "1.000000",
          usage_coverage_ratio: "1.000000",
          quota_observations_collected: 31,
          quota_observations_expected: 31,
          quota_coverage_ratio: "1.000000",
        },
        complete: true,
        issues: [],
      },
    ],
    unassigned: [
      {
        subject_type: "account",
        subject_id: 99,
        name: "Unassigned",
        rgw_identifier: "RGW-UNASSIGNED",
        storage_endpoint_id: 7,
        storage_endpoint_name: "Ceph main",
      },
    ],
    conflicts: [],
  };
}

describe("BillingPage", () => {
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
    vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:billing");
    vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mocks.listStorageEndpoints.mockResolvedValue([
      { id: 7, name: "Ceph main", provider: "ceph", endpoint_url: "https://rgw.example.test", is_default: true },
      { id: 8, name: "MinIO lab", provider: "minio", endpoint_url: "https://minio.example.test", is_default: false },
    ]);
    mocks.getBillingSummary.mockResolvedValue(summary());
    mocks.getBillingSubjects.mockImplementation((_month, _endpointId, _subjectType, page) => {
      const item = page === 2 ? subject(43, "Tenant B") : subject(42, "Tenant A");
      return Promise.resolve({ items: [item], total: 30, page, page_size: 25, has_next: page === 1 });
    });
    mocks.getBillingSubjectDetail.mockImplementation((_month, _endpointId, _type, subjectId) =>
      Promise.resolve(detail(Number(subjectId), Number(subjectId) === 43 ? "Tenant B" : "Tenant A"))
    );
    mocks.collectBillingDaily.mockResolvedValue({
      day: "2026-06-30",
      endpoints: 1,
      storage_records: 1,
      usage_records: 0,
      errors: [{ stage: "usage", endpoint_id: 7, subject: "account", subject_id: 42 }],
    });
    mocks.downloadBillingCsv.mockResolvedValue(new Blob(["subject_type\n"], { type: "text/csv" }));
    mocks.getBillingAnalysis.mockResolvedValue(analysis());
    mocks.listBillingStatements.mockResolvedValue([]);
    mocks.listBillingEntities.mockResolvedValue([]);
    mocks.listBillingEntityGroups.mockResolvedValue([]);
    mocks.getBillingFinalizedPeriod.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders billing data, paginates subjects, selects a subject, and exports CSV", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(await screen.findByText("Tenant A")).toBeInTheDocument();
    expect(screen.getByText("12.50 EUR")).toBeInTheDocument();
    expect(screen.getByText(/Endpoint Rate Plan.*Rate Plan: default.*Effective 2026-01-01/)).toBeInTheDocument();
    expect(mocks.getBillingSubjects).toHaveBeenCalledWith("2026-07", 7, "account", 1, 25, "name", "asc");
    expect(screen.getByLabelText("Month")).toHaveValue("2026-07");
    expect(screen.getByLabelText("Month")).toHaveAttribute("type", "month");
    expect(screen.getByRole("combobox", { name: "Endpoint" })).toHaveValue("7");
    expect(screen.getByRole("combobox", { name: "Subject" })).toHaveValue("account");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("name");
    expect(screen.getByRole("combobox", { name: "Direction" })).toHaveValue("asc");
    expect(screen.getByLabelText("Collect day")).toHaveAttribute("type", "date");

    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByText("Tenant A").closest("td")).toHaveAttribute(
      "data-mobile-primary",
      "true"
    );
    expect(within(table).queryByRole("button", { name: "View billing detail for Tenant A" })).not.toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "View" }).closest("td")).toHaveAttribute(
      "data-mobile-actions",
      "true",
    );
    expect(within(table).getByText("2.0 KB").closest("td")).toHaveAttribute("data-label", "Storage avg");
    expect(within(table).getByText("250").closest("td")).toHaveAttribute("data-label", "Requests");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Tenant B")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getBillingSubjects).toHaveBeenLastCalledWith("2026-07", 7, "account", 2, 25, "name", "asc"));

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    await waitFor(() => expect(mocks.getBillingSubjectDetail).toHaveBeenCalledWith("2026-07", 7, "account", 43));
    expect(await screen.findByText("This subject has partial source coverage: Storage 1d · Usage 2d.")).toBeInTheDocument();
    expect(screen.getAllByText(/Endpoint Rate Plan.*Rate Plan: default.*Effective 2026-01-01/).length).toBeGreaterThan(0);

    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);
    await waitFor(() => expect(mocks.downloadBillingCsv).toHaveBeenCalledWith("2026-07", 7));
  });

  it("sorts subjects from the shared table headers", async () => {
    renderPage();

    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: /^Cost$/ }));

    await waitFor(() => expect(mocks.getBillingSubjects).toHaveBeenLastCalledWith("2026-07", 7, "account", 1, 25, "cost", "desc"));

    fireEvent.click(screen.getByRole("button", { name: /Cost/ }));

    await waitFor(() => expect(mocks.getBillingSubjects).toHaveBeenLastCalledWith("2026-07", 7, "account", 1, 25, "cost", "asc"));
  });

  it("selects a subject with keyboard activation", async () => {
    const user = userEvent.setup();
    renderPage();

    const subjectButton = await screen.findByRole("button", { name: "View" });
    subjectButton.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(mocks.getBillingSubjectDetail).toHaveBeenCalledWith("2026-07", 7, "account", 42));
  });

  it("shows manual collection details with partial errors", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Tenant A");
    const disclosure = screen.getByText("Manual daily collection");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    await user.click(disclosure);
    await user.click(screen.getByRole("button", { name: "Collect daily" }));

    expect(await screen.findByText(/Collection finished with issues for/)).toBeInTheDocument();
    expect(screen.getByText("Usage: account #42 · endpoint #7")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getBillingSummary).toHaveBeenCalledTimes(2));
    await user.click(disclosure);
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Usage: account #42 · endpoint #7")).toBeVisible();
    expect(screen.getByText(/Collection finished with issues for/)).toBeVisible();
  });

  it("keeps monthly totals global when filtering subjects and reloads them for a new month", async () => {
    renderPage();
    await screen.findByText("Tenant A");
    expect(screen.getByLabelText("Month").closest("header")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Subjects" })).getByLabelText("Subject")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "s3_user" } });
    await waitFor(() => expect(mocks.getBillingSubjects).toHaveBeenLastCalledWith("2026-07", 7, "s3_user", 1, 25, "name", "asc"));
    expect(mocks.getBillingSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByText("12.50 EUR")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-06" } });
    await waitFor(() => expect(mocks.getBillingSummary).toHaveBeenLastCalledWith("2026-06", 7));
    expect(screen.getByText(/Monthly totals.*2026-06/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "cost" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "desc" } });
    await waitFor(() => expect(mocks.getBillingSubjects).toHaveBeenLastCalledWith("2026-06", 7, "s3_user", 1, 25, "cost", "desc"));
    expect(mocks.getBillingSummary).toHaveBeenCalledTimes(2);
  });

  it("disables export and explains empty billing data", async () => {
    mocks.getBillingSummary.mockResolvedValue(summary({
      usage: { bytes_in: 0, bytes_out: 0, ops_total: 0 },
      storage: { avg_bytes: null, avg_gb_month: null, total_objects: null },
      coverage: { days_collected: 0, days_in_month: 30, coverage_ratio: 0, storage_days_collected: 0, usage_days_collected: 0 },
      cost: null,
    }));
    mocks.getBillingSubjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25, has_next: false });

    renderPage();

    expect(await screen.findByText("No subjects for this scope.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("shows allocated quota provenance and incomplete pricing coverage", async () => {
    mocks.getBillingSummary.mockResolvedValue(
      summary({
        cost: {
          total_cost: "9.677419",
          currency: "EUR",
          rate_card_name: "quota-plan",
          complete: false,
          storage_quantity: {
            basis: "allocated_quota",
            quantity_gib_month: "96.774193548387",
            observations_collected: 30,
            observations_expected: 31,
            calendar_days: 31,
            coverage_ratio: "0.967742",
            status: "blocked",
            issues: ["missing_quota_observation"],
          },
        },
      }),
    );

    renderPage();

    expect(await screen.findByText(/Allocated quota.*97% pricing coverage/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Storage pricing is incomplete for this month. Review the storage pricing coverage before using this estimate.",
      ),
    ).toBeInTheDocument();
  });

  it("shows an explicit Billing Entity conflict instead of a generic missing rate", async () => {
    mocks.getBillingSubjectDetail.mockResolvedValue(
      {
        ...detail(42, "Tenant A"),
        cost: null,
        rate_resolution: rateResolution({
          status: "conflict",
          layer: "billing_entity",
          rate_plan_id: null,
          rate_plan_name: null,
          rate_card_id: null,
          rate_card_effective_from: null,
          currency: null,
          storage_charge_basis: null,
          conflicting_billing_entity_ids: [10, 11],
          conflicting_billing_entity_names: ["Research", "DSI"],
          issues: ["billing_entity_membership_conflict"],
        }),
      },
    );

    renderPage();
    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(
      await screen.findByText(
        "Rate resolution conflict. This subject matches multiple Billing Entities: Research, DSI. Resolve the membership conflict before using this cost.",
      ),
    ).toBeInTheDocument();
  });

  it("explains a Rate Plan assignment with no effective version", async () => {
    mocks.getBillingSubjectDetail.mockResolvedValue(
      {
        ...detail(42, "Tenant A"),
        cost: null,
        rate_resolution: rateResolution({
          status: "missing",
          layer: "direct",
          rate_plan_name: "reserved-capacity",
          rate_card_id: null,
          rate_card_effective_from: null,
          currency: null,
          storage_charge_basis: null,
          issues: ["assigned_rate_plan_has_no_effective_version"],
        }),
      },
    );

    renderPage();
    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(
      await screen.findByText(
        "Rate Plan reserved-capacity has no effective version for the selected month. Cost is unavailable.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps table errors inside the subjects section", async () => {
    mocks.getBillingSubjects.mockRejectedValue(new Error("subject query failed"));

    renderPage();

    expect(await screen.findByText("Unable to load subjects.")).toBeInTheDocument();
    expect(screen.getByText("subject query failed")).toBeInTheDocument();
  });

  it("shows consolidated Billing Entities across endpoints and explains quota-based storage pricing", async () => {
    renderPage();
    await screen.findByText("Tenant A");

    fireEvent.click(screen.getByRole("tab", { name: "Billing Entities" }));

    await waitFor(() => expect(mocks.getBillingAnalysis).toHaveBeenCalledWith("2026-07"));
    expect(screen.queryByRole("combobox", { name: "Endpoint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
    expect(screen.getByText("1 billing subject(s) are not assigned to any Billing Entity.")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("Allocated quota")).toBeInTheDocument();
    expect(screen.getByText("Actual usage")).toBeInTheDocument();

    const researchRow = screen.getByText("Research").closest("tr");
    expect(researchRow).not.toBeNull();
    fireEvent.click(within(researchRow as HTMLElement).getByRole("button", { name: "View" }));

    const detailRegion = await screen.findByTestId("billing-entity-detail");
    expect(within(detailRegion).getByText("Ceph main")).toBeInTheDocument();
    expect(within(detailRegion).getByText("Measured: 1 GiB-month")).toBeInTheDocument();
    expect(within(detailRegion).getByText("Billed quota: 2 GiB-month")).toBeInTheDocument();
    expect(within(detailRegion).getByText("Billing Entity · reserved-capacity")).toBeInTheDocument();
  });

  it("keeps group currencies separate and drills into month-effective Billing Entities", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Tenant A");

    fireEvent.click(screen.getByRole("tab", { name: "Billing Groups" }));
    const groupTable = await screen.findByRole("table");
    expect(within(groupTable).getAllByText("DSI").length).toBeGreaterThan(0);

    expect(screen.getByText("2.00 EUR")).toBeInTheDocument();
    expect(screen.getByText("1.50 USD")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    const detailRegion = await screen.findByTestId("billing-group-detail");
    expect(within(detailRegion).getByText(/Membership effective for 2026-07/)).toBeInTheDocument();
    const researchDisclosure = within(detailRegion).getByText(/Research · 2.00 EUR/);
    await user.click(researchDisclosure);
    expect(within(detailRegion).getByText("RGW-LAB-A")).toBeInTheDocument();
    expect(within(detailRegion).getByText("Ceph main")).toBeInTheDocument();
  });
});
