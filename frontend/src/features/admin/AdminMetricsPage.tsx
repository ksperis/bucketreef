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
import {
  AdminStats,
  AdminTrafficStats,
  TrafficWindow,
  fetchAdminStorage,
  fetchAdminTraffic,
} from "../../api/stats";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import {
  fetchAdminUsageHistoryTrends,
  type UsageHistoryTrendResponse,
  type UsageHistoryTrendWindow,
} from "../../api/usageHistory";
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

type AdminMetricsTab = "storage" | "usage-composition" | "usage-history" | "traffic";

export default function AdminMetricsPage() {
  const { text, translateText } = useAdminMetricsI18n();
  const { generalSettings } = useGeneralSettings();
  const [activeTab, setActiveTab] = useState<AdminMetricsTab>("storage");
  const [storage, setStorage] = useState<AdminStats | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageLoading, setStorageLoading] = useState<boolean>(true);

  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [endpointLoading, setEndpointLoading] = useState<boolean>(true);
  const [endpointError, setEndpointError] = useState<string | null>(null);

  const [traffic, setTraffic] = useState<AdminTrafficStats | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [trafficLoading, setTrafficLoading] = useState<boolean>(false);

  const [window, setWindow] = useState<TrafficWindow>("week");
  const [usageHistoryWindow, setUsageHistoryWindow] = useState<UsageHistoryTrendWindow>("month");
  const [usageHistoryTrends, setUsageHistoryTrends] = useState<UsageHistoryTrendResponse | null>(null);
  const [usageHistoryLoading, setUsageHistoryLoading] = useState<boolean>(false);
  const [usageHistoryError, setUsageHistoryError] = useState<string | null>(null);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRecalculating, setUsageStatsRecalculating] = useState(false);
  const usageStatsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      setEndpointLoading(true);
      setEndpointError(null);
      try {
        const data = await listStorageEndpoints();
        if (cancelled) {
          return;
        }
        const cephEndpoints = data.filter((endpoint) => endpoint.provider === "ceph");
        setEndpoints(cephEndpoints);
        if (cephEndpoints.length === 0) {
          setSelectedEndpointId(null);
          setEndpointError(adminMetricsSourceText("noEndpointError"));
        } else {
          const preferred = cephEndpoints.find((ep) => ep.is_default) || cephEndpoints[0];
          setSelectedEndpointId((current) => current ?? preferred.id);
        }
      } catch (err) {
        if (!cancelled) {
          setEndpoints([]);
          setSelectedEndpointId(null);
          setEndpointError(extractApiError(err, adminMetricsSourceText("loadEndpointsError")));
        }
      } finally {
        if (!cancelled) {
          setEndpointLoading(false);
        }
      }
    }
    loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStorage() {
      if (endpointLoading) {
        return;
      }
      if (selectedEndpointId == null) {
        setStorage(null);
        setStorageLoading(false);
        return;
      }
      setStorage(null);
      setStorageLoading(true);
      setStorageError(null);
      try {
        const data = await fetchAdminStorage(selectedEndpointId);
        if (!cancelled) {
          setStorage(data);
        }
      } catch (err) {
        if (!cancelled) {
          setStorageError(extractApiError(err, adminMetricsSourceText("loadStorageError")));
          setStorage(null);
        }
      } finally {
        if (!cancelled) {
          setStorageLoading(false);
        }
      }
    }
    loadStorage();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTraffic() {
      if (endpointLoading) {
        return;
      }
      if (selectedEndpointId == null) {
        setTraffic(null);
        setTrafficLoading(false);
        return;
      }
      setTraffic(null);
      setTrafficLoading(true);
      setTrafficError(null);
      try {
        const data = await fetchAdminTraffic(window, selectedEndpointId);
        if (!cancelled) {
          setTraffic(data);
        }
      } catch (err) {
        if (!cancelled) {
          setTrafficError(extractApiError(err, adminMetricsSourceText("loadTrafficError")));
          setTraffic(null);
        }
      } finally {
        if (!cancelled) {
          setTrafficLoading(false);
        }
      }
    }
    loadTraffic();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId, window]);

  useEffect(() => {
    let cancelled = false;
    async function loadUsageHistoryTrends() {
      if (!generalSettings.usage_history_enabled || endpointLoading) {
        setUsageHistoryTrends(null);
        setUsageHistoryLoading(false);
        setUsageHistoryError(null);
        return;
      }
      if (selectedEndpointId == null) {
        setUsageHistoryTrends(null);
        setUsageHistoryLoading(false);
        return;
      }
      setUsageHistoryTrends(null);
      setUsageHistoryLoading(true);
      setUsageHistoryError(null);
      try {
        const data = await fetchAdminUsageHistoryTrends({
          window: usageHistoryWindow,
          endpointId: selectedEndpointId,
          subjectType: "all",
        });
        if (!cancelled) {
          setUsageHistoryTrends(data);
        }
      } catch (err) {
        if (!cancelled) {
          setUsageHistoryTrends(null);
          setUsageHistoryError(extractApiError(err, adminMetricsSourceText("loadHistoryError")));
        }
      } finally {
        if (!cancelled) {
          setUsageHistoryLoading(false);
        }
      }
    }
    loadUsageHistoryTrends();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, generalSettings.usage_history_enabled, selectedEndpointId, usageHistoryWindow]);

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
        { id: "usage-composition" as const, label: text("usageComposition") },
        ...(showUsageHistoryTrends ? [{ id: "usage-history" as const, label: text("usageHistory") }] : []),
        { id: "traffic" as const, label: text("traffic") },
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
          primaryAction={{ label: text("openEndpoints"), to: "/admin/endpoints" }}
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
