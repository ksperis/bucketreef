import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BillingStatementsView from "./BillingStatementsView";

const mocks = vi.hoisted(() => ({
  listBillingStatements: vi.fn(),
  generateBillingStatements: vi.fn(),
  finalizeBillingStatement: vi.fn(),
  downloadBillingStatementSnapshot: vi.fn(),
  getBillingFinalizedPeriod: vi.fn(),
  getBillingStatement: vi.fn(),
  listBillingEntities: vi.fn(),
  listBillingEntityGroups: vi.fn(),
  triggerBlobDownload: vi.fn(),
}));

vi.mock("../../api/billing", () => ({
  listBillingStatements: (...args: unknown[]) => mocks.listBillingStatements(...args),
  generateBillingStatements: (...args: unknown[]) => mocks.generateBillingStatements(...args),
  finalizeBillingStatement: (...args: unknown[]) => mocks.finalizeBillingStatement(...args),
  downloadBillingStatementSnapshot: (...args: unknown[]) => mocks.downloadBillingStatementSnapshot(...args),
  getBillingFinalizedPeriod: (...args: unknown[]) => mocks.getBillingFinalizedPeriod(...args),
  getBillingStatement: (...args: unknown[]) => mocks.getBillingStatement(...args),
  listBillingEntities: (...args: unknown[]) => mocks.listBillingEntities(...args),
  listBillingEntityGroups: (...args: unknown[]) => mocks.listBillingEntityGroups(...args),
}));

vi.mock("../../utils/download", () => ({
  triggerBlobDownload: (...args: unknown[]) => mocks.triggerBlobDownload(...args),
}));

