/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import type {
  BillingAnalysisCoverage,
  BillingAnalysisPreview,
  BillingDecimal,
  BillingEntityAnalysisLine,
  BillingEntityAnalysisPreview,
  BillingEntityGroupAnalysisPreview,
} from "../../api/billing";
import InlineSummary from "../../components/InlineSummary";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { ListActionButton } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import UiBadge from "../../components/ui/UiBadge";
import UiDetails from "../../components/ui/UiDetails";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { useAdminI18n } from "./adminI18n";

type BillingAnalysisMode = "entities" | "groups";

type BillingAnalysisViewProps = {
  mode: BillingAnalysisMode;
  month: string;
  analysis: BillingAnalysisPreview | null;
  loading: boolean;
  error: string | null;
};

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

function formatGiBMonth(value: BillingDecimal | null | undefined, locale: string): string {
  const numeric = decimalNumber(value);
  if (numeric == null) return "-";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(numeric)} GiB-month`;
}

function percentage(value: BillingDecimal | null | undefined): string {
  const numeric = decimalNumber(value);
  return numeric == null ? "-" : `${Math.round(numeric * 100)}%`;
}

function totalsText(
  totals: Array<{ currency: string; total_cost: BillingDecimal }>,
  locale: string,
): string[] {
  return totals.map((total) => formatCurrency(total.total_cost, total.currency, locale));
}

function CoverageSummary({ coverage }: { coverage: BillingAnalysisCoverage }) {
  const { text } = useAdminI18n();
  return (
    <div className="space-y-0.5">
      <div>{text("Storage {value}", { value: percentage(coverage.storage_coverage_ratio) })}</div>
      <div>{text("Usage {value}", { value: percentage(coverage.usage_coverage_ratio) })}</div>
      {coverage.quota_observations_expected > 0 ? (
        <div>{text("Quota {value}", { value: percentage(coverage.quota_coverage_ratio) })}</div>
      ) : null}
    </div>
  );
}

function StorageBasisBadges({ bases }: { bases: Array<"actual_usage" | "allocated_quota"> }) {
  const { text } = useAdminI18n();
  if (bases.length === 0) return <span>-</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {bases.map((basis) => (
        <UiBadge key={basis} tone={basis === "allocated_quota" ? "primary" : "neutral"}>
          {text(basis === "allocated_quota" ? "Allocated quota" : "Actual usage")}
        </UiBadge>
      ))}
    </span>
  );
}

function AnalysisState({ complete, conflictCount }: { complete: boolean; conflictCount: number }) {
  const { text } = useAdminI18n();
  return (
    <span className="flex flex-wrap gap-1">
      {conflictCount > 0 ? <UiBadge tone="danger">{text("{count} conflict(s)", { count: conflictCount })}</UiBadge> : null}
      <UiBadge tone={complete ? "success" : "warning"}>{text(complete ? "Complete" : "Incomplete")}</UiBadge>
    </span>
  );
}

function membershipReasonText(
  line: BillingEntityAnalysisLine,
  text: ReturnType<typeof useAdminI18n>["text"],
): string {
  const labels = line.membership_reasons
    .filter((reason) => reason.kind !== "explicit_exclude")
    .map((reason) => reason.kind === "tag" ? reason.label || text("Tag") : text("Explicit include"));
  return labels.length > 0 ? labels.join(", ") : "-";
}

function rateResolutionText(
  line: BillingEntityAnalysisLine,
  text: ReturnType<typeof useAdminI18n>["text"],
): string {
  const rate = line.rate_resolution;
  if (rate.status !== "resolved") return text(rate.status === "conflict" ? "Conflict" : "Missing rate");
  const source = rate.layer === "direct"
    ? text("Direct assignment")
    : rate.layer === "billing_entity"
      ? text("Billing Entity")
      : rate.layer === "endpoint"
        ? text("Endpoint Rate Plan")
        : text("Global Rate Plan");
  return rate.rate_plan_name ? `${source} · ${rate.rate_plan_name}` : source;
}

function EntityLinesTable({ entity }: { entity: BillingEntityAnalysisPreview }) {
  const { intlLocale, text } = useAdminI18n();
  const columns: Array<DataTableColumn<BillingEntityAnalysisLine>> = [
    {
      id: "subject",
      label: text("Subject"),
      primary: true,
      render: (line) => (
        <span>
          <span className="block">{line.subject_name}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{line.rgw_identifier}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{membershipReasonText(line, text)}</span>
        </span>
      ),
    },
    {
      id: "endpoint",
      label: text("Endpoint"),
      render: (line) => line.storage_endpoint_name,
    },
    {
      id: "storage",
      label: text("Storage"),
      render: (line) => {
        const quantity = line.cost?.storage_quantity;
        const quotaBased = quantity?.basis === "allocated_quota";
        return (
          <span>
            <span className="block">{text("Measured: {value}", { value: formatGiBMonth(line.storage.avg_gb_month, intlLocale) })}</span>
            {quantity ? (
              <span className={cx("block ui-caption", uiMutedTextClass)}>
                {text(quotaBased ? "Billed quota: {value}" : "Billed usage: {value}", {
                  value: formatGiBMonth(quantity.quantity_gib_month, intlLocale),
                })}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "usage",
      label: text("Usage"),
      render: (line) => (
        <span>
          <span className="block">{text("Egress {value}", { value: formatBytes(line.usage.bytes_out) })}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>
            {text("Ingress {ingress} · {requests} requests", {
              ingress: formatBytes(line.usage.bytes_in),
              requests: formatCompactNumber(line.usage.ops_total),
            })}
          </span>
        </span>
      ),
    },
    {
      id: "cost",
      label: text("Cost / Rate"),
      render: (line) => (
        <span>
          <span className="block">
            {line.cost?.total_cost != null && line.cost.currency
              ? formatCurrency(line.cost.total_cost, line.cost.currency, intlLocale)
              : "-"}
          </span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{rateResolutionText(line, text)}</span>
        </span>
      ),
    },
    {
      id: "coverage",
      label: text("Coverage / State"),
      render: (line) => (
        <span>
          <span className="block">
            {text("Storage {storage}% · Usage {usage}%", {
              storage: Math.round(((line.coverage.storage_days_collected ?? 0) / Math.max(line.coverage.days_in_month, 1)) * 100),
              usage: Math.round(((line.coverage.usage_days_collected ?? 0) / Math.max(line.coverage.days_in_month, 1)) * 100),
            })}
          </span>
          <span className="mt-1 flex flex-wrap gap-1">
            {line.membership_conflict ? <UiBadge tone="danger">{text("Conflict")}</UiBadge> : null}
            {!line.included_in_total ? <UiBadge tone="warning">{text("Excluded from total")}</UiBadge> : null}
            <UiBadge tone={line.complete ? "success" : "warning"}>{text(line.complete ? "Complete" : "Incomplete")}</UiBadge>
          </span>
        </span>
      ),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={entity.lines}
      rowKey={(line) => `${line.subject_type}-${line.subject_id}`}
      status={resolveListTableStatus({ loading: false, error: null, rowCount: entity.lines.length })}
      loadingMessage={text("Loading Billing Entity details...")}
      errorMessage={text("Unable to load Billing Entity details.")}
      emptyMessage={text("No subject detail is available for this Billing Entity.")}
      primaryColumnId="subject"
      responsiveCards
      tableClassName="ui-data-table"
    />
  );
}

function EntityDetail({ entity, month }: { entity: BillingEntityAnalysisPreview; month: string }) {
  const { intlLocale, text } = useAdminI18n();
  return (
    <section className="ui-surface-card p-4" data-testid="billing-entity-detail">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{entity.billing_entity_name}</h2>
          <p className={cx("ui-caption", uiMutedTextClass)}>
            {text("Monthly Billing Entity preview for {month}. Rates and membership are resolved dynamically.", { month })}
          </p>
        </div>
        <AnalysisState complete={entity.complete} conflictCount={entity.conflict_count} />
      </div>
      <div className="mt-3">
        <InlineSummary
          items={[
            { label: text("Members"), value: entity.member_count },
            {
              label: text("Totals"),
              value: totalsText(entity.currency_totals, intlLocale).length > 0
                ? totalsText(entity.currency_totals, intlLocale).join(" · ")
                : "-",
            },
            { label: text("Storage coverage"), value: percentage(entity.coverage.storage_coverage_ratio) },
            { label: text("Usage coverage"), value: percentage(entity.coverage.usage_coverage_ratio) },
            {
              label: text("Quota coverage"),
              value: entity.coverage.quota_observations_expected > 0
                ? percentage(entity.coverage.quota_coverage_ratio)
                : text("Not applicable"),
            },
          ]}
        />
      </div>
      {entity.issues.length > 0 ? (
        <PageBanner tone="warning" className="mt-3">
          {text("This preview is incomplete: {issues}", { issues: entity.issues.join(", ") })}
        </PageBanner>
      ) : null}
      <div className="mt-4">
        <EntityLinesTable entity={entity} />
      </div>
    </section>
  );
}

function EntityAnalysis({ analysis, month }: { analysis: BillingAnalysisPreview; month: string }) {
  const { intlLocale, text } = useAdminI18n();
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const selectedEntity = analysis.entities.find((entity) => entity.billing_entity_id === selectedEntityId) ?? null;

  useEffect(() => {
    if (selectedEntityId != null && !analysis.entities.some((entity) => entity.billing_entity_id === selectedEntityId)) {
      setSelectedEntityId(null);
    }
  }, [analysis.entities, selectedEntityId]);

  const columns: Array<DataTableColumn<BillingEntityAnalysisPreview>> = [
    {
      id: "name",
      label: text("Billing Entity"),
      primary: true,
      render: (entity) => (
        <span>
          <span className="block">{entity.billing_entity_name}</span>
          {entity.billing_entity_code ? <span className={cx("block ui-caption", uiMutedTextClass)}>{entity.billing_entity_code}</span> : null}
        </span>
      ),
    },
    { id: "subject", label: text("Subject level"), render: (entity) => entity.subject_type === "account" ? text("Accounts") : text("S3 Users") },
    { id: "members", label: text("Members"), render: (entity) => entity.member_count },
    {
      id: "total",
      label: text("Total"),
      render: (entity) => (
        <span className="space-y-0.5">
          {totalsText(entity.currency_totals, intlLocale).length > 0
            ? totalsText(entity.currency_totals, intlLocale).map((total) => <span key={total} className="block">{total}</span>)
            : "-"}
        </span>
      ),
    },
    { id: "pricing", label: text("Storage basis"), render: (entity) => <StorageBasisBadges bases={entity.storage_charge_bases} /> },
    { id: "coverage", label: text("Coverage"), render: (entity) => <CoverageSummary coverage={entity.coverage} /> },
    { id: "state", label: text("State"), render: (entity) => <AnalysisState complete={entity.complete} conflictCount={entity.conflict_count} /> },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (entity) => (
        <ListActionButton
          type="button"
          onClick={() => setSelectedEntityId(entity.billing_entity_id)}
          {...dataTableDefaultActionProps}
        >
          {text("View")}
        </ListActionButton>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {analysis.conflicts.length > 0 ? (
        <PageBanner tone="warning">
          {text("{count} subject(s) match multiple Billing Entities. Conflicted subjects are excluded from consolidated totals.", { count: analysis.conflicts.length })}
        </PageBanner>
      ) : null}
      {analysis.unassigned.length > 0 ? (
        <PageBanner tone="warning">
          {text("{count} billing subject(s) are not assigned to any Billing Entity.", { count: analysis.unassigned.length })}
        </PageBanner>
      ) : null}
      <ListPageSection
        variant="section"
        title={text("Billing Entities")}
        countLabel={analysis.entities.length === 1
          ? text("1 entity")
          : text("{count} entities", { count: analysis.entities.length })}
      >
        <DataTableShell
          columns={columns}
          rows={analysis.entities}
          rowKey={(entity) => entity.billing_entity_id}
          status={resolveListTableStatus({ loading: false, error: null, rowCount: analysis.entities.length })}
          loadingMessage={text("Loading Billing Entities...")}
          errorMessage={text("Unable to load Billing Entities.")}
          emptyMessage={text("No Billing Entity analysis is available for this month.")}
          primaryColumnId="name"
          responsiveCards
          tableClassName="ui-data-table"
          rowAttributes={(entity) => ({ "aria-current": entity.billing_entity_id === selectedEntityId ? "true" : undefined })}
        />
      </ListPageSection>
      {selectedEntity ? <EntityDetail entity={selectedEntity} month={month} /> : (
        <PageBanner tone="info">{text("Select a Billing Entity to inspect endpoint and subject pricing details.")}</PageBanner>
      )}
    </div>
  );
}

function GroupAnalysis({ analysis, month }: { analysis: BillingAnalysisPreview; month: string }) {
  const { intlLocale, text } = useAdminI18n();
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const entityById = useMemo(
    () => new Map(analysis.entities.map((entity) => [entity.billing_entity_id, entity])),
    [analysis.entities],
  );
  const selectedGroup = analysis.groups.find((group) => group.billing_entity_group_id === selectedGroupId) ?? null;

  useEffect(() => {
    if (selectedGroupId != null && !analysis.groups.some((group) => group.billing_entity_group_id === selectedGroupId)) {
      setSelectedGroupId(null);
    }
  }, [analysis.groups, selectedGroupId]);

  const columns: Array<DataTableColumn<BillingEntityGroupAnalysisPreview>> = [
    {
      id: "name",
      label: text("Billing Group"),
      primary: true,
      render: (group) => (
        <span>
          <span className="block">{group.billing_entity_group_name}</span>
          {group.billing_entity_group_code ? <span className={cx("block ui-caption", uiMutedTextClass)}>{group.billing_entity_group_code}</span> : null}
        </span>
      ),
    },
    { id: "members", label: text("Entities"), render: (group) => group.member_entity_ids.length },
    {
      id: "total",
      label: text("Total"),
      render: (group) => (
        <span className="space-y-0.5">
          {totalsText(group.currency_totals, intlLocale).length > 0
            ? totalsText(group.currency_totals, intlLocale).map((total) => <span key={total} className="block">{total}</span>)
            : "-"}
        </span>
      ),
    },
    { id: "pricing", label: text("Storage basis"), render: (group) => <StorageBasisBadges bases={group.storage_charge_bases} /> },
    { id: "coverage", label: text("Coverage"), render: (group) => <CoverageSummary coverage={group.coverage} /> },
    { id: "state", label: text("State"), render: (group) => <AnalysisState complete={group.complete} conflictCount={group.conflict_count} /> },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (group) => (
        <ListActionButton
          type="button"
          onClick={() => setSelectedGroupId(group.billing_entity_group_id)}
          {...dataTableDefaultActionProps}
        >
          {text("View")}
        </ListActionButton>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <ListPageSection
        variant="section"
        title={text("Billing Groups")}
        countLabel={analysis.groups.length === 1
          ? text("1 group")
          : text("{count} groups", { count: analysis.groups.length })}
      >
        <DataTableShell
          columns={columns}
          rows={analysis.groups}
          rowKey={(group) => group.billing_entity_group_id}
          status={resolveListTableStatus({ loading: false, error: null, rowCount: analysis.groups.length })}
          loadingMessage={text("Loading Billing Groups...")}
          errorMessage={text("Unable to load Billing Groups.")}
          emptyMessage={text("No Billing Group analysis is available for this month.")}
          primaryColumnId="name"
          responsiveCards
          tableClassName="ui-data-table"
          rowAttributes={(group) => ({ "aria-current": group.billing_entity_group_id === selectedGroupId ? "true" : undefined })}
        />
      </ListPageSection>

      {selectedGroup ? (
        <section className="ui-surface-card p-4" data-testid="billing-group-detail">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{selectedGroup.billing_entity_group_name}</h2>
              <p className={cx("ui-caption", uiMutedTextClass)}>
                {text("Membership effective for {month}; totals reuse the member Billing Entity previews without repricing.", { month })}
              </p>
            </div>
            <AnalysisState complete={selectedGroup.complete} conflictCount={selectedGroup.conflict_count} />
          </div>
          <div className="mt-3">
            <InlineSummary
              items={[
                { label: text("Entities"), value: selectedGroup.member_entity_ids.length },
                {
                  label: text("Totals"),
                  value: totalsText(selectedGroup.currency_totals, intlLocale).length > 0
                    ? totalsText(selectedGroup.currency_totals, intlLocale).join(" · ")
                    : "-",
                },
                { label: text("Storage coverage"), value: percentage(selectedGroup.coverage.storage_coverage_ratio) },
                { label: text("Usage coverage"), value: percentage(selectedGroup.coverage.usage_coverage_ratio) },
                {
                  label: text("Quota coverage"),
                  value: selectedGroup.coverage.quota_observations_expected > 0
                    ? percentage(selectedGroup.coverage.quota_coverage_ratio)
                    : text("Not applicable"),
                },
              ]}
            />
          </div>
          {selectedGroup.missing_entity_ids.length > 0 ? (
            <PageBanner tone="warning" className="mt-3">
              {text("Some month-effective Billing Entities have no usable analysis: {ids}", { ids: selectedGroup.missing_entity_ids.join(", ") })}
            </PageBanner>
          ) : null}
          <div className="mt-4 space-y-2">
            {selectedGroup.member_entity_ids.map((entityId) => {
              const entity = entityById.get(entityId);
              if (!entity) return null;
              const totals = totalsText(entity.currency_totals, intlLocale).join(" · ") || "-";
              return (
                <UiDetails key={entityId} className={cx(uiCardMutedClass, "px-3 py-2")}>
                  <summary className="cursor-pointer ui-caption font-semibold text-[var(--ui-text)]">
                    {entity.billing_entity_name} · {totals}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <InlineSummary
                      items={[
                        { label: text("Members"), value: entity.member_count },
                        { label: text("Storage coverage"), value: percentage(entity.coverage.storage_coverage_ratio) },
                        { label: text("Usage coverage"), value: percentage(entity.coverage.usage_coverage_ratio) },
                      ]}
                    />
                    <EntityLinesTable entity={entity} />
                  </div>
                </UiDetails>
              );
            })}
          </div>
        </section>
      ) : (
        <PageBanner tone="info">{text("Select a Billing Group to inspect its month-effective entities and subject details.")}</PageBanner>
      )}
    </div>
  );
}

export default function BillingAnalysisView({ mode, month, analysis, loading, error }: BillingAnalysisViewProps) {
  const { text } = useAdminI18n();
  if (loading) return <PageBanner tone="info">{text("Loading consolidated billing analysis...")}</PageBanner>;
  if (error) return <PageBanner tone="error">{error}</PageBanner>;
  if (!analysis) return <PageBanner tone="info">{text("No consolidated billing analysis is available.")}</PageBanner>;
  return mode === "entities"
    ? <EntityAnalysis analysis={analysis} month={month} />
    : <GroupAnalysis analysis={analysis} month={month} />;
}
