/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";

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

export function useAdminMetricsResources({
  usageHistoryEnabled,
  trafficWindow,
  usageHistoryWindow,
}: {
  usageHistoryEnabled: boolean;
  trafficWindow: TrafficWindow;
  usageHistoryWindow: UsageHistoryTrendWindow;
}) {
  const [storage, setStorage] = useState<AdminStorageStats | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [endpointLoading, setEndpointLoading] = useState(true);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<AdminTrafficStats | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [usageHistoryTrends, setUsageHistoryTrends] = useState<UsageHistoryTrendResponse | null>(null);
  const [usageHistoryLoading, setUsageHistoryLoading] = useState(false);
  const [usageHistoryError, setUsageHistoryError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    async function loadStorage() {
      if (endpointLoading) return;
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
        if (!cancelled) setStorage(data);
      } catch (err) {
        if (cancelled) return;
        setStorageError(extractApiError(err, adminMetricsSourceText("loadStorageError")));
        setStorage(null);
      } finally {
        if (!cancelled) setStorageLoading(false);
      }
    }
    void loadStorage();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTraffic() {
      if (endpointLoading) return;
      if (selectedEndpointId == null) {
        setTraffic(null);
        setTrafficLoading(false);
        return;
      }
      setTraffic(null);
      setTrafficLoading(true);
      setTrafficError(null);
      try {
        const data = await fetchAdminTraffic(trafficWindow, selectedEndpointId);
        if (!cancelled) setTraffic(data);
      } catch (err) {
        if (cancelled) return;
        setTrafficError(extractApiError(err, adminMetricsSourceText("loadTrafficError")));
        setTraffic(null);
      } finally {
        if (!cancelled) setTrafficLoading(false);
      }
    }
    void loadTraffic();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId, trafficWindow]);

  useEffect(() => {
    let cancelled = false;
    async function loadUsageHistoryTrends() {
      if (!usageHistoryEnabled || endpointLoading) {
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
        if (!cancelled) setUsageHistoryTrends(data);
      } catch (err) {
        if (cancelled) return;
        setUsageHistoryTrends(null);
        setUsageHistoryError(extractApiError(err, adminMetricsSourceText("loadHistoryError")));
      } finally {
        if (!cancelled) setUsageHistoryLoading(false);
      }
    }
    void loadUsageHistoryTrends();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId, usageHistoryEnabled, usageHistoryWindow]);

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
