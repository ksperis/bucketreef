/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getManagerUsageStatsAggregate,
  streamManagerUsageStatsAggregate,
  type BucketUsageStatsAggregate,
} from "../../api/bucketUsageStats";
import {
  fetchManagerUsageHistoryTrends,
  type UsageHistoryTrendResponse,
  type UsageHistoryTrendWindow,
} from "../../api/usageHistory";
import { getManagerCostMe, type CostSubjectDetail } from "../../api/cost";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import { MetricsSnapshotCard } from "../../components/MetricsTrafficOverview";
import PageShell from "../../components/PageShell";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import MetricsUnavailableCard from "../../components/MetricsUnavailableCard";
import PageEmptyState from "../../components/PageEmptyState";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import UiInput from "../../components/ui/UiInput";
import { extractApiError, isCancelledError } from "../../utils/apiError";
import { currentUtcMonthInputValue } from "../../utils/dateInputValues";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import TrafficAnalytics from "./TrafficAnalytics";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerStats } from "./useManagerStats";
import { useManagerI18n } from "./managerI18n";

type ManagerMetricsTab = "storage" | "usage-composition" | "usage-history" | "traffic" | "cost";

function formatCostCurrency(value: number | null | undefined, currency: string | null | undefined, locale: string): string {
  if (value == null || !currency) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export default function ManagerMetricsPage() {
  const { text, intlLocale } = useManagerI18n();
  const { generalSettings } = useGeneralSettings();
  const [activeTab, setActiveTab] = useState<ManagerMetricsTab>("storage");
  const [month, setMonth] = useState(currentUtcMonthInputValue());
  const [costDetail, setCostDetail] = useState<CostSubjectDetail | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);
  const {
    accounts,
    selectedContextId,
    hasS3AccountContext,
    requiresS3AccountSelection,
    contextIdForApi,
    accessMode,
    managerStatsEnabled,
    managerStatsMessage,
    managerFeatureStates,
  } = useS3AccountContext();

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedContextId),
    [accounts, selectedContextId]
  );
  const hasContext = hasS3AccountContext;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  const usageFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.metrics !== false : true);
  const metricsFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.usage !== false : true);
  const canLoadUsageStatsAggregate =
    hasContext &&
    Boolean(requiresS3AccountSelection) &&
    managerFeatureStates?.bucket_usage_stats?.enabled === true;
  const canShowCostEstimation =
    Boolean(generalSettings.cost_enabled) &&
    hasContext &&
    managerFeatureStates?.cost_estimation?.enabled === true;
  const canShowUsageBreakdowns = usageFeatureEnabled && hasContext;
  const showTrafficAnalytics = metricsFeatureEnabled && hasContext;
  const showMetricsDisabledBanner = hasContext && !usageFeatureEnabled && !metricsFeatureEnabled;
  const showUsageDisabledBanner = hasContext && managerStatsEnabled && !usageFeatureEnabled && metricsFeatureEnabled;
  const showTrafficDisabledBanner = hasContext && managerStatsEnabled && usageFeatureEnabled && !metricsFeatureEnabled;
  const managerMetricsMessage =
    hasContext && !managerStatsEnabled
      ? managerStatsMessage || text("Metrics are unavailable for this context.")
      : null;

  const { stats, loading, error } = useManagerStats(
    contextIdForApi,
    canShowUsageBreakdowns,
    accessMode ?? "default"
  );
  const [usageHistoryWindow, setUsageHistoryWindow] = useState<UsageHistoryTrendWindow>("month");
  const [usageHistoryTrends, setUsageHistoryTrends] = useState<UsageHistoryTrendResponse | null>(null);
  const [usageHistoryLoading, setUsageHistoryLoading] = useState(false);
  const [usageHistoryError, setUsageHistoryError] = useState<string | null>(null);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRecalculating, setUsageStatsRecalculating] = useState(false);
  const usageStatsAbortRef = useRef<AbortController | null>(null);
  const showUsageBreakdowns = canShowUsageBreakdowns && !error;
  const showUsageHistoryTrends =
    Boolean(generalSettings.usage_history_enabled) &&
    hasContext &&
    !managerMetricsMessage &&
    !showMetricsDisabledBanner;
  const showFullPageMetricsUnavailable =
    Boolean(managerMetricsMessage) &&
    !showUsageBreakdowns &&
    !showTrafficAnalytics &&
    !canLoadUsageStatsAggregate &&
    !canShowCostEstimation;
  const showFullPageMetricsDisabled = showMetricsDisabledBanner && !canLoadUsageStatsAggregate && !canShowCostEstimation;

  useEffect(() => {
    if (!canShowCostEstimation || !month) {
      setCostDetail(null);
      setCostLoading(false);
      setCostError(null);
      return;
    }
    let cancelled = false;
    setCostLoading(true);
    setCostError(null);
    getManagerCostMe(month, contextIdForApi)
      .then((data) => {
        if (!cancelled) setCostDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setCostDetail(null);
          setCostError(extractApiError(err, text("Unable to load cost estimate.")));
        }
      })
      .finally(() => {
        if (!cancelled) setCostLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contextIdForApi, canShowCostEstimation, month, text]);

  const loadUsageStatsAggregate = useCallback(async () => {
    if (!canLoadUsageStatsAggregate) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return;
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const data = await getManagerUsageStatsAggregate(contextIdForApi);
      setUsageStatsAggregate(data.aggregate);
    } catch (err) {
      setUsageStatsAggregate(null);
      setUsageStatsError(extractApiError(err, text("Unable to load usage composition.")));
    } finally {
      setUsageStatsLoading(false);
    }
  }, [contextIdForApi, canLoadUsageStatsAggregate, text]);

  useEffect(() => {
    void loadUsageStatsAggregate();
  }, [loadUsageStatsAggregate]);

  const handleRecalculateUsageStats = useCallback(async () => {
    if (!canLoadUsageStatsAggregate || usageStatsRecalculating) return;
    const controller = new AbortController();
    usageStatsAbortRef.current = controller;
    setUsageStatsRecalculating(true);
    setUsageStatsError(null);
    try {
      await streamManagerUsageStatsAggregate(
        contextIdForApi,
        { parallelism: 8 },
        { signal: controller.signal },
      );
      await loadUsageStatsAggregate();
    } catch (err) {
      if (!isCancelledError(err)) {
        setUsageStatsError(extractApiError(err, text("Unable to recalculate usage composition.")));
      }
    } finally {
      if (usageStatsAbortRef.current === controller) {
        usageStatsAbortRef.current = null;
        setUsageStatsRecalculating(false);
      }
    }
  }, [contextIdForApi, canLoadUsageStatsAggregate, loadUsageStatsAggregate, text, usageStatsRecalculating]);

  const handleCancelUsageStats = useCallback(() => {
    usageStatsAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      usageStatsAbortRef.current?.abort();
    };
  }, [contextIdForApi, canLoadUsageStatsAggregate]);

  useEffect(() => {
    if (!showUsageHistoryTrends) {
      setUsageHistoryTrends(null);
      setUsageHistoryLoading(false);
      setUsageHistoryError(null);
      return;
    }
    let cancelled = false;
    setUsageHistoryLoading(true);
    setUsageHistoryError(null);
    fetchManagerUsageHistoryTrends(contextIdForApi, usageHistoryWindow)
      .then((data) => {
        if (!cancelled) setUsageHistoryTrends(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageHistoryTrends(null);
          setUsageHistoryError(extractApiError(err, text("Unable to load usage history trends.")));
        }
      })
      .finally(() => {
        if (!cancelled) setUsageHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contextIdForApi, showUsageHistoryTrends, text, usageHistoryWindow]);

  const usageStatsAggregateSection = canLoadUsageStatsAggregate ? (
    <BucketUsageStatsAggregateCard
      title={text("Account usage composition")}
      description={text("Latest calculated bucket snapshots for the active account context.")}
      aggregate={usageStatsAggregate}
      loading={usageStatsLoading}
      error={usageStatsError}
      recalculating={usageStatsRecalculating}
      recalculateLabel={text("Recalculate account")}
      text={text}
      onCancel={handleCancelUsageStats}
      onRecalculate={handleRecalculateUsageStats}
    />
  ) : null;
  const metricsTabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: text("Storage") },
        ...(canLoadUsageStatsAggregate ? [{ id: "usage-composition" as const, label: text("Usage composition") }] : []),
        ...(showUsageHistoryTrends ? [{ id: "usage-history" as const, label: text("Usage history") }] : []),
        { id: "traffic" as const, label: text("Traffic") },
        ...(canShowCostEstimation ? [{ id: "cost" as const, label: text("Costs") }] : []),
      ],
    [canLoadUsageStatsAggregate, canShowCostEstimation, showUsageHistoryTrends, text]
  );

  useEffect(() => {
    if (!metricsTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(metricsTabs[0]?.id ?? "storage");
    }
  }, [activeTab, metricsTabs]);

  return (
    <PageShell
      title={text("Usage & Metrics")}
      description={text("Logical usage composition, storage analytics, and traffic analytics for the active execution context.")}
      breadcrumbs={managerPageBreadcrumbs(text, "metrics")}
    >
      {!hasContext ? (
        <PageEmptyState
          title={text("Select an account to view usage and metrics")}
          description={text("Usage composition and Manager metrics depend on an execution context. Choose an account to load bucket usage, storage, and traffic analytics.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : showFullPageMetricsUnavailable ? (
        <PageEmptyState
          title={text("Metrics are unavailable for this context")}
          description={managerMetricsMessage ?? "Metrics are unavailable for this context."}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : showFullPageMetricsDisabled ? (
        <PageEmptyState
          title={text("Metrics are disabled for this endpoint")}
          description={text("Neither storage analytics nor traffic analytics are enabled on the selected endpoint.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <>
          <PageTabs
            tabs={metricsTabs}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as ManagerMetricsTab)}
            variant="line"
            ariaLabel={text("Manager metrics sections")}
            idPrefix="manager-metrics"
          />

          <PageTabPanel idPrefix="manager-metrics" tabId={activeTab} className="space-y-4 pt-4">
          {activeTab === "storage" ? (
            <>
              {managerMetricsMessage && !showUsageBreakdowns && (
                <MetricsUnavailableCard
                  eyebrow={text("Metrics")}
                  title={text("Storage analytics")}
                  description={text("Bucket volume and object counts for the active context.")}
                  message={managerMetricsMessage}
                  tone="warning"
                />
              )}
              {!managerMetricsMessage && showMetricsDisabledBanner && (
                <MetricsUnavailableCard
                  eyebrow="Metrics"
                  title={text("Storage analytics")}
                  description={text("Bucket volume and object counts for the active context.")}
                  message={text("Neither storage analytics nor traffic analytics are enabled on the selected endpoint.")}
                  tone="warning"
                />
              )}
              {!managerMetricsMessage && !showMetricsDisabledBanner && showUsageDisabledBanner && (
                <MetricsUnavailableCard
                  title={text("Storage analytics")}
                  description={text("Bucket volume and object counts for the active context.")}
                  message={text("Storage analytics are disabled for this endpoint.")}
                />
              )}
              {!managerMetricsMessage && !showMetricsDisabledBanner && error && (
                <MetricsUnavailableCard
                  title={text("Storage analytics")}
                  description={text("Bucket volume and object counts for the active context.")}
                  message={error}
                  tone="error"
                />
              )}
              {!managerMetricsMessage && !showMetricsDisabledBanner && showUsageBreakdowns && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <UsageBreakdown
                    title={text("Bucket breakdown (storage)")}
                    loading={loading}
                    metric="bytes"
                    items={(stats?.bucket_usage ?? []).map((bucket) => ({
                      id: bucket.name,
                      label: bucket.name,
                      usedBytes: bucket.used_bytes ?? null,
                      objectCount: bucket.object_count ?? null,
                    }))}
                    emptyMessage={text("No bucket storage metrics available.")}
                    objectUnitLabel={text("objects")}
                    othersLabel={text("Others")}
                    totalLabel={text("Total")}
                  />
                  <UsageBreakdown
                    title={text("Bucket breakdown (objects)")}
                    loading={loading}
                    metric="objects"
                    items={(stats?.bucket_usage ?? []).map((bucket) => ({
                      id: bucket.name,
                      label: bucket.name,
                      usedBytes: bucket.used_bytes ?? null,
                      objectCount: bucket.object_count ?? null,
                    }))}
                    emptyMessage={text("No bucket object metrics available.")}
                    objectUnitLabel={text("objects")}
                    othersLabel={text("Others")}
                    totalLabel={text("Total")}
                  />
                </div>
              )}
            </>
          ) : null}

          {activeTab === "usage-composition" && canLoadUsageStatsAggregate ? usageStatsAggregateSection : null}

          {activeTab === "usage-history" && showUsageHistoryTrends && (
            <UsageHistoryTrendsSection
              trends={usageHistoryTrends}
              window={usageHistoryWindow}
              onWindowChange={setUsageHistoryWindow}
              loading={usageHistoryLoading}
              error={usageHistoryError}
              description={text("Stored usage snapshots for the active execution context.")}
              text={text}
            />
          )}

          {activeTab === "traffic" && managerMetricsMessage && !showTrafficAnalytics ? (
            <MetricsUnavailableCard
              eyebrow={text("Metrics")}
              title={text("Traffic")}
              description={text("Ingress/egress volume, request types, and busiest buckets.")}
              message={managerMetricsMessage}
              tone="warning"
            />
          ) : null}
          {activeTab === "traffic" && !managerMetricsMessage && showMetricsDisabledBanner ? (
            <MetricsUnavailableCard
              eyebrow={text("Metrics")}
              title={text("Traffic")}
              description={text("Ingress/egress volume, request types, and busiest buckets.")}
              message={text("Neither storage analytics nor traffic analytics are enabled on the selected endpoint.")}
              tone="warning"
            />
          ) : null}
          {activeTab === "traffic" && !managerMetricsMessage && !showMetricsDisabledBanner && showTrafficDisabledBanner ? (
            <MetricsUnavailableCard
              title={text("Traffic")}
              description={text("Ingress/egress volume, request types, and busiest buckets.")}
              message={text("Traffic analytics are disabled for this endpoint.")}
            />
          ) : null}
          {showTrafficAnalytics && (
            <TrafficAnalytics
              accountId={contextIdForApi}
              enabled={showTrafficAnalytics}
              visible={activeTab === "traffic"}
            />
          )}
          {activeTab === "cost" && canShowCostEstimation ? (
            <MetricsCard
              title={text("Monthly cost")}
              description={text("Estimated storage, transfer, and request cost for the selected month.")}
              actions={
                <UiInput
                  type="month"
                  aria-label={text("Cost month")}
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="w-40"
                />
              }
            >
              {costLoading && !costDetail ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricsSnapshotCard label={text("Estimated cost")} value="—" loading />
                  <MetricsSnapshotCard label={text("Average storage")} value="—" loading />
                  <MetricsSnapshotCard label={text("Requests")} value="—" loading />
                  <MetricsSnapshotCard label={text("Coverage")} value="—" loading />
                </div>
              ) : costDetail ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricsSnapshotCard
                    label={text("Estimated cost")}
                    value={formatCostCurrency(costDetail.cost?.total_cost, costDetail.cost?.currency, intlLocale)}
                    hint={costDetail.cost?.currency ?? text("Cost model not configured")}
                    loading={costLoading}
                  />
                  <MetricsSnapshotCard
                    label={text("Average storage")}
                    value={formatBytes(costDetail.storage.avg_bytes)}
                    hint={text("{count} objects", { count: formatCompactNumber(costDetail.storage.total_objects) })}
                    loading={costLoading}
                  />
                  <MetricsSnapshotCard
                    label={text("Requests")}
                    value={formatCompactNumber(costDetail.usage.ops_total)}
                    hint={text("{downloaded} downloaded, {uploaded} uploaded", {
                      downloaded: formatBytes(costDetail.usage.bytes_out),
                      uploaded: formatBytes(costDetail.usage.bytes_in),
                    })}
                    loading={costLoading}
                  />
                  <MetricsSnapshotCard
                    label={text("Coverage")}
                    value={text("{collected}/{total} days", {
                      collected: costDetail.coverage.days_collected,
                      total: costDetail.coverage.days_in_month,
                    })}
                    hint={formatPercentage(costDetail.coverage.coverage_ratio * 100)}
                    loading={costLoading}
                  />
                </div>
              ) : (
                <MetricsEmptyState>{costError ?? text("No cost data available.")}</MetricsEmptyState>
              )}
            </MetricsCard>
          ) : null}
          </PageTabPanel>
        </>
      )}
    </PageShell>
  );
}
