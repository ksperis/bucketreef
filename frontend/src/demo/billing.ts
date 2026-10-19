import type {
  BillingAnalysisPreview,
  BillingEntityAdminItem,
  BillingEntityAnalysisLine,
  BillingEntityGroupAdminItem,
  BillingFinalizedPeriodAggregation,
  BillingStatementItem,
} from "../api/billing";
import { GiB, settings } from "./state";
import { json, type DemoRequest } from "./http";

const createdAt = "2026-01-01T08:00:00Z";

function monthFor(c: DemoRequest): string {
  return c.url.searchParams.get("month") ?? c.state.initializedAt.slice(0, 7);
}

function monthEnd(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function entities(c: DemoRequest): BillingEntityAdminItem[] {
  const accounts = c.state.accounts;
  return [
    {
      id: 31, name: "Research customers", code: "RES", external_id: "cost-center-4100",
      subject_type: "account", active: true,
      include_tags: [], explicit_includes: accounts.slice(0, 2).map((account) => ({
        subject_type: "account", subject_id: account.id, name: account.name,
        rgw_identifier: account.rgw_account_id, storage_endpoint_id: account.storage_endpoint_id,
        storage_endpoint_name: account.storage_endpoint_name,
      })), explicit_excludes: [],
      rate_assignments: [{ id: 311, rate_plan_id: 10, rate_plan_name: "Standard EUR", effective_from: "2026-01-01", effective_to: null, created_at: createdAt, updated_at: createdAt }],
      member_count: 2, conflict_count: 0, created_at: createdAt, updated_at: createdAt,
    },
    {
      id: 32, name: "Commercial customers", code: "SALES", external_id: "cost-center-4200",
      subject_type: "account", active: true,
      include_tags: [], explicit_includes: accounts.slice(2).map((account) => ({
        subject_type: "account", subject_id: account.id, name: account.name,
        rgw_identifier: account.rgw_account_id, storage_endpoint_id: account.storage_endpoint_id,
        storage_endpoint_name: account.storage_endpoint_name,
      })), explicit_excludes: [],
      rate_assignments: [{ id: 321, rate_plan_id: 11, rate_plan_name: "Committed capacity EUR", effective_from: "2026-01-01", effective_to: null, created_at: createdAt, updated_at: createdAt }],
      member_count: 3, conflict_count: 0, created_at: createdAt, updated_at: createdAt,
    },
  ];
}

function groups(c: DemoRequest): BillingEntityGroupAdminItem[] {
  return [{
    id: 41, name: "All customer revenue", code: "REVENUE", external_id: "reporting-revenue",
    description: "Consolidated commercial reporting across customer segments.", active: true,
    memberships: entities(c).map((entity, index) => ({
      id: 410 + index, billing_entity_id: entity.id, billing_entity_name: entity.name,
      billing_entity_code: entity.code, billing_entity_active: true, effective_from: "2026-01-01",
      effective_to: null, status: "current", created_at: createdAt, updated_at: createdAt,
    })),
    current_member_count: 2, scheduled_membership_count: 0, created_at: createdAt, updated_at: createdAt,
  }];
}

function analysisLine(c: DemoRequest, entity: BillingEntityAdminItem, accountIndex: number, lineIndex: number): BillingEntityAnalysisLine {
  const account = c.state.accounts[accountIndex];
  const allocated = entity.id === 32;
  const total = 18.5 + lineIndex * 7.25;
  return {
    billing_entity_id: entity.id, billing_entity_name: entity.name, subject_type: "account",
    subject_id: account.id, subject_name: account.name, rgw_identifier: account.rgw_account_id,
    storage_endpoint_id: account.storage_endpoint_id, storage_endpoint_name: account.storage_endpoint_name,
    membership_reasons: [{ kind: "explicit_include" }], membership_conflict: false, included_in_total: true,
    usage: { bytes_in: 80 * GiB, bytes_out: 140 * GiB, ops_total: 920000 },
    storage: { avg_bytes: 420 * GiB, avg_gb_month: 420, total_objects: 82000 },
    coverage: { days_collected: 31, days_in_month: 31, coverage_ratio: 1, storage_days_collected: 31, usage_days_collected: 31 },
    cost: {
      currency: "EUR", storage_cost: allocated ? 15 : 8.4, egress_cost: 7, ingress_cost: 0,
      requests_cost: total - (allocated ? 22 : 15.4), total_cost: total, rate_card_name: allocated ? "Committed capacity EUR" : "Standard EUR", complete: true,
      storage_quantity: { basis: allocated ? "allocated_quota" : "actual_usage", quantity_gib_month: allocated ? 500 : 420, observations_collected: 31, observations_expected: 31, calendar_days: 31, coverage_ratio: 1, status: "complete", issues: [] },
    },
    rate_resolution: {
      status: "resolved", layer: "billing_entity", billing_entity_id: entity.id, billing_entity_name: entity.name,
      conflicting_billing_entity_ids: [], conflicting_billing_entity_names: [], rate_plan_id: allocated ? 11 : 10,
      rate_plan_name: allocated ? "Committed capacity EUR" : "Standard EUR", rate_card_id: allocated ? 2 : 1,
      rate_card_effective_from: "2026-01-01", currency: "EUR", storage_charge_basis: allocated ? "allocated_quota" : "actual_usage", issues: [],
    },
    complete: true, issues: [],
  };
}

function analysis(c: DemoRequest): BillingAnalysisPreview {
  const entityRows = entities(c);
  const firstLines = [analysisLine(c, entityRows[0], 0, 0), analysisLine(c, entityRows[0], 1, 1)];
  const secondLines = [analysisLine(c, entityRows[1], 2, 2), analysisLine(c, entityRows[1], 3, 3), analysisLine(c, entityRows[1], 4, 4)];
  const coverage = (count: number) => ({ member_count: count, expected_daily_observations: count * 31, storage_observations: count * 31, usage_observations: count * 31, storage_coverage_ratio: 1, usage_coverage_ratio: 1, quota_observations_collected: count * 31, quota_observations_expected: count * 31, quota_coverage_ratio: 1 });
  const total = (lines: BillingEntityAnalysisLine[]) => lines.reduce((sum, line) => sum + Number(line.cost?.total_cost ?? 0), 0);
  return {
    month: monthFor(c), days_in_month: 31,
    entities: [
      { billing_entity_id: 31, billing_entity_name: entityRows[0].name, billing_entity_code: "RES", subject_type: "account", member_count: 2, conflict_count: 0, currency_totals: [{ currency: "EUR", total_cost: total(firstLines), complete: true }], storage_charge_bases: ["actual_usage"], coverage: coverage(2), complete: true, issues: [], lines: firstLines },
      { billing_entity_id: 32, billing_entity_name: entityRows[1].name, billing_entity_code: "SALES", subject_type: "account", member_count: 3, conflict_count: 0, currency_totals: [{ currency: "EUR", total_cost: total(secondLines), complete: true }], storage_charge_bases: ["allocated_quota"], coverage: coverage(3), complete: true, issues: [], lines: secondLines },
    ],
    groups: [{ billing_entity_group_id: 41, billing_entity_group_name: "All customer revenue", billing_entity_group_code: "REVENUE", active: true, member_entity_ids: [31, 32], currency_totals: [{ currency: "EUR", total_cost: total([...firstLines, ...secondLines]), billing_entity_ids: [31, 32], complete: true }], missing_entity_ids: [], conflict_count: 0, storage_charge_bases: ["actual_usage", "allocated_quota"], coverage: coverage(5), complete: true, issues: [] }],
    unassigned: [], conflicts: [],
  };
}

function statement(c: DemoRequest, entityId: number, status: "draft" | "finalized"): BillingStatementItem {
  const entity = entities(c).find((item) => item.id === entityId)!;
  const entityAnalysis = analysis(c).entities.find((item) => item.billing_entity_id === entityId)!;
  const month = monthFor(c);
  const total = entityAnalysis.currency_totals[0].total_cost;
  return {
    id: entityId === 31 ? 51 : 52, public_id: entityId === 31 ? "BR-2026-10-RES" : "BR-2026-10-SALES",
    billing_entity_id: entity.id, billing_entity_name: entity.name, billing_entity_code: entity.code,
    billing_entity_external_id: entity.external_id, subject_type: "account", period_start: `${month}-01`,
    period_end: monthEnd(month), currency: "EUR", status, member_count: entity.member_count,
    coverage: entityAnalysis.coverage, blockers: [], storage_charge_bases: entityAnalysis.storage_charge_bases,
    subtotal: total, total, revision: 1, generated_at: `${monthEnd(month)}T23:00:00Z`,
    finalized_at: status === "finalized" ? `${monthEnd(month)}T23:30:00Z` : null,
    finalized_by_user_id: status === "finalized" ? 1 : null,
    finalized_by_user_email: status === "finalized" ? "alex.martin@example.com" : null,
    lines: entityAnalysis.lines.map((line, index) => ({
      id: entityId * 100 + index, line_index: index + 1, currency: "EUR",
      snapshot: {
        subject_type: "account", subject_id: line.subject_id, subject_name: line.subject_name,
        rgw_identifier: line.rgw_identifier, membership_reasons: line.membership_reasons,
        membership_conflict: false, included_in_total: true, storage_endpoint_id: line.storage_endpoint_id,
        storage_endpoint_name: line.storage_endpoint_name, usage: line.usage, storage: line.storage,
        coverage: line.coverage, storage_charge_basis: line.cost?.storage_quantity?.basis,
        priced_storage_quantity: line.cost?.storage_quantity, rate_resolution: line.rate_resolution,
        unit_prices: { storage_gb_month_price: .02, egress_gb_price: .05, ingress_gb_price: 0, requests_per_1000_price: .003 },
        amounts: { storage_cost: line.cost?.storage_cost, egress_cost: line.cost?.egress_cost, ingress_cost: line.cost?.ingress_cost, requests_cost: line.cost?.requests_cost, total_cost: line.cost?.total_cost },
        complete: true, issues: [],
      },
    })),
  };
}

function finalizedPeriod(c: DemoRequest): BillingFinalizedPeriodAggregation {
  const month = monthFor(c);
  const total = statement(c, 31, "finalized");
  const currencyTotal = { currency: "EUR", storage_cost: 15.65, egress_cost: 14, ingress_cost: 0, requests_cost: Number(total.total) - 29.65, total: total.total, statement_ids: [total.id], statement_public_ids: [total.public_id], statement_months: [month], storage_charge_bases: total.storage_charge_bases };
  return { scope_type: "entity", scope_id: 31, scope_name: "Research customers", scope_code: "RES", scope_external_id: "cost-center-4100", start_month: month, end_month: month, expected_months: [month], finalized_months: [month], missing_months: [], unfinalized_months: [], currency_totals: [currencyTotal], months: [{ month, member_entity_ids: [31], finalized_entity_ids: [31], missing_entity_ids: [], unfinalized_entity_ids: [], statement_ids: [total.id], currency_totals: [currencyTotal], entity_contributions: [{ billing_entity_id: 31, billing_entity_name: "Research customers", billing_entity_code: "RES", billing_entity_external_id: "cost-center-4100", statement_ids: [total.id], currency_totals: [currencyTotal] }], complete: true }], complete: true };
}

export function billingReadModels(c: DemoRequest): Response | undefined {
  if (c.method !== "GET") return undefined;
  const { path } = c;
  if (path === "/admin/billing/analysis") return json(analysis(c));
  if (path === "/admin/billing/entities") return json(entities(c));
  if (path === "/admin/billing/groups") return json(groups(c));
  if (path === "/admin/billing/entity-subjects") return json(entities(c).flatMap((entity) => entity.explicit_includes));
  if (path === "/admin/billing/rate-cards") return json([
    { id: 1, rate_plan_id: 10, name: "Standard EUR", currency: "EUR", storage_charge_basis: "actual_usage", storage_gb_month_price: .02, egress_gb_price: .05, ingress_gb_price: 0, requests_per_1000_price: .003, effective_from: "2026-01-01", effective_to: null, storage_endpoint_id: null, storage_endpoint_name: null, status: "active", editable: false, identity_editable: false, deletable: false, created_at: createdAt, updated_at: createdAt },
    { id: 2, rate_plan_id: 11, name: "Committed capacity EUR", currency: "EUR", storage_charge_basis: "allocated_quota", storage_gb_month_price: .03, egress_gb_price: .04, ingress_gb_price: 0, requests_per_1000_price: .002, effective_from: "2026-11-01", effective_to: null, storage_endpoint_id: 11, storage_endpoint_name: "Paris · Production", status: "future", editable: true, identity_editable: false, deletable: true, created_at: createdAt, updated_at: createdAt },
  ]);
  if (path === "/admin/billing/automation/settings") return json(settings.billing_automation);
  if (path === "/admin/billing/automation/runs") return json([{ id: 71, month: "2026-09", mode: "automatic_draft", trigger_source: "scheduled", status: "completed", active_entity_count: 2, generated_statement_count: 2, finalized_statement_count: 0, blocked_statement_count: 0, failed_entity_count: 0, unassigned_subject_count: 0, diagnostics: [], started_at: "2026-10-05T02:00:00Z", completed_at: "2026-10-05T02:00:04Z" }]);
  if (path === "/admin/billing/pdf/settings") return json(settings.billing_statement_pdf);
  if (path === "/admin/billing/statements") {
    let rows = [statement(c, 31, "finalized"), statement(c, 32, "draft")];
    const status = c.url.searchParams.get("status");
    const entityId = Number(c.url.searchParams.get("billing_entity_id"));
    if (status) rows = rows.filter((item) => item.status === status);
    if (entityId) rows = rows.filter((item) => item.billing_entity_id === entityId);
    return json(rows);
  }
  const statementMatch = path.match(/^\/admin\/billing\/statements\/(\d+)$/);
  if (statementMatch) return json(statement(c, Number(statementMatch[1]) === 51 ? 31 : 32, Number(statementMatch[1]) === 51 ? "finalized" : "draft"));
  if (path === "/admin/billing/finalized-period") return json(finalizedPeriod(c));
  return undefined;
}