function entity() {
  return {
    id: 10,
    name: "Research",
    code: "RES",
    external_id: "erp-research",
    subject_type: "account",
    active: true,
    include_tags: [],
    explicit_includes: [],
    explicit_excludes: [],
    rate_assignments: [],
    member_count: 1,
    conflict_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function statement(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    public_id: "11111111-1111-1111-1111-111111111111",
    billing_entity_id: 10,
    billing_entity_name: "Research",
    billing_entity_code: "RES",
    billing_entity_external_id: "erp-research",
    subject_type: "account",
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    currency: "EUR",
    status: "draft",
    member_count: 1,
    coverage: {
      member_count: 1,
      expected_daily_observations: 31,
      storage_observations: 31,
      usage_observations: 31,
      storage_coverage_ratio: "1.000000",
      usage_coverage_ratio: "1.000000",
      quota_observations_collected: 0,
      quota_observations_expected: 0,
      quota_coverage_ratio: null,
    },
    blockers: [],
    storage_charge_bases: ["actual_usage"],
    subtotal: "7.541000",
    total: "7.541000",
    revision: 1,
    generated_at: "2026-08-01T08:00:00Z",
    finalized_at: null,
    finalized_by_user_id: null,
    finalized_by_user_email: null,
    lines: [
      {
        id: 81,
        line_index: 1,
        currency: "EUR",
        snapshot: {
          subject_type: "account",
          subject_id: 5,
          subject_name: "Research storage",
          rgw_identifier: "RGW-RESEARCH",
          membership_reasons: [{ kind: "tag", tag_definition_id: 3, label: "Research" }],
          membership_conflict: false,
          included_in_total: true,
          storage_endpoint_id: 7,
          storage_endpoint_name: "Ceph main",
          usage: { bytes_in: 1024, bytes_out: 2048, ops_total: 1000 },
          storage: { avg_bytes: 1073741824, avg_gb_month: "1.000000000000", total_objects: 10 },
          coverage: {
            days_collected: 31,
            days_in_month: 31,
            coverage_ratio: 1,
            storage_days_collected: 31,
            usage_days_collected: 31,
          },
          storage_charge_basis: "actual_usage",
          priced_storage_quantity: {
            basis: "actual_usage",
            quantity_gib_month: "1.000000000000",
            observations_collected: 31,
            observations_expected: 31,
            calendar_days: 31,
            coverage_ratio: "1.000000",
            status: "complete",
            issues: [],
          },
          rate_resolution: {
            status: "resolved",
            layer: "billing_entity",
            rate_plan_id: 4,
            rate_plan_name: "research-plan",
            rate_card_id: 8,
            rate_card_effective_from: "2026-01-01",
            rate_card_effective_to: null,
            source_assignment_id: 9,
            billing_entity_id: 10,
            billing_entity_name: "Research",
            conflicting_billing_entity_ids: [],
            conflicting_billing_entity_names: [],
            currency: "EUR",
            storage_charge_basis: "actual_usage",
            issues: [],
          },
          unit_prices: {
            storage_gb_month_price: "1.000000",
            egress_gb_price: "2.000000",
            ingress_gb_price: "3.000000",
            requests_per_1000_price: "4.000000",
          },
          amounts: {
            storage_cost: "1.000000",
            egress_cost: "2.000000",
            ingress_cost: "0.001000",
            requests_cost: "4.000000",
            total_cost: "7.541000",
          },
          complete: true,
          issues: [],
        },
      },
    ],
    ...overrides,
  };
}

function period(overrides: Record<string, unknown> = {}) {
  return {
    scope_type: "entity",
    scope_id: 10,
    scope_name: "Research",
    scope_code: "RES",
    scope_external_id: "erp-research",
    start_month: "2026-07",
    end_month: "2026-07",
    expected_months: ["2026-07"],
    finalized_months: ["2026-07"],
    missing_months: [],
    unfinalized_months: [],
    currency_totals: [{
      currency: "EUR",
      storage_cost: "1.000000",
      egress_cost: "2.000000",
      ingress_cost: "0.001000",
      requests_cost: "4.000000",
      total: "7.541000",
      statement_ids: [41],
      statement_public_ids: ["11111111-1111-1111-1111-111111111111"],
      statement_months: ["2026-07"],
      storage_charge_bases: ["actual_usage"],
    }],
    months: [{
      month: "2026-07",
      member_entity_ids: [10],
      finalized_entity_ids: [10],
      missing_entity_ids: [],
      unfinalized_entity_ids: [],
      statement_ids: [41],
      entity_contributions: [{
        billing_entity_id: 10,
        billing_entity_name: "Research",
        billing_entity_code: "RES",
        billing_entity_external_id: "erp-research",
        statement_ids: [41],
        currency_totals: [{
          currency: "EUR",
          storage_cost: "1.000000",
          egress_cost: "2.000000",
          ingress_cost: "0.001000",
          requests_cost: "4.000000",
          total: "7.541000",
          statement_ids: [41],
          statement_public_ids: ["11111111-1111-1111-1111-111111111111"],
          statement_months: ["2026-07"],
          storage_charge_bases: ["actual_usage"],
        }],
      }],
      currency_totals: [{
        currency: "EUR",
        storage_cost: "1.000000",
        egress_cost: "2.000000",
        ingress_cost: "0.001000",
        requests_cost: "4.000000",
        total: "7.541000",
        statement_ids: [41],
        statement_public_ids: ["11111111-1111-1111-1111-111111111111"],
        statement_months: ["2026-07"],
        storage_charge_bases: ["actual_usage"],
      }],
      complete: true,
    }],
    complete: true,
    ...overrides,
  };
}

describe("BillingStatementsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listBillingEntities.mockResolvedValue([entity()]);
    mocks.listBillingEntityGroups.mockResolvedValue([]);
    mocks.listBillingStatements.mockResolvedValue([statement()]);
    mocks.generateBillingStatements.mockResolvedValue({ month: "2026-07", billing_entity_id: 10, blockers: [], statements: [statement()] });
    mocks.finalizeBillingStatement.mockResolvedValue(statement({ status: "finalized", finalized_at: "2026-08-01T09:00:00Z" }));
    mocks.downloadBillingStatementSnapshot.mockResolvedValue(new Blob(["snapshot"]));
    mocks.getBillingFinalizedPeriod.mockResolvedValue(period());
    mocks.getBillingStatement.mockResolvedValue(statement());
  });

  it("reviews persisted snapshot details and generates a draft", async () => {
    render(<BillingStatementsView month="2026-07" />);

    expect(await screen.findByText("Research storage")).toBeInTheDocument();
    expect(screen.getByText("RGW-RESEARCH")).toBeInTheDocument();
    expect(screen.getByText("Ceph main")).toBeInTheDocument();
    expect(screen.getByText("Billing Entity · research-plan")).toBeInTheDocument();
    expect(screen.getAllByText("7.54 EUR").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(mocks.generateBillingStatements).toHaveBeenCalledWith("2026-07", 10, false));
  });

  it("blocks unsafe finalization and explicitly confirms a valid draft", async () => {
    const blocked = statement({ id: 42, public_id: "22222222-2222-2222-2222-222222222222", blockers: ["subject:account:5:missing_storage_observations"] });
    mocks.listBillingStatements.mockResolvedValue([statement(), blocked]);
    const user = userEvent.setup();
    render(<BillingStatementsView month="2026-07" />);

    const tables = await screen.findAllByRole("table");
    const statementsTable = tables[0];
    const rows = within(statementsTable).getAllByRole("row").slice(1);
    expect(within(rows[1]).getByRole("button", { name: "Finalize" })).toBeDisabled();

    await user.click(within(rows[0]).getByRole("button", { name: "Finalize" }));
    const dialog = await screen.findByRole("dialog", { name: "Finalize Billing Statement?" });
    expect(within(dialog).getByText("7.54 EUR")).toBeInTheDocument();
    expect(within(dialog).getByText(/Storage 100% · Usage 100%/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Finalize statement" }));
    await waitFor(() => expect(mocks.finalizeBillingStatement).toHaveBeenCalledWith(41));
  });

  it("shows annual partial completeness without treating missing months as zero", async () => {
    mocks.getBillingFinalizedPeriod.mockImplementation((_scopeType, _scopeId, startMonth, endMonth) => {
      if (startMonth === "2026-01" && endMonth === "2026-12") {
        return Promise.resolve(period({
          start_month: "2026-01",
          end_month: "2026-12",
          expected_months: Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`),
          finalized_months: ["2026-01", "2026-02"],
          missing_months: ["2026-03", "2026-04"],
          unfinalized_months: ["2026-05"],
          currency_totals: [{
            ...period().currency_totals[0],
            total: "12.000000",
            statement_months: ["2026-01", "2026-02"],
          }],
          months: [],
          complete: false,
        }));
      }
      return Promise.resolve(period());
    });
    render(<BillingStatementsView month="2026-07" />);
    await screen.findByText("Research storage");

    fireEvent.change(screen.getByRole("combobox", { name: "Period" }), { target: { value: "year" } });
    await waitFor(() => expect(mocks.getBillingFinalizedPeriod).toHaveBeenCalledWith("entity", 10, "2026-01", "2026-12"));
    expect(await screen.findByText(/Missing or unfinalized months are excluded from totals/)).toBeInTheDocument();
    expect(screen.getByText("2/12")).toBeInTheDocument();
    expect(screen.getByText("2026-03, 2026-04")).toBeInTheDocument();
    expect(screen.getByText("2026-05")).toBeInTheDocument();
    expect(screen.getByText("12.00 EUR")).toBeInTheDocument();
  });
});
