/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAdminUsageStatsAggregate,
  streamAdminUsageStatsAggregate,
  type BucketUsageStatsAggregate,
} from "../../api/bucketUsageStats";
import type { TrafficWindow } from "../../api/stats";
import type { UsageHistoryTrendWindow } from "../../api/usageHistory";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { MetricsCard } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard, MetricsSummaryCard } from "../../components/MetricsTrafficOverview";
import MetricsUnavailableCard from "../../components/MetricsUnavailableCard";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import UiSelect from "../../components/ui/UiSelect";
import { extractApiError, isCancelledError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import { adminMetricsSourceText, useAdminMetricsI18n } from "./adminMetricsMessage";
import { useAdminMetricsResources } from "./useAdminMetricsResources";

type AdminMetricsTab = "storage" | "usage-composition" | "usage-history" | "traffic";

export default function AdminMetricsPage() {
  const { text, translateText } = useAdminMetricsI18n();
  const { generalSettings } = useGeneralSettings();
  const [activeTab, setActiveTab] = useState<AdminMetricsTab>("storage");
  const [window, setWindow] = useState<TrafficWindow>("week");
  const [usageHistoryWindow, setUsageHistoryWindow] = useState<UsageHistoryTrendWindow>("month");
  const {
    storage,
    storageError,
    storageLoading,
    endpoints,
    selectedEndpointId,
    setSelectedEndpointId,
    endpointLoading,
    endpointError,
    traffic,
    trafficError,
    trafficLoading,
    usageHistoryTrends,
    usageHistoryLoading,
    usageHistoryError,
  } = useAdminMetricsResources({
    usageHistoryEnabled: generalSettings.usage_history_enabled,
    trafficWindow: window,
    usageHistoryWindow,
  });
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRecalculating, setUsageStatsRecalculating] = useState(false);
  const usageStatsAbortRef = useRef<AbortController | null>(null);

  const loadUsageStatsAggregate = useCallback(async () => {
    if (endpointLoading || selectedEndpointId == null) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return;
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const data = await getAdminUsageStatsAggregate(selectedEndpointId);
      setUsageStatsAggregate(data.aggregate);
    } catch (err) {
      setUsageStatsAggregate(null);
      setUsageStatsError(extractApiError(err, adminMetricsSourceText("loadCompositionError")));
    } finally {
      setUsageStatsLoading(false);
    }
  }, [endpointLoading, selectedEndpointId]);

  useEffect(() => {
    void loadUsageStatsAggregate();
  }, [loadUsageStatsAggregate]);

  const handleRecalculateUsageStats = useCallback(async () => {
    if (selectedEndpointId == null || usageStatsRecalculating) return;
    const controller = new AbortController();
    usageStatsAbortRef.current = controller;
    setUsageStatsRecalculating(true);
    setUsageStatsError(null);
    try {
      await streamAdminUsageStatsAggregate(
        selectedEndpointId,
        { parallelism: 8 },
        { signal: controller.signal },
      );
      await loadUsageStatsAggregate();
    } catch (err) {
      if (!isCancelledError(err)) {
        setUsageStatsError(extractApiError(err, adminMetricsSourceText("recalculateCompositionError")));
      }
    } finally {
      if (usageStatsAbortRef.current === controller) {
        usageStatsAbortRef.current = null;
        setUsageStatsRecalculating(false);
      }
    }
  }, [loadUsageStatsAggregate, selectedEndpointId, usageStatsRecalculating]);

  const handleCancelUsageStats = useCallback(() => {
    usageStatsAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      usageStatsAbortRef.current?.abort();
    };
  }, [selectedEndpointId]);

  const storageTotals = storage?.storage_totals;
  const accountUsageItems = useMemo(
    () =>
      (storage?.account_usage ?? []).map((account) => ({
        id: account.account_id,
        label: account.account_name || account.account_id,
        usedBytes: account.used_bytes ?? null,
        objectCount: account.object_count ?? null,
      })),
    [storage?.account_usage]
  );

  const userUsageItems = useMemo(
    () =>
      (storage?.s3_user_usage ?? []).map((user) => ({
        id: user.rgw_user_uid || `s3-user-${user.user_id}`,
        label: user.user_name || user.rgw_user_uid || text("userFallback", { id: user.user_id }),
        usedBytes: user.used_bytes ?? null,
        objectCount: user.object_count ?? null,
      })),
    [storage?.s3_user_usage, text]
  );

  const missingTraffic = selectedEndpointId != null && !traffic && !trafficLoading && !trafficError;
  const showStorageMetrics = !storageError;
  const showUsageHistoryTrends = Boolean(generalSettings.usage_history_enabled) && selectedEndpointId != null;
  const metricsTabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: text("storage") },
        ...(showUsageHistoryTrends ? [{ id: "usage-history" as const, label: text("usageHistory") }] : []),
        { id: "traffic" as const, label: text("traffic") },
        { id: "usage-composition" as const, label: text("usageComposition") },
      ],
    [showUsageHistoryTrends, text]
  );
  const usageStatsAggregateSection = (
    <BucketUsageStatsAggregateCard
      title={text("managedAccountsComposition")}
      description={text("managedAccountsDescription")}
      aggregate={usageStatsAggregate}
      loading={usageStatsLoading}
      error={usageStatsError ? translateText(usageStatsError) : null}
      recalculating={usageStatsRecalculating}
      recalculateLabel={text("recalculateEndpoint")}
      onCancel={handleCancelUsageStats}
      onRecalculate={handleRecalculateUsageStats}
    />
  );

  useEffect(() => {
    if (!metricsTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(metricsTabs[0]?.id ?? "storage");
    }
  }, [activeTab, metricsTabs]);

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      <PageHeader
        title={text("title")}
        description={text("description")}
        breadcrumbs={adminPageBreadcrumbs("metrics").map((breadcrumb) => ({
          ...breadcrumb,
          label: breadcrumb.to === "/admin" ? text("admin") : text("title"),
        }))}
        rightContent={            <UiSelect
              label={text("endpoint")}
              value={selectedEndpointId ?? ""}
              onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={endpointLoading || endpoints.length === 0}
              fieldClassName="max-w-full sm:w-64"
              className="ui-list-control"
              size="compact"
            >
              {endpointLoading && <option value="">{text("loading")}</option>}
              {!endpointLoading && endpoints.length === 0 && <option value="">{text("noEndpoint")}</option>}
              {!endpointLoading &&
                endpoints.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id} title={endpoint.endpoint_url}>
                    {endpoint.is_default ? text("defaultEndpoint", { name: endpoint.name }) : endpoint.name}
                  </option>
                ))}
            </UiSelect>}
      />

      {!endpointLoading && selectedEndpointId == null ? (
        <PageEmptyState
          title={text("noEndpointTitle")}
          description={endpointError ? translateText(endpointError) : text("noEndpointDescription")}
          primaryAction={{ label: text("openEndpoints"), to: "/admin/storage-endpoints" }}
          tone="warning"
        />
      ) : null}

      {selectedEndpointId != null && (
        <>
          <PageTabs
            tabs={metricsTabs}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as AdminMetricsTab)}
            variant="line"
            ariaLabel={text("sections")}
            idPrefix="admin-metrics"
          />

          <PageTabPanel idPrefix="admin-metrics" tabId={activeTab} className="space-y-4 pt-4">
          {activeTab === "storage" ? (
            storageError ? (
              <MetricsUnavailableCard
                title={text("storageSnapshot")}
                description={text("storageSnapshotDescription")}
                message={translateText(storageError)}
                tone="warning"
              />
            ) : (
              <>
                <MetricsSummaryCard
                  title={text("storageSnapshot")}
                  description={text("storageSnapshotDescription")}
                  updatedAt={storage?.generated_at}
                >
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricsSnapshotCard
                      label={text("storedVolume")}
                      value={storageTotals?.used_bytes != null ? formatBytes(storageTotals.used_bytes) : "—"}
                      hint={text("knownBuckets")}
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label={text("objects")}
                      value={storageTotals?.object_count != null ? formatCompactNumber(storageTotals.object_count) : "—"}
                      hint={text("instantCount")}
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label={text("visibleBuckets")}
                      value={storageTotals?.bucket_count != null ? formatCompactNumber(storageTotals.bucket_count) : "—"}
                      hint={text("rootCredentials")}
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label={text("s3Accounts")}
                      value={storage ? formatCompactNumber(storage.total_accounts) : "—"}
                      hint={text("s3UsersCount", { count: formatCompactNumber(storage?.total_s3_users ?? 0) })}
                      loading={storageLoading}
                    />
                  </div>
                </MetricsSummaryCard>

                {showStorageMetrics && (
                  <MetricsCard
                    title={text("storageBreakdown")}
                    description={text("storageBreakdownDescription")}
                  >
                    <div className="grid gap-6 xl:grid-cols-2">
                      <UsageBreakdown
                        title={text("accountsVolume")}
                        loading={storageLoading}
                        metric="bytes"
                        items={accountUsageItems}
                        emptyMessage={text("noVolume")}
                        objectUnitLabel={text("objectUnit")}
                        othersLabel={text("others")}
                        totalLabel={text("total")}
                      />
                      <UsageBreakdown
                        title={text("accountsObjects")}
                        loading={storageLoading}
                        metric="objects"
                        items={accountUsageItems}
                        emptyMessage={text("noObjects")}
                        objectUnitLabel={text("objectUnit")}
                        othersLabel={text("others")}
                        totalLabel={text("total")}
                      />
                    </div>
                    <div className="grid gap-6 xl:grid-cols-2">
                      <UsageBreakdown
                        title={text("usersVolume")}
                        loading={storageLoading}
                        metric="bytes"
                        items={userUsageItems}
                        emptyMessage={text("noUserMetrics")}
                        objectUnitLabel={text("objectUnit")}
                        othersLabel={text("others")}
                        totalLabel={text("total")}
                      />
                      <UsageBreakdown
                        title={text("usersObjects")}
                        loading={storageLoading}
                        metric="objects"
                        items={userUsageItems}
                        emptyMessage={text("noUserMetrics")}
                        objectUnitLabel={text("objectUnit")}
                        othersLabel={text("others")}
                        totalLabel={text("total")}
                      />
                    </div>
                  </MetricsCard>
                )}
              </>
            )
          ) : null}

          {activeTab === "usage-composition" ? usageStatsAggregateSection : null}

          {activeTab === "usage-history" && showUsageHistoryTrends && (
            <UsageHistoryTrendsSection
              trends={usageHistoryTrends}
              window={usageHistoryWindow}
              onWindowChange={setUsageHistoryWindow}
              loading={usageHistoryLoading}
              error={usageHistoryError ? translateText(usageHistoryError) : null}
              description={text("historyDescription")}
              text={translateText}
            />
          )}

          {activeTab === "traffic" ? (
            <MetricsTrafficOverview
              traffic={traffic}
              window={window}
              onWindowChange={setWindow}
              loading={trafficLoading}
              error={trafficError ? translateText(trafficError) : null}
              showEmpty={missingTraffic}
            />
          ) : null}
          </PageTabPanel>
        </>
      )}
    </div>
  );
}
