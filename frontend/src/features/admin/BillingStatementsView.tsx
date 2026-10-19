/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import {
  type BillingDecimal,
  type BillingEntityAdminItem,
  type BillingEntityGroupAdminItem,
  type BillingFinalizedPeriodAggregation,
  type BillingStatementItem,
  type BillingStatementLineItem,
  downloadBillingStatementSnapshot,
  finalizeBillingStatement,
  generateBillingStatements,
  getBillingFinalizedPeriod,
  getBillingStatement,
  listBillingEntities,
  listBillingEntityGroups,
  listBillingStatements,
} from "../../api/billing";
import InlineSummary from "../../components/InlineSummary";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { ListActionButton, ListActions } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import UiBadge from "../../components/ui/UiBadge";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { triggerBlobDownload } from "../../utils/download";
import { useAdminI18n } from "./adminI18n";

type BillingStatementsViewProps = {
  month: string;
};

type PeriodMode = "month" | "year" | "custom";
type ScopeType = "entity" | "group";

function decimalNumber(value: BillingDecimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCurrency(value: BillingDecimal, currency: string, locale: string): string {
  const numeric = decimalNumber(value);
  if (numeric == null) return `- ${currency}`;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric)} ${currency}`;
}

function formatPercentage(value: BillingDecimal | null | undefined): string {
  const numeric = decimalNumber(value);
  return numeric == null ? "-" : `${Math.round(numeric * 100)}%`;
}

function formatGiBMonth(value: BillingDecimal | null | undefined, locale: string): string {
  const numeric = decimalNumber(value);
  if (numeric == null) return "-";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(numeric)} GiB-month`;
}

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function membershipReasonText(line: BillingStatementLineItem): string {
  const labels = line.snapshot.membership_reasons
    .filter((reason) => reason.kind !== "explicit_exclude")
    .map((reason) => reason.kind === "tag" ? reason.label || "Tag" : "Explicit include");
  return labels.length > 0 ? labels.join(", ") : "-";
}

function rateResolutionText(line: BillingStatementLineItem): string {
  const resolution = line.snapshot.rate_resolution;
  if (resolution.status !== "resolved") return resolution.status === "conflict" ? "Conflict" : "Missing rate";
  const source = resolution.layer === "direct"
    ? "Direct"
    : resolution.layer === "billing_entity"
      ? "Billing Entity"
      : resolution.layer === "endpoint"
        ? "Endpoint"
        : "Global";
  return resolution.rate_plan_name ? `${source} · ${resolution.rate_plan_name}` : source;
}

function statementCoverage(statement: BillingStatementItem): string {
  return `Storage ${formatPercentage(statement.coverage.storage_coverage_ratio)} · Usage ${formatPercentage(statement.coverage.usage_coverage_ratio)}`;
}

function periodRange(
  mode: PeriodMode,
  pageMonth: string,
  year: string,
  customStart: string,
  customEnd: string,
): { start: string; end: string } | null {
  if (mode === "month") return { start: pageMonth, end: pageMonth };
  if (mode === "year") {
    if (!/^\d{4}$/.test(year)) return null;
    return { start: `${year}-01`, end: `${year}-12` };
  }
  if (!customStart || !customEnd) return null;
  return { start: customStart, end: customEnd };
}

