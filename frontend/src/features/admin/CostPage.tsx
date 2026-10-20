/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ListActionButton, ListActionLink } from "../../components/list/ListControls";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import MobileTableSort from "../../components/list/MobileTableSort";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageShell from "../../components/PageShell";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import InlineSummary from "../../components/InlineSummary";
import UiDetails from "../../components/ui/UiDetails";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCardMutedClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { triggerBlobDownload } from "../../utils/download";
import { currentUtcMonthInputValue } from "../../utils/dateInputValues";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import { DownloadIcon, RefreshIcon } from "../browser/browserIcons";
import {
  collectCostDaily,
  downloadCostCsv,
  getCostAnalytics,
  getCostSubjects,
  getCostSummary,
  type CostAnalyticsResponse,
  type CostCoverage,
  type CostSubjectSummary,
  type CostSummary,
} from "../../api/cost";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useAdminI18n } from "./adminI18n";

type SubjectType = "all" | "account" | "s3_user";
type CostTab = "subjects" | "analytics";

const SUBJECT_TYPES: ReadonlyArray<{ value: SubjectType; label: string }> = [
  { value: "all", label: "All subjects" },
  { value: "account", label: "RGW Accounts" },
  { value: "s3_user", label: "RGW Users" },
];

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "endpoint", label: "Endpoint" },
  { value: "cost", label: "Cost" },
  { value: "egress", label: "Egress" },
  { value: "storage", label: "Storage" },
  { value: "requests", label: "Requests" },
] as const;
type CostSortBy = (typeof SORT_OPTIONS)[number]["value"];

const COMPONENT_COLORS = ["#2563eb", "#f97316", "#14b8a6", "#8b5cf6"];
const CONCENTRATION_COLORS = ["#2563eb", "#cbd5e1"];

function defaultCollectDay(): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSubjectType(value: string | null): SubjectType {
  return value === "account" || value === "s3_user" ? value : "all";
}

function parseSortBy(value: string | null): CostSortBy {
  return SORT_OPTIONS.some((option) => option.value === value) ? (value as CostSortBy) : "name";
}

function formatCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
  intlLocale: string,
): string {
  if (value === undefined || value === null) return "-";
  const code = currency || "EUR";
  return `${new Intl.NumberFormat(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${code}`;
}

function formatCoverage(
  coverage: CostCoverage | null | undefined,
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
  coverage: CostCoverage | null | undefined,
  text: ReturnType<typeof useAdminI18n>["text"],
): string {
  if (!coverage) return text("Coverage unavailable");
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return text("Storage {storage}d · Usage {usage}d", { storage: storageDays, usage: usageDays });
}

function hasPartialCostSources(coverage?: CostCoverage | null): boolean {
  if (!coverage) return false;
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return storageDays !== usageDays;
}

function isLowCoverage(coverage?: CostCoverage | null): boolean {
  return Boolean(coverage && coverage.days_collected > 0 && coverage.coverage_ratio < 0.8);
}

function extractCollectionErrors(result: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const errors = result?.errors;
  return Array.isArray(errors)
    ? errors.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    : [];
}

