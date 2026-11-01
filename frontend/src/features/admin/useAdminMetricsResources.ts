/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import {
  fetchAdminStorage,
  fetchAdminTraffic,
  type AdminStorageStats,
  type AdminTrafficStats,
  type TrafficWindow,
} from "../../api/stats";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import {
  fetchAdminUsageHistoryTrends,
  type UsageHistoryTrendResponse,
  type UsageHistoryTrendWindow,
} from "../../api/usageHistory";
import { extractApiError } from "../../utils/apiError";
import { adminMetricsSourceText } from "./adminMetricsMessage";
import useAdminResourceController from "./useAdminResourceController";

function metricsErrorFormatter(key: Parameters<typeof adminMetricsSourceText>[0]) {
  const fallback = adminMetricsSourceText(key);
  return (error: unknown) => extractApiError(error, fallback);
}

const formatStorageError = metricsErrorFormatter("loadStorageError");
const formatTrafficError = metricsErrorFormatter("loadTrafficError");
const formatUsageHistoryError = metricsErrorFormatter("loadHistoryError");

export function useAdminMetricsResources({
  usageHistoryEnabled,
  trafficWindow,
  usageHistoryWindow,
}: {
  usageHistoryEnabled: boolean;
  trafficWindow: TrafficWindow;
  usageHistoryWindow: UsageHistoryTrendWindow;
}) {
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [endpointLoading, setEndpointLoading] = useState(true);
  const [endpointError, setEndpointError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      setEndpointLoading(true);
      setEndpointError(null);
      try {
        const data = await listStorageEndpoints();
        if (cancelled) return;
        const cephEndpoints = data.filter((endpoint) => endpoint.provider === "ceph");
        setEndpoints(cephEndpoints);
        if (cephEndpoints.length === 0) {
          setSelectedEndpointId(null);
          setEndpointError(adminMetricsSourceText("noEndpointError"));
          return;
        }
        const preferred = cephEndpoints.find((endpoint) => endpoint.is_default) ?? cephEndpoints[0];
        setSelectedEndpointId((current) => current ?? preferred.id);
      } catch (err) {
        if (cancelled) return;
        setEndpoints([]);
        setSelectedEndpointId(null);
        setEndpointError(extractApiError(err, adminMetricsSourceText("loadEndpointsError")));
      } finally {
        if (!cancelled) setEndpointLoading(false);
      }
    }
    void loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, []);

  const resourceEnabled = !endpointLoading && selectedEndpointId != null;
  const loadStorage = useCallback(() => {
    if (selectedEndpointId == null) throw new Error("Storage endpoint is not selected");
    return fetchAdminStorage(selectedEndpointId);
  }, [selectedEndpointId]);
  const {
    resource: storage,
    error: storageError,
    loading: storageLoading,
  } = useAdminResourceController<AdminStorageStats | null>({
    enabled: resourceEnabled,
    formatError: formatStorageError,
    initialLoading: true,
    initialResource: null,
    loadResource: loadStorage,
    resetResourceOnError: true,
    resetResourceOnLoad: true,
    resetResourceWhenDisabled: true,
  });

  const loadTraffic = useCallback(() => {
    if (selectedEndpointId == null) throw new Error("Storage endpoint is not selected");
    return fetchAdminTraffic(trafficWindow, selectedEndpointId);
  }, [selectedEndpointId, trafficWindow]);
  const {
    resource: traffic,
    error: trafficError,
    loading: trafficLoading,
  } = useAdminResourceController<AdminTrafficStats | null>({
    enabled: resourceEnabled,
    formatError: formatTrafficError,
    initialLoading: false,
    initialResource: null,
    loadResource: loadTraffic,
    resetResourceOnError: true,
    resetResourceOnLoad: true,
    resetResourceWhenDisabled: true,
  });

  const loadUsageHistoryTrends = useCallback(() => {
    if (selectedEndpointId == null) throw new Error("Storage endpoint is not selected");
    return fetchAdminUsageHistoryTrends({
      window: usageHistoryWindow,
      endpointId: selectedEndpointId,
      subjectType: "all",
    });
  }, [selectedEndpointId, usageHistoryWindow]);
  const {
    resource: usageHistoryTrends,
    error: usageHistoryError,
    loading: usageHistoryLoading,
  } = useAdminResourceController<UsageHistoryTrendResponse | null>({
    enabled: resourceEnabled && usageHistoryEnabled,
    formatError: formatUsageHistoryError,
    initialLoading: false,
    initialResource: null,
    loadResource: loadUsageHistoryTrends,
    resetResourceOnError: true,
    resetResourceOnLoad: true,
    resetResourceWhenDisabled: true,
  });

  return {
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
  };
}
