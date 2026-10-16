/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import {
  collectUsageHistory,
  listUsageHistory,
  type UsageHistoryGranularity,
  type UsageHistoryRecord,
  type UsageHistoryResponse,
  type UsageHistorySortBy,
  type UsageHistorySortDir,
  type UsageHistorySubjectType,
} from "../../api/usageHistory";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import InlineSummary from "../../components/InlineSummary";
import MobileTableSort from "../../components/list/MobileTableSort";
import PageShell from "../../components/PageShell";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { ListActionButton } from "../../components/list/ListControls";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { RefreshIcon } from "../browser/browserIcons";
import FeatureDisabledPage from "../shared/FeatureDisabledPage";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import { useUsageHistoryI18n, type UsageHistoryText } from "../../components/usageHistoryMessage";
import type { UiLanguage } from "../../components/language";
import { ADMIN_PAGE_CONTRACTS, WORKSPACE_CONTRACTS } from "../../navigation/workspacePages";
import { adminIntlLocale } from "./adminI18n";

function dateDaysAgo(days: number): string {
  const now = new Date();
  const value = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function todayDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

function formatDateTime(value: string | null | undefined, locale: UiLanguage): string {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(adminIntlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSubjectType(value: UsageHistoryRecord["subject_type"], text: UsageHistoryText): string {
  return text(value === "account" ? "account" : "s3User");
}

function collectionMessage(result: Awaited<ReturnType<typeof collectUsageHistory>>, text: UsageHistoryText): string {
  if (result.status === "skipped" && result.reason) {
    return result.reason;
  }
  const processed = result.subjects_processed ?? 0;
  const hourly = result.history_hourly_upserts ?? 0;
  const daily = result.history_daily_upserts ?? 0;
  const key = processed === 1
    ? daily === 1 ? "collectionSubjectSnapshot" : "collectionSubjectSnapshots"
    : daily === 1 ? "collectionSubjectsSnapshot" : "collectionSubjectsSnapshots";
  return text(key, { processed, hourly, daily });
}

function describeCollectionIssue(issue: unknown, fallback: string): string {
  if (typeof issue === "string") return issue;
  if (issue && typeof issue === "object") {
    const record = issue as Record<string, unknown>;
    const detail = record.error ?? record.warning ?? record.message;
    if (detail != null) return String(detail);
  }
  if (issue != null) return String(issue);
  return fallback;
}

function collectionIssueMessage(kind: "error" | "warning", issues: unknown[] | undefined, text: UsageHistoryText): string | null {
  if (!issues?.length) return null;
  const first = describeCollectionIssue(issues[0], text(kind === "error" ? "unknownError" : "unknownWarning"));
  const key = kind === "error"
    ? issues.length === 1 ? "collectionOneError" : "collectionErrors"
    : issues.length === 1 ? "collectionOneWarning" : "collectionWarnings";
  return text(key, { count: issues.length, first });
}

function historyTableColumns(text: UsageHistoryText, locale: UiLanguage): Array<DataTableColumn<UsageHistoryRecord, UsageHistorySortBy>> {
  return [
    {
      id: "period",
      label: text("period"),
      field: "period",
      primary: true,
      render: (item) => (
        <>
          <div className={cx("font-medium", uiTitleTextClass)}>{formatDateTime(item.period_start, locale)}</div>
          <div className={cx("ui-caption", uiMutedTextClass)}>{text(item.granularity === "hourly" ? "hourlyPeriod" : "dailyPeriod")}</div>
        </>
      ),
    },
    {
      id: "endpoint",
      label: text("endpoint"),
      render: (item) => (
        <>
          <div className={cx("font-medium", uiTitleTextClass)}>{item.endpoint_name}</div>
          <div className={cx("ui-caption", uiMutedTextClass)}>#{item.storage_endpoint_id}</div>
        </>
      ),
    },
    {
      id: "subject",
      label: text("subject"),
      field: "subject",
      render: (item) => (
        <>
          <div className={cx("font-medium", uiTitleTextClass)}>{item.subject_name}</div>
          <div className={cx("ui-caption", uiMutedTextClass)}>
            {formatSubjectType(item.subject_type, text)}
            {item.subject_identifier ? ` - ${item.subject_identifier}` : ""}
          </div>
        </>
      ),
    },
    {
      id: "storage",
      label: text("storage"),
      field: "used_bytes",
      render: (item) => (
        <>
          <div className={cx("font-medium", uiTitleTextClass)}>{formatBytes(item.used_bytes)}</div>
          {item.quota_size_bytes != null ? (
            <div className={cx("ui-caption", uiMutedTextClass)}>{text("quota", { value: formatBytes(item.quota_size_bytes) })}</div>
          ) : null}
        </>
      ),
    },
    {
      id: "objects",
      label: text("objects"),
      field: "used_objects",
      render: (item) => (
        <>
          <div className={cx("font-medium", uiTitleTextClass)}>{formatCompactNumber(item.used_objects)}</div>
          {item.quota_objects != null ? (
            <div className={cx("ui-caption", uiMutedTextClass)}>{text("quota", { value: formatCompactNumber(item.quota_objects) })}</div>
          ) : null}
        </>
      ),
    },
    {
      id: "ratio",
      label: text("quotaRatio"),
      field: "ratio",
      render: (item) => formatPercentage(item.usage_ratio_pct),
    },
    {
      id: "samples",
      label: text("samples"),
      align: "right",
      render: (item) => item.samples_count ?? (item.granularity === "hourly" ? "1" : "-"),
    },
    {
      id: "collected",
      label: text("collected"),
      render: (item) => formatDateTime(item.collected_at, locale),
    },
  ];
}

export default function UsageHistoryPage() {
  const { locale, text } = useUsageHistoryI18n();
  const { generalSettings } = useGeneralSettings();
  const [granularity, setGranularity] = useState<UsageHistoryGranularity>("daily");
  const [subjectType, setSubjectType] = useState<UsageHistorySubjectType>("all");
  const [sortBy, setSortBy] = useState<UsageHistorySortBy>("period");
  const [sortDir, setSortDir] = useState<UsageHistorySortDir>("desc");
  const [startDate, setStartDate] = useState<string>(dateDaysAgo(14));
  const [endDate, setEndDate] = useState<string>(todayDate());
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [endpointsLoading, setEndpointsLoading] = useState(false);
  const [endpointsError, setEndpointsError] = useState<string | null>(null);

  const [history, setHistory] = useState<UsageHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [collectLoading, setCollectLoading] = useState(false);
  const [collectResult, setCollectResult] = useState<Awaited<ReturnType<typeof collectUsageHistory>> | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      if (!generalSettings.usage_history_enabled) return;
      setEndpointsLoading(true);
      setEndpointsError(null);
      try {
        const data = await listStorageEndpoints();
        if (!cancelled) {
          setEndpoints(data);
        }
      } catch (err) {
        if (!cancelled) {
          setEndpoints([]);
          setEndpointsError(extractApiError(err, ""));
        }
      } finally {
        if (!cancelled) {
          setEndpointsLoading(false);
        }
      }
    }
    void loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, [generalSettings.usage_history_enabled]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      if (!generalSettings.usage_history_enabled) return;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const data = await listUsageHistory({
          granularity,
          endpointId: selectedEndpointId,
          subjectType,
          start: startDate,
          end: endDate,
          page: 1,
          pageSize: 100,
          sortBy,
          sortDir,
        });
        if (!cancelled) {
          setHistory(data);
        }
      } catch (err) {
        if (!cancelled) {
          setHistory(null);
          setHistoryError(extractApiError(err, ""));
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [
    endDate,
    generalSettings.usage_history_enabled,
    granularity,
    reloadToken,
    selectedEndpointId,
    sortBy,
    sortDir,
    startDate,
    subjectType,
  ]);

  const endpointsErrorMessage = endpointsError == null ? null : endpointsError || text("loadEndpointsError");
  const historyErrorMessage = historyError == null ? null : historyError || text("loadHistoryError");
  const collectedMessage = collectResult ? collectionMessage(collectResult, text) : null;
  const collectionError = collectionIssueMessage("error", collectResult?.errors, text);
  const collectSuccess = collectionError ? null : collectedMessage;
  const collectWarning = collectionError ? null : collectionIssueMessage("warning", collectResult?.warnings, text);
  const collectErrorMessage = collectError != null
    ? collectError || text("collectError")
    : collectionError ? `${collectedMessage} ${collectionError}` : null;
  const subjectTypes: Array<{ value: UsageHistorySubjectType; label: string }> = [
    { value: "all", label: text("allSubjects") },
    { value: "account", label: text("rgwAccounts") },
    { value: "s3_user", label: text("rgwUsers") },
  ];
  const sortOptions: Array<{ value: UsageHistorySortBy; label: string }> = [
    { value: "period", label: text("period") },
    { value: "subject", label: text("subject") },
    { value: "used_bytes", label: text("storage") },
    { value: "used_objects", label: text("objects") },
    { value: "ratio", label: text("quotaRatio") },
  ];
  const tableStatus = resolveListTableStatus({
    loading: historyLoading,
    error: historyErrorMessage,
    rowCount: history?.items.length ?? 0,
  });

  async function handleCollect() {
    setCollectLoading(true);
    setCollectResult(null);
    setCollectError(null);
    try {
      const result = await collectUsageHistory();
      setCollectResult(result);
      setReloadToken((current) => current + 1);
    } catch (err) {
      setCollectError(extractApiError(err, ""));
    } finally {
      setCollectLoading(false);
    }
  }

  function handleTableSort(field: UsageHistorySortBy) {
    if (field === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("desc");
  }

  if (!generalSettings.usage_history_enabled) {
    return <FeatureDisabledPage feature={text("title")} />;
  }

  return (
    <PageShell actionPresentation="listing"
      title={text("title")}
      description={text("description")}
      breadcrumbs={adminPageBreadcrumbs("usage-history").map((breadcrumb) => ({
        ...breadcrumb,
        label: breadcrumb.label === WORKSPACE_CONTRACTS.admin.label
          ? text("admin")
          : breadcrumb.label === ADMIN_PAGE_CONTRACTS["usage-history"].label ? text("breadcrumb") : breadcrumb.label,
      }))}
      rightContent={
        <ListActionButton
          variant="primary"
          onClick={() => void handleCollect()}
          disabled={collectLoading}
          loading={collectLoading}
        >
          <RefreshIcon aria-hidden="true" className={cx("h-3.5 w-3.5", collectLoading && "animate-spin")} />
          {text(collectLoading ? "collecting" : "collectUsage")}
        </ListActionButton>
      }
    >

      {endpointsErrorMessage ? <PageBanner tone="warning">{endpointsErrorMessage}</PageBanner> : null}

      {collectSuccess ? <PageBanner tone="success">{collectSuccess}</PageBanner> : null}
      {collectWarning ? <PageBanner tone="warning">{collectWarning}</PageBanner> : null}
      {collectErrorMessage ? <PageBanner tone="error">{collectErrorMessage}</PageBanner> : null}
      {historyErrorMessage ? <PageBanner tone="error">{historyErrorMessage}</PageBanner> : null}

      <ListPageSection variant="page"
        title={text("snapshots")}
        mobileSort={<MobileTableSort options={sortOptions} field={sortBy} direction={sortDir} onFieldChange={setSortBy} onDirectionChange={setSortDir} labels={{ sortBy: text("sortBy"), direction: text("direction"), ascending: text("ascending"), descending: text("descending") }} />}
        countLabel={text(history?.total === 1 ? "recordCount" : "recordsCount", { count: history?.total ?? 0 })}
        filters={
          <>
            <UiSelect
              label={text("granularity")}
              title={text("granularityDescription")}
              value={granularity}
              onChange={(event) => setGranularity(event.target.value as UsageHistoryGranularity)}
              size="compact"
            >
              <option value="daily">{text("daily")}</option>
              <option value="hourly">{text("hourly")}</option>
            </UiSelect>
            <UiSelect
              label={text("endpoint")}
              value={selectedEndpointId ?? ""}
              onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={endpointsLoading}
              size="compact"
            >
              <option value="">{text(endpointsLoading ? "loading" : "allEndpoints")}</option>
              {endpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
                </option>
              ))}
            </UiSelect>
            <UiSelect
              label={text("subject")}
              value={subjectType}
              onChange={(event) => setSubjectType(event.target.value as UsageHistorySubjectType)}
              size="compact"
            >
              {subjectTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UiSelect>
            <UiInput
              label={text("start")}
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              size="compact"
            />
            <UiInput
              label={text("end")}
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              size="compact"
            />

          </>
        }
        actions={<ListActionButton variant="secondary" onClick={() => setReloadToken((current) => current + 1)} disabled={historyLoading}>{text("refresh")}</ListActionButton>}
        secondaryContent={
          <InlineSummary items={[
            { label: text("latestCollection"), value: historyLoading ? text("loading") : formatDateTime(history?.summary.latest_collected_at, locale) },
            { label: text("maxQuotaRatio"), value: historyLoading ? text("loading") : formatPercentage(history?.summary.max_usage_ratio_pct) },
          ]} />
        }
      >
        <DataTableShell
          columns={historyTableColumns(text, locale)}
          rows={history?.items ?? []}
          rowKey={(item) => `${item.granularity}-${item.id}`}
          status={tableStatus}
          loadingMessage={text("loadingHistory")}
          errorMessage={text("loadHistoryError")}
          emptyMessage={text("emptyHistory")}
          primaryColumnId="period"
          sort={{
            field: sortBy,
            direction: sortDir,
            onSort: handleTableSort,
          }}
          responsiveCards
          tableClassName="ui-data-table"
          rowClassName="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
        />
      </ListPageSection>
    </PageShell>
  );
}