export default function BillingStatementsView({ month }: BillingStatementsViewProps) {
  const { intlLocale, text } = useAdminI18n();
  const { requestConfirmation, confirmationDialog, isConfirming } = useConfirmActionDialog();
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "finalized">("");
  const [statements, setStatements] = useState<BillingStatementItem[]>([]);
  const [entities, setEntities] = useState<BillingEntityAdminItem[]>([]);
  const [groups, setGroups] = useState<BillingEntityGroupAdminItem[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [selectedStatementId, setSelectedStatementId] = useState<number | null>(null);
  const [periodStatement, setPeriodStatement] = useState<BillingStatementItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [periodYear, setPeriodYear] = useState(month.slice(0, 4));
  const [customStart, setCustomStart] = useState(month);
  const [customEnd, setCustomEnd] = useState(month);
  const [scopeType, setScopeType] = useState<ScopeType>("entity");
  const [scopeId, setScopeId] = useState<number | null>(null);
  const [periodResult, setPeriodResult] = useState<BillingFinalizedPeriodAggregation | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);

  useEffect(() => {
    setPeriodYear(month.slice(0, 4));
    setCustomStart(month);
    setCustomEnd(month);
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    async function loadScopes() {
      try {
        const [entityRows, groupRows] = await Promise.all([
          listBillingEntities("", false),
          listBillingEntityGroups("", false),
        ]);
        if (cancelled) return;
        setEntities(entityRows);
        setGroups(groupRows);
        setSelectedEntityId((current) => current ?? entityRows[0]?.id ?? null);
      } catch (loadError) {
        if (!cancelled) setError(extractApiError(loadError, text("Unable to load Billing Entity scopes.")));
      }
    }
    void loadScopes();
    return () => {
      cancelled = true;
    };
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    async function loadStatements() {
      setLoading(true);
      setError(null);
      try {
        const rows = await listBillingStatements(month, statusFilter);
        if (cancelled) return;
        setStatements(rows);
        setSelectedStatementId((current) => (
          current != null && (rows.some((row) => row.id === current) || periodStatement?.id === current)
            ? current
            : rows[0]?.id ?? null
        ));
      } catch (loadError) {
        if (!cancelled) {
          setStatements([]);
          setSelectedStatementId(null);
          setError(extractApiError(loadError, text("Unable to load Billing Statements.")));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadStatements();
    return () => {
      cancelled = true;
    };
  }, [month, periodStatement?.id, reloadToken, statusFilter, text]);

  useEffect(() => {
    const available = scopeType === "entity" ? entities : groups;
    setScopeId((current) => current != null && available.some((item) => item.id === current) ? current : available[0]?.id ?? null);
  }, [entities, groups, scopeType]);

  const range = useMemo(
    () => periodRange(periodMode, month, periodYear, customStart, customEnd),
    [customEnd, customStart, month, periodMode, periodYear],
  );

  useEffect(() => {
    if (scopeId == null || !range) {
      setPeriodResult(null);
      return;
    }
    let cancelled = false;
    async function loadPeriod() {
      setPeriodLoading(true);
      setPeriodError(null);
      try {
        const result = await getBillingFinalizedPeriod(scopeType, scopeId as number, range!.start, range!.end);
        if (!cancelled) setPeriodResult(result);
      } catch (loadError) {
        if (!cancelled) {
          setPeriodResult(null);
          setPeriodError(extractApiError(loadError, text("Unable to load finalized-period analysis.")));
        }
      } finally {
        if (!cancelled) setPeriodLoading(false);
      }
    }
    void loadPeriod();
    return () => {
      cancelled = true;
    };
  }, [range, reloadToken, scopeId, scopeType, text]);

  const selectedStatement = useMemo(
    () => statements.find((statement) => statement.id === selectedStatementId)
      ?? (periodStatement?.id === selectedStatementId ? periodStatement : null),
    [periodStatement, selectedStatementId, statements],
  );

  async function reviewPeriodStatement(statementId: number) {
    setPendingAction(`review:${statementId}`);
    setError(null);
    try {
      const item = await getBillingStatement(statementId);
      setPeriodStatement(item);
      setSelectedStatementId(item.id);
    } catch (actionError) {
      setError(extractApiError(actionError, text("Unable to load Billing Statement.")));
    } finally {
      setPendingAction(null);
    }
  }

  async function runGeneration(regenerate: boolean, entityId: number) {
    const actionKey = `${regenerate ? "regenerate" : "generate"}:${entityId}`;
    setPendingAction(actionKey);
    setError(null);
    setMessage(null);
    try {
      const result = await generateBillingStatements(month, entityId, regenerate);
      setMessage(regenerate ? text("Billing Statement draft regenerated.") : text("Billing Statement draft generated."));
      if (result.statements[0]) setSelectedStatementId(result.statements[0].id);
      setReloadToken((current) => current + 1);
    } catch (actionError) {
      setError(extractApiError(actionError, text(regenerate ? "Unable to regenerate Billing Statement." : "Unable to generate Billing Statement.")));
    } finally {
      setPendingAction(null);
    }
  }

  async function runFinalize(statement: BillingStatementItem) {
    setPendingAction(`finalize:${statement.id}`);
    setError(null);
    setMessage(null);
    try {
      const finalized = await finalizeBillingStatement(statement.id);
      setMessage(text("Billing Statement finalized."));
      setSelectedStatementId(finalized.id);
      setReloadToken((current) => current + 1);
    } catch (actionError) {
      setError(extractApiError(actionError, text("Unable to finalize Billing Statement.")));
    } finally {
      setPendingAction(null);
    }
  }

  function requestFinalize(statement: BillingStatementItem) {
    if (statement.blockers.length > 0 || statement.status !== "draft") return;
    requestConfirmation({
      title: text("Finalize Billing Statement?"),
      description: text("Finalization freezes this monthly snapshot. Later membership, quota, usage, or Rate Plan changes will not rewrite it."),
      confirmLabel: text("Finalize statement"),
      processingLabel: text("Finalizing..."),
      tone: "primary",
      details: [
        { label: text("Billing Entity"), value: statement.billing_entity_name },
        { label: text("Month"), value: statement.period_start.slice(0, 7) },
        { label: text("Amount"), value: formatCurrency(statement.total, statement.currency, intlLocale) },
        { label: text("Coverage"), value: statementCoverage(statement) },
        { label: text("Currency"), value: statement.currency },
      ],
      warning: statement.coverage.quota_observations_expected > 0
        ? text("Allocated-quota pricing is present. The persisted quota-history quantity will be frozen with the statement.")
        : undefined,
      onConfirm: () => runFinalize(statement),
    });
  }

  async function exportSnapshot(statement: BillingStatementItem, format: "csv" | "json" | "pdf") {
    const actionKey = `export-${format}:${statement.id}`;
    setPendingAction(actionKey);
    setError(null);
    try {
      const blob = await downloadBillingStatementSnapshot(statement.id, format);
      triggerBlobDownload(`billing-statement-${statement.public_id}.${format}`, blob);
    } catch (actionError) {
      setError(extractApiError(actionError, text("Unable to export Billing Statement snapshot.")));
    } finally {
      setPendingAction(null);
    }
  }

  const statementColumns: Array<DataTableColumn<BillingStatementItem>> = [
    {
      id: "entity",
      label: text("Billing Entity"),
      primary: true,
      render: (statement) => (
        <span>
          <span className="block">{statement.billing_entity_name}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{statement.billing_entity_code || statement.public_id}</span>
        </span>
      ),
    },
    {
      id: "status",
      label: text("Status"),
      render: (statement) => (
        <span className="flex flex-wrap gap-1">
          <UiBadge tone={statement.status === "finalized" ? "success" : "warning"}>
            {text(statement.status === "finalized" ? "Finalized" : "Draft")}
          </UiBadge>
          {statement.blockers.length > 0 ? (
            <UiBadge tone="danger">{text("{count} blocker(s)", { count: statement.blockers.length })}</UiBadge>
          ) : null}
        </span>
      ),
    },
    {
      id: "amount",
      label: text("Amount"),
      render: (statement) => formatCurrency(statement.total, statement.currency, intlLocale),
    },
    {
      id: "coverage",
      label: text("Coverage"),
      render: statementCoverage,
    },
    {
      id: "timestamps",
      label: text("Generated / Finalized"),
      render: (statement) => (
        <span>
          <span className="block">{formatDateTime(statement.generated_at, intlLocale)}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{formatDateTime(statement.finalized_at, intlLocale)}</span>
        </span>
      ),
    },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      actionWidth: "wide",
      render: (statement) => (
        <ListActions>
          <ListActionButton
            onClick={() => setSelectedStatementId(statement.id)}
            {...dataTableDefaultActionProps}
          >
            {text("View")}
          </ListActionButton>
          {statement.status === "draft" ? (
            <>
              <ListActionButton
                onClick={() => void runGeneration(true, statement.billing_entity_id)}
                loading={pendingAction === `regenerate:${statement.billing_entity_id}`}
                disabled={pendingAction != null || isConfirming}
              >
                {text("Regenerate")}
              </ListActionButton>
              <ListActionButton
                variant="primary"
                onClick={() => requestFinalize(statement)}
                loading={pendingAction === `finalize:${statement.id}`}
                disabled={statement.blockers.length > 0 || pendingAction != null || isConfirming}
                title={statement.blockers.length > 0 ? text("Resolve all blockers before finalizing.") : undefined}
              >
                {text("Finalize")}
              </ListActionButton>
            </>
          ) : null}
          <ListActionButton
            onClick={() => void exportSnapshot(statement, "csv")}
            loading={pendingAction === `export-csv:${statement.id}`}
            disabled={pendingAction != null}
          >
            CSV
          </ListActionButton>
          <ListActionButton
            onClick={() => void exportSnapshot(statement, "json")}
            loading={pendingAction === `export-json:${statement.id}`}
            disabled={pendingAction != null}
          >
            JSON
          </ListActionButton>
          {statement.status === "finalized" ? (
            <ListActionButton
              onClick={() => void exportSnapshot(statement, "pdf")}
              loading={pendingAction === `export-pdf:${statement.id}`}
              disabled={pendingAction != null}
            >
              PDF
            </ListActionButton>
          ) : null}
        </ListActions>
      ),
    },
  ];

  const lineColumns: Array<DataTableColumn<BillingStatementLineItem>> = [
    {
      id: "subject",
      label: text("Subject"),
      primary: true,
      render: (line) => (
        <span>
          <span className="block">{line.snapshot.subject_name}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{line.snapshot.rgw_identifier}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{membershipReasonText(line)}</span>
        </span>
      ),
    },
    { id: "endpoint", label: text("Endpoint"), render: (line) => line.snapshot.storage_endpoint_name },
    {
      id: "storage",
      label: text("Storage"),
      render: (line) => (
        <span>
          <span className="block">
            {line.snapshot.storage_charge_basis === "allocated_quota" ? text("Allocated quota") : text("Actual usage")}
          </span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>
            {text("Billed {value}", { value: formatGiBMonth(line.snapshot.priced_storage_quantity?.quantity_gib_month, intlLocale) })}
          </span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>
            {text("Measured {value}", { value: formatGiBMonth(line.snapshot.storage.avg_gb_month, intlLocale) })}
          </span>
        </span>
      ),
    },
    {
      id: "rate",
      label: text("Rate resolution"),
      render: (line) => rateResolutionText(line),
    },
    {
      id: "amount",
      label: text("Amount"),
      render: (line) => line.snapshot.amounts.total_cost != null
        ? formatCurrency(line.snapshot.amounts.total_cost, line.currency, intlLocale)
        : "-",
    },
    {
      id: "state",
      label: text("State"),
      render: (line) => (
        <span className="flex flex-wrap gap-1">
          {line.snapshot.membership_conflict ? <UiBadge tone="danger">{text("Conflict")}</UiBadge> : null}
          <UiBadge tone={line.snapshot.complete ? "success" : "warning"}>{text(line.snapshot.complete ? "Complete" : "Incomplete")}</UiBadge>
        </span>
      ),
    },
  ];

  const periodColumns: Array<DataTableColumn<BillingFinalizedPeriodAggregation["months"][number]>> = [
    { id: "month", label: text("Month"), primary: true, render: (item) => item.month },
    {
      id: "members",
      label: text("Entities"),
      render: (item) => text("{finalized}/{expected} finalized", {
        finalized: item.finalized_entity_ids.length,
        expected: item.member_entity_ids.length,
      }),
    },
    {
      id: "totals",
      label: text("Totals"),
      render: (item) => item.currency_totals.length > 0
        ? item.currency_totals.map((total) => formatCurrency(total.total, total.currency, intlLocale)).join(" · ")
        : "-",
    },
    {
      id: "statements",
      label: text("Statements"),
      render: (item) => item.entity_contributions.length > 0 ? (
        <span className="space-y-1">
          {item.entity_contributions.map((contribution) => (
            <span key={contribution.billing_entity_id} className="block">
              <span className="block">{contribution.billing_entity_name}</span>
              <span className={cx("block ui-caption", uiMutedTextClass)}>
                {contribution.currency_totals.map((total) => formatCurrency(total.total, total.currency, intlLocale)).join(" · ") || "-"}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                {contribution.statement_ids.map((statementId) => (
                  <ListActionButton
                    key={statementId}
                    onClick={() => void reviewPeriodStatement(statementId)}
                    loading={pendingAction === `review:${statementId}`}
                    disabled={pendingAction != null}
                  >
                    {text("Review #{id}", { id: statementId })}
                  </ListActionButton>
                ))}
              </span>
            </span>
          ))}
        </span>
      ) : item.statement_ids.length > 0 ? item.statement_ids.join(", ") : "-",
    },
    {
      id: "state",
      label: text("State"),
      render: (item) => (
        <span className="flex flex-wrap gap-1">
          <UiBadge tone={item.complete ? "success" : "warning"}>{text(item.complete ? "Complete" : "Partial")}</UiBadge>
          {item.missing_entity_ids.length > 0 ? <UiBadge tone="danger">{text("Missing")}</UiBadge> : null}
          {item.unfinalized_entity_ids.length > 0 ? <UiBadge tone="warning">{text("Draft")}</UiBadge> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {confirmationDialog}
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}

      <ListPageSection
        variant="section"
        title={text("Monthly Billing Statements")}
        countLabel={text("{count} statement(s)", { count: statements.length })}
        filters={
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <UiSelect
              label={text("Status")}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "" | "draft" | "finalized")}
              size="compact"
            >
              <option value="">{text("All statuses")}</option>
              <option value="draft">{text("Draft")}</option>
              <option value="finalized">{text("Finalized")}</option>
            </UiSelect>
            <UiSelect
              label={text("Generate for")}
              value={selectedEntityId ?? ""}
              onChange={(event) => setSelectedEntityId(event.target.value ? Number(event.target.value) : null)}
              size="compact"
            >
              {entities.length === 0 ? <option value="">{text("No active Billing Entity")}</option> : null}
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </UiSelect>
            <ListActionButton
              variant="primary"
              onClick={() => selectedEntityId != null && void runGeneration(false, selectedEntityId)}
              loading={selectedEntityId != null && pendingAction === `generate:${selectedEntityId}`}
              disabled={selectedEntityId == null || pendingAction != null || isConfirming}
            >
              {text("Generate draft")}
            </ListActionButton>
          </div>
        }
      >
        <DataTableShell
          columns={statementColumns}
          rows={statements}
          rowKey={(statement) => statement.id}
          status={resolveListTableStatus({ loading, error, rowCount: statements.length })}
          loadingMessage={text("Loading Billing Statements...")}
          errorMessage={text("Unable to load Billing Statements.")}
          emptyMessage={text("No Billing Statement exists for this month and filter.")}
          primaryColumnId="entity"
          responsiveCards
          tableClassName="ui-data-table"
          rowClassName={(statement) => statement.id === selectedStatementId ? "bg-[var(--ui-selected-bg)]" : ""}
          rowAttributes={(statement) => ({ "aria-current": statement.id === selectedStatementId ? "true" : undefined })}
        />
      </ListPageSection>

      <section className="ui-surface-card p-4" data-testid="billing-statement-detail">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{text("Statement review")}</h2>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {text("Review the persisted monthly snapshot before finalization. Finalized statements remain immutable.")}
            </p>
          </div>
          {selectedStatement ? (
            <UiBadge tone={selectedStatement.status === "finalized" ? "success" : "warning"}>
              {text(selectedStatement.status === "finalized" ? "Finalized snapshot" : "Draft snapshot")}
            </UiBadge>
          ) : null}
        </div>
        {!selectedStatement ? (
          <PageBanner tone="info" className="mt-3">{text("Select or generate a Billing Statement to review it.")}</PageBanner>
        ) : (
          <div className="mt-3 space-y-3">
            <InlineSummary
              items={[
                { label: text("Billing Entity"), value: selectedStatement.billing_entity_name },
                { label: text("Month"), value: selectedStatement.period_start.slice(0, 7) },
                { label: text("Amount"), value: formatCurrency(selectedStatement.total, selectedStatement.currency, intlLocale) },
                { label: text("Coverage"), value: statementCoverage(selectedStatement) },
                { label: text("Revision"), value: selectedStatement.revision },
              ]}
            />
            {selectedStatement.blockers.length > 0 ? (
              <PageBanner tone="warning">
                {text("Finalization is blocked:")} {selectedStatement.blockers.join(" · ")}
              </PageBanner>
            ) : null}
            <DataTableShell
              columns={lineColumns}
              rows={selectedStatement.lines}
              rowKey={(line) => line.id}
              status={resolveListTableStatus({ loading: false, error: null, rowCount: selectedStatement.lines.length })}
              loadingMessage={text("Loading statement lines...")}
              errorMessage={text("Unable to load statement lines.")}
              emptyMessage={text("This statement has no snapshot lines.")}
              primaryColumnId="subject"
              responsiveCards
              tableClassName="ui-data-table"
            />
          </div>
        )}
      </section>

      <ListPageSection
        variant="section"
        title={text("Finalized period analysis")}
        filters={
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <UiSelect label={text("Scope")} value={scopeType} onChange={(event) => setScopeType(event.target.value as ScopeType)} size="compact">
              <option value="entity">{text("Billing Entity")}</option>
              <option value="group">{text("Billing Group")}</option>
            </UiSelect>
            <UiSelect label={text(scopeType === "entity" ? "Billing Entity" : "Billing Group")} value={scopeId ?? ""} onChange={(event) => setScopeId(event.target.value ? Number(event.target.value) : null)} size="compact">
              {(scopeType === "entity" ? entities : groups).length === 0 ? <option value="">{text("No scope available")}</option> : null}
              {(scopeType === "entity" ? entities : groups).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </UiSelect>
            <UiSelect label={text("Period")} value={periodMode} onChange={(event) => setPeriodMode(event.target.value as PeriodMode)} size="compact">
              <option value="month">{text("Selected month")}</option>
              <option value="year">{text("Calendar year")}</option>
              <option value="custom">{text("Custom range")}</option>
            </UiSelect>
            {periodMode === "year" ? (
              <UiInput label={text("Year")} type="number" min="2000" max="9999" value={periodYear} onChange={(event) => setPeriodYear(event.target.value)} size="compact" />
            ) : null}
            {periodMode === "custom" ? (
              <>
                <UiInput label={text("From month")} type="month" value={customStart} onChange={(event) => setCustomStart(event.target.value)} size="compact" />
                <UiInput label={text("To month")} type="month" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} size="compact" />
              </>
            ) : null}
          </div>
        }
      >
        {periodError ? <PageBanner tone="error">{periodError}</PageBanner> : null}
        {periodLoading ? <PageBanner tone="info">{text("Loading finalized-period analysis...")}</PageBanner> : null}
        {!periodLoading && periodResult ? (
          <div className="space-y-3">
            {!periodResult.complete ? (
              <PageBanner tone="warning">
                {text("This period is partial. Missing or unfinalized months are excluded from totals and are not treated as zero cost.")}
              </PageBanner>
            ) : null}
            <InlineSummary
              label={`${periodResult.scope_name} · ${periodResult.start_month} → ${periodResult.end_month}`}
              items={[
                { label: text("Completeness"), value: text(periodResult.complete ? "Complete" : "Partial") },
                { label: text("Finalized months"), value: `${periodResult.finalized_months.length}/${periodResult.expected_months.length}` },
                {
                  label: text("Totals"),
                  value: periodResult.currency_totals.length > 0
                    ? periodResult.currency_totals.map((total) => formatCurrency(total.total, total.currency, intlLocale)).join(" · ")
                    : "-",
                },
                { label: text("Missing months"), value: periodResult.missing_months.join(", ") || "-" },
                { label: text("Unfinalized months"), value: periodResult.unfinalized_months.join(", ") || "-" },
              ]}
            />
            <DataTableShell
              columns={periodColumns}
              rows={periodResult.months}
              rowKey={(item) => item.month}
              status={resolveListTableStatus({ loading: false, error: null, rowCount: periodResult.months.length })}
              loadingMessage={text("Loading period months...")}
              errorMessage={text("Unable to load period months.")}
              emptyMessage={text("No months are available for this period.")}
              primaryColumnId="month"
              responsiveCards
              tableClassName="ui-data-table"
            />
          </div>
        ) : null}
      </ListPageSection>
    </div>
  );
}
