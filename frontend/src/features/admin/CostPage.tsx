/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../components/list/ListControls";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import PageShell from "../../components/PageShell";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import InlineSummary from "../../components/InlineSummary";
import MobileTableSort from "../../components/list/MobileTableSort";
import UiDetails from "../../components/ui/UiDetails";
import PageEmptyState from "../../components/PageEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCardMutedClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { triggerBlobDownload } from "../../utils/download";
import { currentUtcMonthInputValue } from "../../utils/dateInputValues";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import { DownloadIcon, RefreshIcon } from "../browser/browserIcons";
import {
  CostSubjectDetail,
  CostSubjectSummary,
  CostSummary,
  getCostSubjectDetail,
  getCostSubjects,
  getCostSummary,
  downloadCostCsv,
  collectCostDaily,
} from "../../api/cost";
import { useAdminI18n } from "./adminI18n";

// QA checklist:
// - Verify summary loads with selected month/endpoint.
// - Select account and user subjects, check table values.
// - Click a row and confirm daily charts render.
// - Export CSV and validate content.

const SUBJECT_TYPES = [
  { value: "account", label: "RGW Accounts" },
  { value: "s3_user", label: "RGW Users" },
] as const;

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "cost", label: "Cost" },
  { value: "egress", label: "Egress" },
  { value: "storage", label: "Storage" },
  { value: "requests", label: "Requests" },
] as const;
type CostSortBy = (typeof SORT_OPTIONS)[number]["value"];

function defaultCollectDay(): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

function formatCurrency(value: number | null | undefined, currency: string | null | undefined, intlLocale: string): string {
  if (value === undefined || value === null) return "-";
  const code = currency || "EUR";
  return `${new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${code}`;
}

function formatCoverage(
  coverage: CostSummary["coverage"] | CostSubjectDetail["coverage"] | null | undefined,
  text: ReturnType<typeof useAdminI18n>["text"],
): string {
  if (!coverage) return "-";
  return text("{percent}% ({collected}/{total} days)", {
    percent: Math.round(coverage.coverage_ratio * 100),
    collected: coverage.days_collected,
    total: coverage.days_in_month,
  });
}

function formatCoverageBreakdown(
  coverage: CostSummary["coverage"] | CostSubjectDetail["coverage"] | null | undefined,
  text: ReturnType<typeof useAdminI18n>["text"],
): string {
  if (!coverage) return text("Coverage unavailable");
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return text("Storage {storage}d · Usage {usage}d", { storage: storageDays, usage: usageDays });
}

function hasPartialCostSources(coverage?: CostSummary["coverage"] | CostSubjectDetail["coverage"] | null): boolean {
  if (!coverage) return false;
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return storageDays !== usageDays;
}

function isLowCoverage(coverage?: CostSummary["coverage"] | CostSubjectDetail["coverage"] | null): boolean {
  return Boolean(coverage && coverage.days_collected > 0 && coverage.coverage_ratio < 0.8);
}

function extractCollectionErrors(result: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const errors = result?.errors;
  return Array.isArray(errors) ? errors.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")) : [];
}

function formatCollectionIssue(entry: Record<string, unknown>): string {
  const stage = typeof entry.stage === "string" ? entry.stage : "collection";
  const stageLabel = stage === "usage" ? "Usage" : stage === "storage" ? "Storage" : stage === "endpoint" ? "Endpoint client" : "Collection";
  const endpoint = entry.endpoint_id != null ? `endpoint #${String(entry.endpoint_id)}` : null;
  const subject = typeof entry.subject === "string"
    ? `${entry.subject}${entry.subject_id != null ? ` #${String(entry.subject_id)}` : ""}`
    : null;
  const target = [subject, endpoint].filter(Boolean).join(" · ");
  return target ? `${stageLabel}: ${target}` : stageLabel;
}

