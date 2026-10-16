/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCephAdminUsageStatsAggregate,
  streamCephAdminUsageStatsAggregate,
  type BucketUsageStatsAggregate,
} from "../../api/bucketUsageStats";
import {
  fetchCephAdminClusterStorage,
  fetchCephAdminClusterTraffic,
  type CephAdminClusterStorageMetrics,
  type CephAdminClusterTrafficMetrics,
} from "../../api/cephAdminMetrics";
import { TrafficWindow } from "../../api/stats";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { MetricsCard } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard, MetricsSummaryCard } from "../../components/MetricsTrafficOverview";
import MetricsUnavailableCard from "../../components/MetricsUnavailableCard";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import UsageBreakdown from "../../components/UsageBreakdown";
import { extractApiError, isCancelledError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import { useCephAdminI18n } from "./cephAdminI18n";

type CephAdminMetricsTab = "storage" | "usage-composition" | "traffic";

export default function CephAdminMetricsPage() {
  const { text: surfaceText } = useCephAdminI18n();
  const {
    selectedEndpointId,
    selectedEndpoint,
    selectedEndpointAccess,
    selectedEndpointAccessLoading,
    loading: endpointLoading,
  } = useCephAdminEndpoint();
  const [activeTab, setActiveTab] = useState<CephAdminMetricsTab>("storage");
  const [storage, setStorage] = useState<CephAdminClusterStorageMetrics | null>(null);
  const [storageLoading, setStorageLoading] = useState<boolean>(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [traffic, setTraffic] = useState<CephAdminClusterTrafficMetrics | null>(null);
  const [trafficLoading, setTrafficLoading] = useState<boolean>(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRecalculating, setUsageStatsRecalculating] = useState(false);
  const [usageStatsConfirmOpen, setUsageStatsConfirmOpen] = useState(false);
  const usageStatsAbortRef = useRef<AbortController | null>(null);

  const [window, setWindow] = useState<TrafficWindow>("week");
  const metricsCredentialsReady = !selectedEndpointAccessLoading && Boolean(selectedEndpointAccess?.can_metrics);
  const usageStatsAccessReady = !selectedEndpointAccessLoading && Boolean(selectedEndpointAccess?.can_admin);
  const storageFeatureEnabled = selectedEndpoint?.capabilities?.metrics !== false;
  const usageLogFeatureEnabled = selectedEndpoint?.capabilities?.usage !== false;
  const canLoadStorage = selectedEndpointId != null && metricsCredentialsReady && storageFeatureEnabled;
  const canLoadTraffic = selectedEndpointId != null && metricsCredentialsReady && usageLogFeatureEnabled;
  const canLoadUsageStatsAggregate = selectedEndpointId != null && usageStatsAccessReady;

  const loadUsageStatsAggregate = useCallback(async () => {
    const endpointId = selectedEndpointId;
    if (!canLoadUsageStatsAggregate || endpointId == null) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return;
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const data = await getCephAdminUsageStatsAggregate(endpointId);
      setUsageStatsAggregate(data.aggregate);
    } catch (err) {
      setUsageStatsAggregate(null);
      setUsageStatsError(extractApiError(err, "Unable to load cluster usage composition."));
    } finally {
      setUsageStatsLoading(false);
    }
  }, [canLoadUsageStatsAggregate, selectedEndpointId]);

  useEffect(() => {
    void loadUsageStatsAggregate();
  }, [loadUsageStatsAggregate]);

  const runUsageStatsRecalculation = useCallback(async () => {
    const endpointId = selectedEndpointId;
    if (!canLoadUsageStatsAggregate || endpointId == null || usageStatsRecalculating) return;
    const controller = new AbortController();
    usageStatsAbortRef.current = controller;
    setUsageStatsRecalculating(true);
    setUsageStatsError(null);
    try {
      await streamCephAdminUsageStatsAggregate(
        endpointId,
        { parallelism: 8 },
        { signal: controller.signal },
      );
      await loadUsageStatsAggregate();
    } catch (err) {
      if (!isCancelledError(err)) {
        setUsageStatsError(extractApiError(err, "Unable to recalculate cluster usage composition."));
      }
    } finally {
      if (usageStatsAbortRef.current === controller) {
        usageStatsAbortRef.current = null;
        setUsageStatsRecalculating(false);
      }
    }
  }, [canLoadUsageStatsAggregate, loadUsageStatsAggregate, selectedEndpointId, usageStatsRecalculating]);

  const handleCancelUsageStats = useCallback(() => {
    usageStatsAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      usageStatsAbortRef.current?.abort();
    };
  }, [canLoadUsageStatsAggregate, selectedEndpointId]);

  const handleRecalculateUsageStats = useCallback(() => {
    if (!canLoadUsageStatsAggregate || selectedEndpointId == null) return;
    setUsageStatsConfirmOpen(true);
  }, [canLoadUsageStatsAggregate, selectedEndpointId]);

  const handleConfirmRecalculateUsageStats = useCallback(() => {
    setUsageStatsConfirmOpen(false);
    void runUsageStatsRecalculation();
  }, [runUsageStatsRecalculation]);

  useEffect(() => {
    let cancelled = false;
    async function loadStorage() {
      if (endpointLoading || selectedEndpointAccessLoading) {
        return;
      }
      const endpointId = selectedEndpointId;
      if (!canLoadStorage || endpointId == null) {
        setStorage(null);
        setStorageLoading(false);
        return;
      }
      setStorage(null);
      setStorageLoading(true);
      setStorageError(null);
      try {
        const payload = await fetchCephAdminClusterStorage(endpointId);
        if (!cancelled) {
          setStorage(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setStorage(null);
          setStorageError(extractApiError(err, "Unable to load cluster storage metrics."));
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
  }, [canLoadStorage, endpointLoading, selectedEndpointAccessLoading, selectedEndpointId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTraffic() {
      if (endpointLoading || selectedEndpointAccessLoading) {
        return;
      }
      const endpointId = selectedEndpointId;
      if (!canLoadTraffic || endpointId == null) {
        setTraffic(null);
        setTrafficLoading(false);
        return;
      }
      setTraffic(null);
      setTrafficLoading(true);
      setTrafficError(null);
      try {
        const payload = await fetchCephAdminClusterTraffic(endpointId, window);
        if (!cancelled) {
          setTraffic(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setTraffic(null);
          setTrafficError(extractApiError(err, "Unable to retrieve RGW logs."));
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
  }, [canLoadTraffic, endpointLoading, selectedEndpointAccessLoading, selectedEndpointId, window]);

  const storageTotals = storage?.storage_totals;
  const ownerUsageItems = useMemo(
    () =>
      (storage?.owner_usage ?? []).map((entry) => ({
        id: entry.owner,
        label: entry.owner,
        usedBytes: entry.used_bytes ?? null,
        objectCount: entry.object_count ?? null,
      })),
    [storage?.owner_usage]
  );
  const bucketUsageItems = useMemo(
    () =>
      (storage?.bucket_usage ?? []).map((entry) => ({
        id: entry.name,
        label: entry.name,
        usedBytes: entry.used_bytes ?? null,
        objectCount: entry.object_count ?? null,
      })),
    [storage?.bucket_usage]
  );

  const endpointRequired = !endpointLoading && selectedEndpointId == null;
  const metricsUnavailableError =
    !endpointLoading && !selectedEndpointAccessLoading && selectedEndpointId != null && !metricsCredentialsReady
      ? "Supervision credentials are not configured for this endpoint."
      : null;
  const storageDisabledMessage =
    selectedEndpointId != null && metricsCredentialsReady && !storageFeatureEnabled
      ? "Storage metrics are disabled for this endpoint."
      : null;
  const trafficDisabledMessage =
    selectedEndpointId != null && metricsCredentialsReady && !usageLogFeatureEnabled
      ? "Usage logs are disabled for this endpoint."
      : null;
  const noMetricsSurfaceAvailable =
    selectedEndpointId != null && metricsCredentialsReady && !storageFeatureEnabled && !usageLogFeatureEnabled;
  const missingTraffic = canLoadTraffic && !traffic && !trafficLoading && !trafficError;
  const usageStatsAggregateSection = canLoadUsageStatsAggregate ? (
    <BucketUsageStatsAggregateCard
      title={surfaceText("Cluster usage composition")}
      description={surfaceText("Latest calculated bucket snapshots for the selected Ceph endpoint.")}
      aggregate={usageStatsAggregate}
      loading={usageStatsLoading}
      error={usageStatsError}
      recalculating={usageStatsRecalculating}
      recalculateLabel={surfaceText("Recalculate cluster")}
      onCancel={handleCancelUsageStats}
      onRecalculate={handleRecalculateUsageStats}
    />
  ) : null;
  const metricsTabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: surfaceText("Storage") },
        ...(canLoadUsageStatsAggregate ? [{ id: "usage-composition" as const, label: surfaceText("Usage composition") }] : []),
        { id: "traffic" as const, label: surfaceText("Traffic") },
      ],
    [canLoadUsageStatsAggregate, surfaceText]
  );

  useEffect(() => {
    if (!metricsTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(metricsTabs[0]?.id ?? "storage");
    }
  }, [activeTab, metricsTabs]);

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      <PageHeader
        title={surfaceText("Usage & Metrics")}
        description={surfaceText("Latest calculated logical usage composition plus cluster-wide Ceph RGW storage and traffic metrics.")}
        breadcrumbs={cephAdminPageBreadcrumbs("metrics")}
      />

      {endpointRequired ? (
        <PageEmptyState
          title={surfaceText("Select a Ceph endpoint before opening usage and metrics")}
          description={surfaceText("Cluster usage composition and metrics are endpoint-scoped. Choose an endpoint to load usage snapshots, storage metrics, traffic analytics, and owner breakdowns.")}
          primaryAction={{ label: surfaceText("Return to Ceph Admin"), to: "/ceph-admin" }}
          tone="warning"
        />
      ) : metricsUnavailableError && !canLoadUsageStatsAggregate ? (
        <PageEmptyState
          title={surfaceText("Metrics credentials are not configured for this endpoint")}
          description={surfaceText("This endpoint does not currently expose Ceph admin metrics. Configure supervision credentials before opening storage and traffic analytics.")}
          primaryAction={{ label: surfaceText("Return to Ceph Admin"), to: "/ceph-admin" }}
          tone="warning"
        />
      ) : noMetricsSurfaceAvailable && !canLoadUsageStatsAggregate ? (
        <PageEmptyState
          title={surfaceText("Metrics are disabled for this endpoint")}
          description={surfaceText("Both storage metrics and usage logs are disabled for the selected endpoint. Enable at least one capability to restore analytics on this page.")}
          primaryAction={{ label: surfaceText("Return to Ceph Admin"), to: "/ceph-admin" }}
          tone="warning"
        />
      ) : (
        <>
          {usageStatsConfirmOpen && (
            <ConfirmActionDialog
              title={surfaceText("Recalculate cluster usage composition")}
              description={surfaceText("This operation can be costly because it lists object versions across every bucket on the selected Ceph endpoint.")}
              confirmLabel={surfaceText("Start recalculation")}
              cancelLabel={surfaceText("Cancel")}
              tone="primary"
              onCancel={() => setUsageStatsConfirmOpen(false)}
              onConfirm={handleConfirmRecalculateUsageStats}
              details={[
                { label: surfaceText("Endpoint"), value: selectedEndpoint?.name ?? `${surfaceText("Endpoint")} ${selectedEndpointId}` },
                {
                  label: surfaceText("Buckets"),
                  value:
                    usageStatsAggregate?.bucket_count != null
                      ? surfaceText(
                          usageStatsAggregate.bucket_count === 1 ? "{count} bucket" : "{count} buckets",
                          { count: usageStatsAggregate.bucket_count },
                        )
                      : surfaceText("Unknown"),
                },
              ]}
              impacts={[
                surfaceText("The calculation may generate significant RGW listing traffic on large or heavily versioned buckets."),
                surfaceText("If the calculation fails, the latest successful snapshot remains visible."),
              ]}
              warning={surfaceText("Start this only when a fresh cluster-wide logical usage composition is needed.")}
            />
          )}

          <PageTabs
            tabs={metricsTabs}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as CephAdminMetricsTab)}
            variant="line"
            ariaLabel={surfaceText("Ceph Admin metrics sections")}
            idPrefix="ceph-admin-metrics"
          />

          <PageTabPanel idPrefix="ceph-admin-metrics" tabId={activeTab} className="space-y-4 pt-4">
          {activeTab === "storage" ? (
            metricsUnavailableError ? (
              <MetricsUnavailableCard
                eyebrow={surfaceText("RGW metrics")}
                title={surfaceText("Storage snapshot")}
                description={surfaceText("Aggregated stats across the entire RGW cluster.")}
                message={metricsUnavailableError}
                tone="warning"
              />
            ) : noMetricsSurfaceAvailable ? (
              <MetricsUnavailableCard
                eyebrow={surfaceText("RGW metrics")}
                title={surfaceText("Storage snapshot")}
                description={surfaceText("Aggregated stats across the entire RGW cluster.")}
                message={surfaceText("Both storage metrics and usage logs are disabled for the selected endpoint.")}
                tone="warning"
              />
            ) : storageDisabledMessage ? (
              <MetricsUnavailableCard
                title={surfaceText("Storage snapshot")}
                description={surfaceText("Aggregated stats across the entire RGW cluster.")}
                message={storageDisabledMessage}
              />
            ) : storageError ? (
              <MetricsUnavailableCard
                title={surfaceText("Storage snapshot")}
                description={surfaceText("Aggregated stats across the entire RGW cluster.")}
                message={storageError}
                tone="error"
              />
            ) : storageFeatureEnabled ? (
              <>
                <MetricsSummaryCard
                  title={surfaceText("Storage snapshot")}
                  description={surfaceText("Aggregated stats across the entire RGW cluster.")}
                  updatedAt={storage?.generated_at}
                >
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricsSnapshotCard
                      label={surfaceText("Stored volume")}
                      value={storageTotals?.used_bytes != null ? formatBytes(storageTotals.used_bytes) : "—"}
                      hint={surfaceText("Sum of all visible buckets")}
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label={surfaceText("Objects")}
                      value={storageTotals?.object_count != null ? formatCompactNumber(storageTotals.object_count) : "—"}
                      hint={surfaceText("Instant cluster count")}
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label={surfaceText("Buckets")}
                      value={formatCompactNumber(storageTotals?.bucket_count ?? storage?.total_buckets ?? 0)}
                      hint={surfaceText("Across all owners")}
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label={surfaceText("Owners")}
                      value={formatCompactNumber(storageTotals?.owners_with_usage ?? 0)}
                      hint={surfaceText("Distinct bucket owners")}
                      loading={storageLoading}
                    />
                  </div>
                </MetricsSummaryCard>

                <MetricsCard
                  title={surfaceText("Storage breakdown")}
                  description={surfaceText("Top consumers by owner and bucket.")}
                >
                  <div className="grid gap-6 xl:grid-cols-2">
                    <UsageBreakdown
                      title={surfaceText("Owners (volume)")}
                      loading={storageLoading}
                      metric="bytes"
                      items={ownerUsageItems}
                      emptyMessage={surfaceText("No owner volume data available.")}
                    />
                    <UsageBreakdown
                      title={surfaceText("Owners (objects)")}
                      loading={storageLoading}
                      metric="objects"
                      items={ownerUsageItems}
                      emptyMessage={surfaceText("No owner object data available.")}
                    />
                  </div>
                  <div className="grid gap-6 xl:grid-cols-2">
                    <UsageBreakdown
                      title={surfaceText("Buckets (volume)")}
                      loading={storageLoading}
                      metric="bytes"
                      items={bucketUsageItems}
                      emptyMessage={surfaceText("No bucket volume data available.")}
                    />
                    <UsageBreakdown
                      title={surfaceText("Buckets (objects)")}
                      loading={storageLoading}
                      metric="objects"
                      items={bucketUsageItems}
                      emptyMessage={surfaceText("No bucket object data available.")}
                    />
                  </div>
                </MetricsCard>
              </>
            ) : null
          ) : null}

          {activeTab === "usage-composition" && canLoadUsageStatsAggregate ? usageStatsAggregateSection : null}

          {activeTab === "traffic" && metricsUnavailableError ? (
            <MetricsUnavailableCard
              eyebrow={surfaceText("RGW metrics")}
              title={surfaceText("RGW traffic")}
              description={surfaceText("Reading cluster-wide RGW logs for the selected window.")}
              message={metricsUnavailableError}
              tone="warning"
            />
          ) : null}
          {activeTab === "traffic" && !metricsUnavailableError && noMetricsSurfaceAvailable ? (
            <MetricsUnavailableCard
              eyebrow={surfaceText("RGW metrics")}
              title={surfaceText("RGW traffic")}
              description={surfaceText("Reading cluster-wide RGW logs for the selected window.")}
              message={surfaceText("Both storage metrics and usage logs are disabled for the selected endpoint.")}
              tone="warning"
            />
          ) : null}
          {activeTab === "traffic" && !metricsUnavailableError && !noMetricsSurfaceAvailable && trafficDisabledMessage ? (
            <MetricsUnavailableCard
              title={surfaceText("RGW traffic")}
              description={surfaceText("Reading cluster-wide RGW logs for the selected window.")}
              message={trafficDisabledMessage}
            />
          ) : activeTab === "traffic" && !metricsUnavailableError && !noMetricsSurfaceAvailable && usageLogFeatureEnabled ? (
            <MetricsTrafficOverview
              traffic={traffic}
              window={window}
              onWindowChange={setWindow}
              loading={trafficLoading}
              error={trafficError}
              showEmpty={missingTraffic}
              description={surfaceText("Reading cluster-wide RGW logs for the selected window.")}
              userRankingTitle={surfaceText("Most active owners")}
            />
          ) : null}
          </PageTabPanel>
        </>
      )}
    </div>
  );
}