function formatCollectionIssue(entry: Record<string, unknown>): string {
  const stage = typeof entry.stage === "string" ? entry.stage : "collection";
  const stageLabel =
    stage === "usage" ? "Usage" : stage === "storage" ? "Storage" : stage === "endpoint" ? "Endpoint client" : "Collection";
  const endpoint = entry.endpoint_id != null ? `endpoint #${String(entry.endpoint_id)}` : null;
  const subject =
    typeof entry.subject === "string"
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

function subjectTypeLabel(subjectType: string): string {
  return subjectType === "account" ? "RGW Account" : subjectType === "s3_user" ? "RGW User" : subjectType;
}

export default function CostPage() {
  const { intlLocale, text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [month, setMonth] = useState(() => searchParams.get("month") || currentUtcMonthInputValue());
  const [collectDay, setCollectDay] = useState(defaultCollectDay);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [endpointsLoaded, setEndpointsLoaded] = useState(false);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(() => {
    const value = searchParams.get("endpoint_id");
    return value ? parsePositiveInt(value, 0) || null : null;
  });
  const [subjectType, setSubjectType] = useState<SubjectType>(() => parseSubjectType(searchParams.get("type")));
  const [activeTab, setActiveTab] = useState<CostTab>(() => (searchParams.get("tab") === "analytics" ? "analytics" : "subjects"));
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [sortBy, setSortBy] = useState<CostSortBy>(() => parseSortBy(searchParams.get("sort")));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (searchParams.get("direction") === "desc" ? "desc" : "asc"));
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [pageSize, setPageSize] = useState(() => parsePositiveInt(searchParams.get("page_size"), 25));
  const [reloadToken, setReloadToken] = useState(0);

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [subjects, setSubjects] = useState<CostSubjectSummary[]>([]);
  const [subjectsTotal, setSubjectsTotal] = useState(0);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [analytics, setAnalytics] = useState<CostAnalyticsResponse | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [pageError, setPageError] = useState<string | null>(null);
  const [costDisabled, setCostDisabled] = useState(false);
  const [collectLoading, setCollectLoading] = useState(false);
  const [collectMessage, setCollectMessage] = useState<string | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collectResult, setCollectResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("month", month);
    params.set("type", subjectType);
    params.set("tab", activeTab);
    params.set("sort", sortBy);
    params.set("direction", sortDir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    if (selectedEndpointId != null) params.set("endpoint_id", String(selectedEndpointId));
    if (search.trim()) params.set("search", search.trim());
    setSearchParams(params, { replace: true });
  }, [activeTab, month, page, pageSize, search, selectedEndpointId, setSearchParams, sortBy, sortDir, subjectType]);

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      try {
        const data = await listStorageEndpoints();
        if (cancelled) return;
        const cephEndpoints = data.filter((endpoint) => endpoint.provider === "ceph");
        setEndpoints(cephEndpoints);
        setSelectedEndpointId((current) =>
          current != null && !cephEndpoints.some((endpoint) => endpoint.id === current) ? null : current,
        );
        setPageError(null);
      } catch (err) {
        if (!cancelled) {
          setEndpoints([]);
          setSelectedEndpointId(null);
          setPageError(extractApiError(err, adminText("Unable to retrieve the endpoint list.")));
        }
      } finally {
        if (!cancelled) setEndpointsLoaded(true);
      }
    }
    void loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, [adminText]);

  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      setSummaryLoading(true);
      setSummaryError(null);
      setCostDisabled(false);
      try {
        const data = await getCostSummary(month, selectedEndpointId);
        if (!cancelled) setSummary(data);
      } catch (err) {
        if (!cancelled) {
          const message = extractApiError(err, adminText("Unable to load cost summary."));
          setSummary(null);
          setSummaryError(message);
          setCostDisabled(isCostDisabledMessage(message));
        }
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }
    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [adminText, month, selectedEndpointId, reloadToken]);

  const filterResetInitialized = useRef(false);
  useEffect(() => {
    if (!filterResetInitialized.current) {
      filterResetInitialized.current = true;
      return;
    }
    setPage(1);
  }, [month, search, selectedEndpointId, subjectType, sortBy, sortDir]);

  useEffect(() => {
    let cancelled = false;
    async function loadSubjects() {
      setSubjectsLoading(true);
      setSubjectsError(null);
      try {
        const data = await getCostSubjects(
          month,
          selectedEndpointId,
          subjectType,
          page,
          pageSize,
          sortBy,
          sortDir,
          search,
        );
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
        if (!cancelled) setSubjectsLoading(false);
      }
    }
    void loadSubjects();
    return () => {
      cancelled = true;
    };
  }, [adminText, month, page, pageSize, reloadToken, search, selectedEndpointId, sortBy, sortDir, subjectType]);

  useEffect(() => {
    if (activeTab !== "analytics") return;
    let cancelled = false;
    async function loadAnalytics() {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      try {
        const data = await getCostAnalytics(month, selectedEndpointId, subjectType);
        if (!cancelled) setAnalytics(data);
      } catch (err) {
        if (!cancelled) {
          setAnalytics(null);
          setAnalyticsError(extractApiError(err, adminText("Unable to load cost analytics.")));
        }
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    }
    void loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [activeTab, adminText, month, reloadToken, selectedEndpointId, subjectType]);

  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId],
  );
  const scopeLabel = selectedEndpoint?.name ?? adminText("All endpoints");
  const hasCostData = Boolean(summary && (summary.coverage.days_collected > 0 || subjectsTotal > 0));
  const canExport = Boolean(hasCostData && !summaryLoading && !subjectsLoading && !costDisabled);
  const canCollect = Boolean(collectDay && !collectLoading && !costDisabled);
  const collectionErrors = extractCollectionErrors(collectResult);
  const noCostModel = Boolean(summary && summary.coverage.days_collected > 0 && !summary.cost);
  const lowCoverage = isLowCoverage(summary?.coverage);
  const partialSources = hasPartialCostSources(summary?.coverage);

  const stats = useMemo(() => {
    const storageAvg = summary?.storage?.avg_bytes ?? null;
    const egress = summary?.usage?.bytes_out ?? null;
    const ingress = summary?.usage?.bytes_in ?? null;
    const requests = summary?.usage?.ops_total ?? null;
    const coverage = summary?.coverage?.coverage_ratio ?? null;
    return [
      { label: adminText("Avg storage"), value: storageAvg !== null ? formatBytes(storageAvg) : "-" },
      { label: adminText("Egress"), value: egress !== null ? formatBytes(egress) : "-" },
      { label: adminText("Ingress"), value: ingress !== null ? formatBytes(ingress) : "-" },
      { label: adminText("Requests"), value: requests != null ? formatCompactNumber(requests) : "-" },
      {
        label: adminText("Coverage"),
        value: coverage != null ? `${Math.round(coverage * 100)}%` : "-",
        hint: formatCoverageBreakdown(summary?.coverage, adminText),
      },
      {
        label: adminText("Estimated cost"),
        value:
          summary?.cost?.total_cost != null
            ? formatCurrency(summary.cost.total_cost, summary.cost.currency, intlLocale)
            : "-",
        hint:
          summary?.cost?.pricing_source === "endpoint_override"
            ? adminText("Endpoint override")
            : summary?.cost?.pricing_source === "mixed"
              ? adminText("Mixed endpoint pricing")
              : summary?.cost
                ? adminText("Global cost model")
                : adminText("Cost model not configured"),
      },
    ];
  }, [adminText, intlLocale, summary]);

  function buildReturnUrl(tab: CostTab = activeTab): string {
    const params = new URLSearchParams();
    params.set("month", month);
    params.set("type", subjectType);
    params.set("tab", tab);
    params.set("sort", sortBy);
    params.set("direction", sortDir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    if (selectedEndpointId != null) params.set("endpoint_id", String(selectedEndpointId));
    if (search.trim()) params.set("search", search.trim());
    return `/admin/cost?${params.toString()}`;
  }

  function buildSubjectDetailHref(subject: CostSubjectSummary, tab: CostTab = activeTab): string {
    const params = new URLSearchParams({
      month,
      endpoint_id: String(subject.storage_endpoint_id),
      return_to: buildReturnUrl(tab),
    });
    return `/admin/cost/subject/${subject.subject_type}/${subject.subject_id}?${params.toString()}`;
  }

  function handleTableSort(field: CostSortBy) {
    if (field === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "name" || field === "endpoint" ? "asc" : "desc");
  }

  async function handleExport() {
    if (!canExport) return;
    setPageError(null);
    try {
      const blob = await downloadCostCsv(month, selectedEndpointId, subjectType);
      const endpointSuffix = selectedEndpointId != null ? `endpoint-${selectedEndpointId}` : "all-endpoints";
      triggerBlobDownload(`cost-${month}-${endpointSuffix}.csv`, blob);
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
      setReloadToken((previous) => previous + 1);
    } catch (err) {
      setCollectError(extractApiError(err, adminText("Unable to trigger cost collection.")));
    } finally {
      setCollectLoading(false);
    }
  }

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
          <span className={cx("block ui-caption", uiMutedTextClass)}>
            {subject.rgw_identifier ?? adminText("No RGW identifier")}
          </span>
        </span>
      ),
    },
    {
      id: "subject_type",
      label: "Type",
      render: (subject) => subjectTypeLabel(subject.subject_type),
    },
    {
      id: "endpoint",
      label: "Endpoint",
      field: "endpoint",
      render: (subject) => subject.storage_endpoint_name,
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
      render: (subject) =>
        subject.cost?.total_cost != null
          ? formatCurrency(subject.cost.total_cost, subject.cost.currency, intlLocale)
          : "-",
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (subject) => (
        <ListActionLink to={buildSubjectDetailHref(subject)} {...dataTableDefaultActionProps}>
          {adminText("View")}
        </ListActionLink>
      ),
    },
  ];

  const componentBreakdown = useMemo(() => {
    const cost = analytics?.summary.cost;
    if (!cost) return [];
    return [
      { name: adminText("Storage"), value: cost.storage_cost ?? 0 },
      { name: adminText("Egress"), value: cost.egress_cost ?? 0 },
      { name: adminText("Ingress"), value: cost.ingress_cost ?? 0 },
      { name: adminText("Requests"), value: cost.requests_cost ?? 0 },
    ].filter((entry) => entry.value > 0);
  }, [adminText, analytics]);

  const endpointChartData = useMemo(
    () =>
      (analytics?.by_endpoint ?? []).map((endpoint) => ({
        name: endpoint.storage_endpoint_name,
        endpointId: endpoint.storage_endpoint_id,
        cost: endpoint.cost?.total_cost ?? 0,
      })),
    [analytics],
  );

  const topSubjectChartData = useMemo(
    () =>
      (analytics?.top_subjects ?? []).map((subject) => ({
        name: subject.name,
        cost: subject.cost?.total_cost ?? 0,
        subject,
      })),
    [analytics],
  );

  const historyChartData = useMemo(
    () =>
      (analytics?.history ?? []).map((entry) => ({
        month: entry.month.slice(2),
        storage: entry.cost?.storage_cost ?? 0,
        egress: entry.cost?.egress_cost ?? 0,
        ingress: entry.cost?.ingress_cost ?? 0,
        requests: entry.cost?.requests_cost ?? 0,
      })),
    [analytics],
  );

  const concentrationData = useMemo(
    () => [
      { name: adminText("Top 5"), value: analytics?.concentration.top_five_cost ?? 0 },
      { name: adminText("Others"), value: analytics?.concentration.other_cost ?? 0 },
    ].filter((entry) => entry.value > 0),
    [adminText, analytics],
  );

  function handleEndpointChartClick(state: unknown) {
    const payload = (state as { activePayload?: Array<{ payload?: { endpointId?: number } }> } | undefined)?.activePayload?.[0]?.payload;
    if (payload?.endpointId != null) {
      setSelectedEndpointId(payload.endpointId);
      setPage(1);
    }
  }

  function handleSubjectChartClick(state: unknown) {
    const payload = (state as { activePayload?: Array<{ payload?: { subject?: CostSubjectSummary } }> } | undefined)?.activePayload?.[0]?.payload;
    if (payload?.subject) navigate(buildSubjectDetailHref(payload.subject, "analytics"));
  }

  return (
    <PageShell
      actionPresentation="listing"
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
            <option value="">{adminText("All endpoints")}</option>
            {endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
              </option>
            ))}
          </UiSelect>
          <UiSelect
            label={adminText("Subject")}
            value={subjectType}
            onChange={(event) => setSubjectType(event.target.value as SubjectType)}
            size="compact"
            className="ui-list-control"
          >
            {SUBJECT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {adminText(option.label)}
              </option>
            ))}
          </UiSelect>
          <ListActionButton
            variant="secondary"
            onClick={() => void handleExport()}
            disabled={!canExport}
            title={canExport ? adminText("Export the current scope as CSV") : adminText("Cost data is required before exporting")}
          >
            <DownloadIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {adminText("Export CSV")}
          </ListActionButton>
        </>
      }
    >
      {pageError ? <PageBanner tone="error">{pageError}</PageBanner> : null}
      {costDisabled ? (
        <PageBanner tone="warning">{adminText("Cost is disabled. Enable it in General settings to use this page.")}</PageBanner>
      ) : null}

      {endpointsLoaded && endpoints.length === 0 ? (
        <PageEmptyState
          title={adminText("No Ceph endpoint available for cost")}
          description={adminText("Add or enable a Ceph endpoint before loading cost analytics.")}
          primaryAction={{ label: adminText("Open endpoints"), to: "/admin/storage-endpoints" }}
          tone="warning"
        />
      ) : (
        <>
          <UiDetails className="text-xs">
            <summary className="ui-list-control w-fit cursor-pointer rounded-md py-2 font-medium text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus-ring)]">
              {adminText("Manual daily collection")}
            </summary>
            <p className="mb-2 text-[var(--ui-text-muted)]">
              {adminText("Run the cost collector for one UTC day when scheduler data is missing or stale.")}
            </p>
            <div className="ui-list-toolbar flex flex-wrap items-end gap-2 pb-2">
              <UiInput
                label={adminText("Collect day")}
                type="date"
                value={collectDay}
                onChange={(event) => setCollectDay(event.target.value)}
                size="compact"
              />
              <ListActionButton
                variant="primary"
                onClick={() => void handleCollectDaily()}
                loading={collectLoading}
                disabled={!canCollect}
              >
                <RefreshIcon aria-hidden="true" className={cx("h-3.5 w-3.5", collectLoading && "animate-spin")} />
                {collectLoading ? adminText("Collecting...") : adminText("Collect daily")}
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
              {adminText("Cost coverage is partial for this month: {coverage}. Treat estimated cost as provisional.", {
                coverage: formatCoverage(summary?.coverage, adminText),
              })}
            </PageBanner>
          ) : null}
          {partialSources ? (
            <PageBanner tone="warning">
              {adminText("Storage and usage sources do not cover the same number of days ({coverage}).", {
                coverage: formatCoverageBreakdown(summary?.coverage, adminText),
              })}
            </PageBanner>
          ) : null}
          {noCostModel ? (
            <PageBanner tone="warning">
              {adminText("No cost model is configured. Usage totals are available, but estimated cost stays unavailable.")}
            </PageBanner>
          ) : null}
          {summaryLoading ? (
            <PageBanner tone="info">{adminText("Loading summary...")}</PageBanner>
          ) : (
            <InlineSummary label={`${adminText("Monthly totals")} · ${scopeLabel} · ${month}`} items={stats} />
          )}

          <PageTabs
            tabs={[
              { id: "subjects", label: adminText("Subjects") },
              { id: "analytics", label: adminText("Analytics") },
            ]}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as CostTab)}
            variant="line"
            ariaLabel={adminText("Cost views")}
            idPrefix="admin-cost"
          />

          {activeTab === "subjects" ? (
            <PageTabPanel idPrefix="admin-cost" tabId="subjects" className="mt-4">
              <ListPageSection
                variant="section"
                title={adminText("Subjects")}
                mobileSort={
                  <MobileTableSort
                    options={SORT_OPTIONS}
                    field={sortBy}
                    direction={sortDir}
                    onFieldChange={setSortBy}
                    onDirectionChange={setSortDir}
                  />
                }
                countLabel={`${subjectsTotal} ${adminText(subjectsTotal === 1 ? "subject" : "subjects")}`}
                search={
                  <ToolbarSearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder={adminText("Search subjects, RGW identifiers, or endpoints")}
                    label={adminText("Search")}
                  />
                }
              >
                {subjectsError ? <PageBanner tone="error">{subjectsError}</PageBanner> : null}
                <DataTableShell
                  columns={subjectTableColumns}
                  rows={subjects}
                  rowKey={(subject) => `${subject.storage_endpoint_id}-${subject.subject_type}-${subject.subject_id}`}
                  status={subjectsTableStatus}
                  loadingMessage={adminText("Loading subjects...")}
                  errorMessage={adminText("Unable to load subjects.")}
                  emptyMessage={adminText("No subjects for this scope.")}
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
                />
              </ListPageSection>
            </PageTabPanel>
          ) : (
            <PageTabPanel idPrefix="admin-cost" tabId="analytics" className="mt-4 space-y-4">
              {analyticsLoading ? <PageBanner tone="info">{adminText("Loading cost analytics...")}</PageBanner> : null}
              {analyticsError ? <PageBanner tone="error">{analyticsError}</PageBanner> : null}
              {analytics && isLowCoverage(analytics.summary.coverage) ? (
                <PageBanner tone="warning">
                  {adminText("Analytics coverage is partial for this filtered scope: {coverage}. Values are provisional.", {
                    coverage: formatCoverage(analytics.summary.coverage, adminText),
                  })}
                </PageBanner>
              ) : null}
              {analytics && hasPartialCostSources(analytics.summary.coverage) ? (
                <PageBanner tone="warning">
                  {adminText("Analytics combines sources with different coverage ({coverage}).", {
                    coverage: formatCoverageBreakdown(analytics.summary.coverage, adminText),
                  })}
                </PageBanner>
              ) : null}

              {!analyticsLoading && analytics ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <section className="ui-surface-card p-4">
                    <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("Cost by component")}</h2>
                    <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Storage, transfer, and request cost for the selected scope.")}</p>
                    {componentBreakdown.length > 0 ? (
                      <div className="mt-3 h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={componentBreakdown} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="78%">
                              {componentBreakdown.map((entry, index) => (
                                <Cell key={entry.name} fill={COMPONENT_COLORS[index % COMPONENT_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(Number(value), analytics.summary.cost?.currency, intlLocale)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <PageBanner tone="info" className="mt-3">{adminText("No component cost data is available for this scope.")}</PageBanner>
                    )}
                  </section>

                  <section className="ui-surface-card p-4">
                    <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("Cost by endpoint")}</h2>
                    <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Select a bar to focus the whole Cost page on one endpoint.")}</p>
                    {endpointChartData.length > 0 ? (
                      <div className="mt-3 h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={endpointChartData} layout="vertical" onClick={handleEndpointChartClick}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(value) => formatCurrency(Number(value), analytics.summary.cost?.currency, intlLocale)} />
                            <Bar dataKey="cost" fill="#2563eb" cursor="pointer" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <PageBanner tone="info" className="mt-3">{adminText("No endpoint cost data is available for this scope.")}</PageBanner>
                    )}
                  </section>

                  <section className="ui-surface-card p-4 xl:col-span-2">
                    <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("12-month cost trend")}</h2>
                    <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Monthly component costs ending with the selected month.")}</p>
                    <div className="mt-3 h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={historyChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(value) => formatCurrency(Number(value), analytics.summary.cost?.currency, intlLocale)} />
                          <Area type="monotone" dataKey="storage" stackId="cost" fill="#2563eb" stroke="#2563eb" />
                          <Area type="monotone" dataKey="egress" stackId="cost" fill="#f97316" stroke="#f97316" />
                          <Area type="monotone" dataKey="ingress" stackId="cost" fill="#14b8a6" stroke="#14b8a6" />
                          <Area type="monotone" dataKey="requests" stackId="cost" fill="#8b5cf6" stroke="#8b5cf6" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </section>

                  <section className="ui-surface-card p-4">
                    <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("Top 10 subjects")}</h2>
                    <p className={cx("ui-caption", uiMutedTextClass)}>{adminText("Select a bar to open that subject's dedicated cost detail.")}</p>
                    {topSubjectChartData.length > 0 ? (
                      <div className="mt-3 h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={topSubjectChartData} layout="vertical" onClick={handleSubjectChartClick}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(value) => formatCurrency(Number(value), analytics.summary.cost?.currency, intlLocale)} />
                            <Bar dataKey="cost" fill="#0f766e" cursor="pointer" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <PageBanner tone="info" className="mt-3">{adminText("No subject cost data is available for this scope.")}</PageBanner>
                    )}
                  </section>

                  <section className="ui-surface-card p-4">
                    <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("Cost concentration")}</h2>
                    <p className={cx("ui-caption", uiMutedTextClass)}>
                      {adminText("Top 5 subjects represent {percent}% of subject cost.", {
                        percent: Math.round((analytics.concentration.top_five_ratio ?? 0) * 100),
                      })}
                    </p>
                    {concentrationData.length > 0 ? (
                      <div className="mt-3 h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={concentrationData} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%">
                              {concentrationData.map((entry, index) => (
                                <Cell key={entry.name} fill={CONCENTRATION_COLORS[index % CONCENTRATION_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(Number(value), analytics.summary.cost?.currency, intlLocale)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <PageBanner tone="info" className="mt-3">{adminText("No concentration data is available for this scope.")}</PageBanner>
                    )}
                  </section>
                </div>
              ) : null}
            </PageTabPanel>
          )}
        </>
      )}
    </PageShell>
  );
}