function formatCollectionResult(result: Record<string, unknown> | null, day: string): string | null {
  if (!result) return null;
  const endpoints = Number(result.endpoints ?? 0);
  const storageRecords = Number(result.storage_records ?? 0);
  const usageRecords = Number(result.usage_records ?? 0);
  const errors = extractCollectionErrors(result).length;
  const prefix = errors > 0 ? "Collection finished with issues" : "Collection completed";
  return `${prefix} for ${day}: ${endpoints} endpoint${endpoints === 1 ? "" : "s"}, ${storageRecords} storage record${storageRecords === 1 ? "" : "s"}, ${usageRecords} usage record${usageRecords === 1 ? "" : "s"}, ${errors} error${errors === 1 ? "" : "s"}.`;
}

function isCostDisabledMessage(message: string): boolean {
  return message.toLowerCase().includes("cost is disabled");
}

export default function CostPage() {
  const { intlLocale, text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const [month, setMonth] = useState<string>(currentUtcMonthInputValue());
  const [collectDay, setCollectDay] = useState<string>(defaultCollectDay());
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [subjectType, setSubjectType] = useState<"account" | "s3_user">("account");
  const [sortBy, setSortBy] = useState<CostSortBy>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [reloadToken, setReloadToken] = useState(0);

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);

  const [subjects, setSubjects] = useState<CostSubjectSummary[]>([]);
  const [subjectsTotal, setSubjectsTotal] = useState<number>(0);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [subjectsLoading, setSubjectsLoading] = useState<boolean>(false);

  const [detail, setDetail] = useState<CostSubjectDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  const [pageError, setPageError] = useState<string | null>(null);
  const [costDisabled, setCostDisabled] = useState<boolean>(false);
  const [collectLoading, setCollectLoading] = useState<boolean>(false);
  const [collectMessage, setCollectMessage] = useState<string | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collectResult, setCollectResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      try {
        const data = await listStorageEndpoints();
        if (cancelled) return;
        const cephEndpoints = data.filter((endpoint) => endpoint.provider === "ceph");
        setEndpoints(cephEndpoints);
        if (cephEndpoints.length === 0) {
          setSelectedEndpointId(null);
          setPageError(adminText("No Ceph endpoint available for cost"));
        } else {
          const preferred = cephEndpoints.find((ep) => ep.is_default) || cephEndpoints[0];
          setSelectedEndpointId((current) => current ?? preferred.id);
          setPageError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setEndpoints([]);
          setSelectedEndpointId(null);
          setPageError(extractApiError(err, adminText("Unable to retrieve the endpoint list.")));
        }
      }
    }
    loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, [adminText]);

  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      if (!selectedEndpointId) {
        setSummary(null);
        return;
      }
      setSummaryLoading(true);
      setSummaryError(null);
      setCostDisabled(false);
      try {
        const data = await getCostSummary(month, selectedEndpointId);
        if (!cancelled) {
          setSummary(data);
        }
      } catch (err) {
        if (!cancelled) {
          const message = extractApiError(err, adminText("Unable to load cost summary."));
          setSummary(null);
          setSummaryError(message);
          setCostDisabled(isCostDisabledMessage(message));
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    }
    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [adminText, month, selectedEndpointId, reloadToken]);

  useEffect(() => {
    setPage(1);
    setDetail(null);
    setDetailError(null);
  }, [month, selectedEndpointId, subjectType, sortBy, sortDir]);

  useEffect(() => {
    let cancelled = false;
    async function loadSubjects() {
      if (!selectedEndpointId) {
        setSubjects([]);
        setSubjectsTotal(0);
        return;
      }
      setSubjectsLoading(true);
      setSubjectsError(null);
      try {
        const data = await getCostSubjects(month, selectedEndpointId, subjectType, page, pageSize, sortBy, sortDir);
        if (!cancelled) {
          setSubjects(data.items);
          setSubjectsTotal(data.total);
        }
      } catch (err) {
        if (!cancelled) {
          setSubjects([]);
          setSubjectsTotal(0);
          setSubjectsError(extractApiError(err, adminText("Unable to load cost subjects.")));
        }
      } finally {
        if (!cancelled) {
          setSubjectsLoading(false);
        }
      }
    }
    loadSubjects();
    return () => {
      cancelled = true;
    };
  }, [adminText, month, page, pageSize, selectedEndpointId, subjectType, sortBy, sortDir, reloadToken]);

  useEffect(() => {
    if (!subjects.length) {
      setDetail(null);
    }
  }, [subjects]);

  const detailSubjectId = detail?.subject_id ?? null;
  const detailSubjectType = detail?.subject_type ?? null;

  useEffect(() => {
    if (detailSubjectId == null || !detailSubjectType || !selectedEndpointId) {
      return;
    }
    const endpointId = selectedEndpointId;
    const subjectType = detailSubjectType as "account" | "s3_user";
    const subjectId = detailSubjectId;
    let cancelled = false;
    async function reloadDetail() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await getCostSubjectDetail(
          month,
          endpointId,
          subjectType,
          subjectId
        );
        if (!cancelled) {
          setDetail(data);
        }
      } catch (err) {
        if (!cancelled) {
          setDetailError(extractApiError(err, adminText("Unable to load cost detail.")));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }
    reloadDetail();
    return () => {
      cancelled = true;
    };
  }, [adminText, detailSubjectId, detailSubjectType, month, selectedEndpointId, reloadToken]);

  const stats = useMemo(() => {
    const storageAvg = summary?.storage?.avg_bytes ?? null;
    const egress = summary?.usage?.bytes_out ?? null;
    const ingress = summary?.usage?.bytes_in ?? null;
    const requests = summary?.usage?.ops_total ?? null;
    const coverage = summary?.coverage?.coverage_ratio ?? null;
    return [
      {
        label: adminText("Avg storage"),
        value: storageAvg !== null ? formatBytes(storageAvg) : "-",
      },
      {
        label: adminText("Egress"),
        value: egress !== null ? formatBytes(egress) : "-",
      },
      {
        label: adminText("Ingress"),
        value: ingress !== null ? formatBytes(ingress) : "-",
      },
      {
        label: adminText("Requests"),
        value: requests != null ? formatCompactNumber(requests) : "-",
      },
      {
        label: adminText("Coverage"),
        value: coverage != null ? `${Math.round(coverage * 100)}%` : "-",
        hint: formatCoverageBreakdown(summary?.coverage, adminText),
      },
      {
        label: adminText("Estimated cost"),
        value: summary?.cost?.total_cost != null ? formatCurrency(summary.cost.total_cost, summary.cost.currency, intlLocale) : "-",
        hint: summary?.cost?.pricing_source === "endpoint_override"
          ? adminText("Endpoint override")
          : summary?.cost?.pricing_source === "mixed"
            ? adminText("Mixed endpoint pricing")
            : summary?.cost
              ? adminText("Global cost model")
              : adminText("Cost model not configured"),
      },
    ];
  }, [adminText, intlLocale, summary]);

  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId]
  );
  const hasCostData = Boolean(summary && (summary.coverage.days_collected > 0 || subjectsTotal > 0));
  const canExport = Boolean(selectedEndpointId && hasCostData && !summaryLoading && !subjectsLoading && !costDisabled);
  const canCollect = Boolean(collectDay && !collectLoading && !costDisabled);
  const collectionErrors = extractCollectionErrors(collectResult);
  const noCostModel = Boolean(summary && summary.coverage.days_collected > 0 && !summary.cost);
  const lowCoverage = isLowCoverage(summary?.coverage);
  const partialSources = hasPartialCostSources(summary?.coverage);

  async function handleRowClick(subject: CostSubjectSummary) {
    if (!selectedEndpointId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await getCostSubjectDetail(month, selectedEndpointId, subject.subject_type as "account" | "s3_user", subject.subject_id);
      setDetail(data);
    } catch (err) {
      setDetail(null);
      setDetailError(extractApiError(err, adminText("Unable to load cost detail.")));
    } finally {
      setDetailLoading(false);
    }
  }

  function handleTableSort(field: CostSortBy) {
    if (field === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "name" ? "asc" : "desc");
  }

  async function handleExport() {
    if (!selectedEndpointId || !canExport) return;
    setPageError(null);
    try {
      const blob = await downloadCostCsv(month, selectedEndpointId);
      triggerBlobDownload(
        `cost-${month}-endpoint-${selectedEndpointId}.csv`,
        blob,
      );
    } catch (err) {
      setPageError(extractApiError(err, adminText("Unable to export CSV.")));
    }
  }

  async function handleCollectDaily() {
    if (!canCollect) return;
    setCollectLoading(true);
    setCollectMessage(null);
    setCollectError(null);
    setCollectResult(null);
    try {
      const result = await collectCostDaily(collectDay);
      setCollectResult(result);
      setCollectMessage(formatCollectionResult(result, collectDay));
      setReloadToken((prev) => prev + 1);
    } catch (err) {
      setCollectError(extractApiError(err, adminText("Unable to trigger cost collection.")));
    } finally {
      setCollectLoading(false);
    }
  }

  const dailySeries = useMemo(() => {
    return (detail?.daily ?? []).map((point) => ({
      ...point,
      label: point.day.slice(5),
      traffic_bytes: (point.bytes_in ?? 0) + (point.bytes_out ?? 0),
    }));
  }, [detail]);
  const subjectsTableStatus = resolveListTableStatus({
    loading: subjectsLoading,
    error: subjectsError,
    rowCount: subjects.length,
  });
  const subjectTableColumns: Array<DataTableColumn<CostSubjectSummary, CostSortBy>> = [
    {
      id: "name",
      label: "Name",
      field: "name",
      primary: true,
      render: (subject) => (
        <span>
          <span className="block">{subject.name}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{subject.rgw_identifier ?? "No RGW identifier"}</span>
        </span>
      ),
    },
    {
      id: "storage",
      label: "Storage avg",
      field: "storage",
      render: (subject) => formatBytes(subject.storage.avg_bytes),
    },
    {
      id: "egress",
      label: "Egress",
      field: "egress",
      render: (subject) => formatBytes(subject.usage.bytes_out),
    },
    {
      id: "ingress",
      label: "Ingress",
      render: (subject) => formatBytes(subject.usage.bytes_in),
    },
    {
      id: "requests",
      label: "Requests",
      field: "requests",
      render: (subject) => formatCompactNumber(subject.usage.ops_total),
    },
    {
      id: "cost",
      label: "Cost",
      field: "cost",
      render: (subject) => (subject.cost?.total_cost != null ? formatCurrency(subject.cost.total_cost, subject.cost.currency, intlLocale) : "-"),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (subject) => (
        <ListActionButton
          type="button"
          onClick={() => void handleRowClick(subject)}
          {...dataTableDefaultActionProps}
        >
          {adminText("View")}</ListActionButton>
      ),
    },
  ];

  return (
    <PageShell actionPresentation="listing"
      title={adminText("Cost")}
      description={adminText("Monthly usage and cost overview.")}
      breadcrumbs={adminBreadcrumbs("cost")}
      rightContent={
        <>
          <UiInput
            label={adminText("Month")}
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            size="compact"
            className="ui-list-control"
          />
          <UiSelect
            label={adminText("Endpoint")}
            value={selectedEndpointId ?? ""}
            onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
            size="compact"
            className="ui-list-control"
          >
            {endpoints.length === 0 ? <option value="">{adminText("No Ceph endpoint")}</option> : null}
            {endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
              </option>
            ))}
          </UiSelect>
          <ListActionButton
            variant="secondary"
            onClick={() => void handleExport()}
            disabled={!canExport}
            title={canExport ? "Export the selected month as CSV" : "Select a Ceph endpoint with cost data before exporting"}
          >
            <DownloadIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {adminText("Export CSV")}</ListActionButton>
        </>
      }
    >
      {pageError && selectedEndpointId != null ? <PageBanner tone="error">{pageError}</PageBanner> : null}
      {costDisabled ? (
        <PageBanner tone="warning">
          {adminText("Cost is disabled. Enable it in General settings to use this page.")}</PageBanner>
      ) : null}
      {!selectedEndpointId ? (
        <PageEmptyState
          title={adminText("No Ceph endpoint available for cost")}
          description={pageError || "Add or enable a Ceph endpoint before loading cost analytics."}
          primaryAction={{ label: "Open endpoints", to: "/admin/endpoints" }}
          tone="warning"
        />
      ) : (
        <>
          <UiDetails className="text-xs">
            <summary className="ui-list-control w-fit cursor-pointer rounded-md py-2 font-medium text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus-ring)]">
              {adminText("Manual daily collection")}</summary>
            <p className="mb-2 text-[var(--ui-text-muted)]">{adminText("Run the cost collector for one UTC day when scheduler data is missing or stale.")}</p>
            <div className="ui-list-toolbar flex flex-wrap items-end gap-2 pb-2">
              <UiInput label={adminText("Collect day")} type="date" value={collectDay} onChange={(event) => setCollectDay(event.target.value)} size="compact" />
              <ListActionButton variant="primary" onClick={() => void handleCollectDaily()} loading={collectLoading} disabled={!canCollect}>
                <RefreshIcon aria-hidden="true" className={cx("h-3.5 w-3.5", collectLoading && "animate-spin")} />
                {collectLoading ? "Collecting..." : "Collect daily"}
              </ListActionButton>
            </div>
          </UiDetails>
          {collectLoading ? <PageBanner tone="info">{adminText("Collecting daily cost usage...")}</PageBanner> : null}
          {collectMessage ? <PageBanner tone={collectionErrors.length > 0 ? "warning" : "success"}>{collectMessage}</PageBanner> : null}
          {collectError ? <PageBanner tone="error">{collectError}</PageBanner> : null}
          {collectionErrors.length > 0 ? (
            <div className={cx(uiCardMutedClass, "px-3 py-2")}>
              <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Collection issues")}</p>
              <ul className={cx("mt-2 space-y-1 ui-caption", uiMutedTextClass)}>
                {collectionErrors.slice(0, 5).map((entry, index) => (
                  <li key={index}>{formatCollectionIssue(entry)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {summaryError ? <PageBanner tone={costDisabled ? "warning" : "error"}>{summaryError}</PageBanner> : null}
          {lowCoverage ? (
            <PageBanner tone="warning">
              {adminText("Cost coverage is partial for this month:")}{formatCoverage(summary?.coverage, adminText)}{adminText(". Treat estimated cost as provisional.")}</PageBanner>
          ) : null}
          {partialSources ? (
            <PageBanner tone="warning">
              {adminText("Storage and usage sources do not cover the same number of days (")}{formatCoverageBreakdown(summary?.coverage, adminText)}).
            </PageBanner>
          ) : null}
          {noCostModel ? (
            <PageBanner tone="warning">
              {adminText("No cost model is configured. Usage totals are available, but estimated cost stays unavailable.")}</PageBanner>
          ) : null}
          {summaryLoading ? <PageBanner tone="info">{adminText("Loading summary...")}</PageBanner> : <InlineSummary label={`Monthly totals · ${selectedEndpoint?.name ?? ""} · ${month}`} items={stats} />}

          <ListPageSection variant="section"
            title={adminText("Subjects")}
            mobileSort={<MobileTableSort options={SORT_OPTIONS} field={sortBy} direction={sortDir} onFieldChange={setSortBy} onDirectionChange={setSortDir} />}
            countLabel={`${subjectsTotal} subject${subjectsTotal === 1 ? "" : "s"}`}
            filters={
              <div className="flex min-w-0 flex-wrap items-end gap-2">
                <UiSelect
                  label={adminText("Subject")}
                  value={subjectType}
                  onChange={(event) => setSubjectType(event.target.value as "account" | "s3_user")}
                  size="compact"
                >
                  {SUBJECT_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </UiSelect>

              </div>
            }
          >
            {subjectsError ? <PageBanner tone="error">{subjectsError}</PageBanner> : null}
            <DataTableShell
              columns={subjectTableColumns}
              rows={subjects}
              rowKey={(subject) => `${subject.subject_type}-${subject.subject_id}`}
              status={subjectsTableStatus}
              loadingMessage="Loading subjects..."
              errorMessage="Unable to load subjects."
              emptyMessage="No subjects for this scope."
              primaryColumnId="name"
              sort={{ field: sortBy, direction: sortDir, onSort: handleTableSort }}
              pagination={{
                page,
                pageSize,
                total: subjectsTotal,
                onPageChange: setPage,
                onPageSizeChange: (size) => {
                  setPageSize(size);
                  setPage(1);
                },
                pageSizeOptions: [10, 25, 50, 100, 200],
                disabled: subjectsLoading,
              }}
              responsiveCards
              tableClassName="ui-data-table"
              rowClassName={(subject) =>
                cx(
                  "bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50",
                  detail?.subject_type === subject.subject_type &&
                    detail.subject_id === subject.subject_id &&
                    "bg-[var(--ui-selected-bg)] dark:bg-[var(--ui-selected-bg)]"
                )
              }
              rowAttributes={(subject) => ({
                "aria-current": detail?.subject_type === subject.subject_type && detail.subject_id === subject.subject_id ? "true" : undefined,
              })}
            />
          </ListPageSection>

          <section className="ui-surface-card p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("Subject detail")}</h2>
                <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Daily storage, traffic, requests, coverage, and cost for the selected subject.")}</p>
              </div>
              {detail?.name ? <div className={cx("ui-caption", uiMutedTextClass)}>{detail.name}</div> : null}
            </div>
            {detailLoading ? <PageBanner tone="info" className="mt-3">{adminText("Loading detail...")}</PageBanner> : null}
            {detailError ? <PageBanner tone="error" className="mt-3">{detailError}</PageBanner> : null}
            {!detailLoading && !detail ? <PageBanner tone="info" className="mt-3">{adminText("Select a subject to view charts.")}</PageBanner> : null}
            {!detailLoading && detail ? (
              <div className="mt-4 space-y-4">
                {hasPartialCostSources(detail.coverage) ? (
                  <PageBanner tone="warning">
                    {adminText(
                      "This subject has partial source coverage: {coverage}.",
                      { coverage: formatCoverageBreakdown(detail.coverage, adminText) },
                    )}
                  </PageBanner>
                ) : null}
                {!detail.cost ? (
                  <PageBanner tone="warning">{adminText("No cost model is configured, so estimated cost is unavailable.")}</PageBanner>
                ) : null}
                <div className="grid gap-4 lg:grid-cols-3">
                  {dailySeries.length > 0 ? (
                    <>
                      <div className={cx(uiCardMutedClass, "p-3")}>
                        <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Storage (daily)")}</h3>
                        <div className="mt-3 h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dailySeries}>
                              <defs>
                                <linearGradient id="storageFill" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value) || 0)} domain={["dataMin", "dataMax"]} />
                              <Tooltip formatter={(value) => formatBytes(value as number)} />
                              <Area type="monotone" dataKey="storage_bytes" stroke="#3b82f6" fill="url(#storageFill)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className={cx(uiCardMutedClass, "p-3")}>
                        <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Traffic (daily)")}</h3>
                        <div className="mt-3 h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailySeries}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value) || 0)} />
                              <Tooltip formatter={(value) => formatBytes(value as number)} />
                              <Bar dataKey="traffic_bytes" fill="#0569f8" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className={cx(uiCardMutedClass, "p-3")}>
                        <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Requests (daily)")}</h3>
                        <div className="mt-3 h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailySeries}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} />
                              <Tooltip formatter={(value) => formatCompactNumber(value as number)} />
                              <Bar dataKey="ops_total" fill="#22c55e" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="lg:col-span-3">
                      <PageBanner tone="info">{adminText("No daily cost points are available for this subject and month.")}</PageBanner>
                    </div>
                  )}
                  <div className={cx(uiCardMutedClass, "p-3 lg:col-span-3")}>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Avg storage")}</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatBytes(detail.storage.avg_bytes)}</p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Egress")}</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatBytes(detail.usage.bytes_out)}</p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Ingress")}</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatBytes(detail.usage.bytes_in)}</p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Requests")}</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatCompactNumber(detail.usage.ops_total)}</p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Cost")}</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>
                          {detail.cost?.total_cost != null ? formatCurrency(detail.cost.total_cost, detail.cost.currency, intlLocale) : "-"}
                        </p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Coverage")}</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatCoverage(detail.coverage, adminText)}</p>
                        <p className={cx("ui-caption", uiMutedTextClass)}>{formatCoverageBreakdown(detail.coverage, adminText)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </>
      )}
    </PageShell>
  );
}
