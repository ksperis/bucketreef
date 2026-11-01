/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import { listAuditLogs, type AuditLogEntry } from "../../api/audit";
import {
  fetchHealthOverview,
  fetchHealthWorkspaceOverview,
  type EndpointHealthOverviewResponse,
  type WorkspaceEndpointHealthOverviewResponse,
} from "../../api/healthchecks";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import {
  fetchAdminDashboardScope,
  fetchAdminDashboardStorage,
  fetchAdminDashboardTraffic,
  fetchAdminSummary,
  type AdminDashboardScope,
  type AdminDashboardStorage,
  type AdminDashboardTraffic,
  type AdminSummary,
} from "../../api/stats";
import { extractApiError } from "../../utils/apiError";
import { adminDashboardSourceText } from "./adminDashboardMessages";

const ADMIN_INCIDENT_HISTORY_MINUTES = 7 * 24 * 60;
const EMPTY_AUDIT_LOGS: AuditLogEntry[] = [];
const EMPTY_STORAGE_ENDPOINTS: StorageEndpoint[] = [];

type DashboardResourceOptions<T> = {
  clearErrorOnLoad?: boolean;
  enabled?: boolean;
  fallbackErrorText: string;
  initialLoading: boolean;
  initialResource: T;
  loadResource: () => Promise<T>;
  onLoaded?: () => void;
  refreshNonce: number;
  resetOnLoad?: boolean;
};

function useDashboardResource<T>({
  clearErrorOnLoad = true,
  enabled = true,
  fallbackErrorText,
  initialLoading,
  initialResource,
  loadResource,
  onLoaded,
  refreshNonce,
  resetOnLoad = false,
}: DashboardResourceOptions<T>) {
  const [resource, setResource] = useState(initialResource);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setResource(initialResource);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    if (resetOnLoad) setResource(initialResource);
    if (clearErrorOnLoad) setError(null);

    loadResource()
      .then((data) => {
        if (cancelled) return;
        setResource(data);
        setError(null);
        onLoaded?.();
      })
      .catch((cause) => {
        if (cancelled) return;
        setResource(initialResource);
        setError(extractApiError(cause, fallbackErrorText));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clearErrorOnLoad, enabled, fallbackErrorText, initialResource, loadResource, onLoaded, refreshNonce, resetOnLoad]);

  return { resource, loading, error };
}

function loadWorkspaceHealth() {
  return fetchHealthWorkspaceOverview(undefined, ADMIN_INCIDENT_HISTORY_MINUTES);
}

function loadHealthOverview() {
  return fetchHealthOverview("week");
}

function loadMapEndpoints() {
  return listStorageEndpoints();
}

async function loadAuditLogs() {
  const data = await listAuditLogs({ limit: 6 });
  return data.logs;
}

export function useAdminDashboardResources({
  endpointStatusEnabled,
  refreshNonce,
}: {
  endpointStatusEnabled: boolean;
  refreshNonce: number;
}) {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const touchLastUpdated = useCallback(() => setLastUpdated(new Date()), []);
  const {
    resource: summary,
    loading: summaryLoading,
    error: summaryError,
  } = useDashboardResource<AdminSummary | null>({
    clearErrorOnLoad: false,
    fallbackErrorText: adminDashboardSourceText("loadOverviewError"),
    initialLoading: true,
    initialResource: null,
    loadResource: fetchAdminSummary,
    onLoaded: touchLastUpdated,
    refreshNonce,
  });
  const {
    resource: dashboardScope,
    loading: scopeLoading,
    error: scopeError,
  } = useDashboardResource<AdminDashboardScope | null>({
    fallbackErrorText: adminDashboardSourceText("loadScopeError"),
    initialLoading: true,
    initialResource: null,
    loadResource: fetchAdminDashboardScope,
    refreshNonce,
    resetOnLoad: true,
  });
  const {
    resource: storage,
    loading: storageLoading,
    error: storageError,
  } = useDashboardResource<AdminDashboardStorage | null>({
    fallbackErrorText: adminDashboardSourceText("storageUnavailable"),
    initialLoading: true,
    initialResource: null,
    loadResource: fetchAdminDashboardStorage,
    onLoaded: touchLastUpdated,
    refreshNonce,
  });
  const {
    resource: traffic,
    loading: trafficLoading,
    error: trafficError,
  } = useDashboardResource<AdminDashboardTraffic | null>({
    fallbackErrorText: adminDashboardSourceText("trafficUnavailable"),
    initialLoading: true,
    initialResource: null,
    loadResource: fetchAdminDashboardTraffic,
    onLoaded: touchLastUpdated,
    refreshNonce,
  });
  const {
    resource: auditLogs,
    loading: auditLoading,
    error: auditError,
  } = useDashboardResource<AuditLogEntry[]>({
    fallbackErrorText: adminDashboardSourceText("loadActivityError"),
    initialLoading: true,
    initialResource: EMPTY_AUDIT_LOGS,
    loadResource: loadAuditLogs,
    onLoaded: touchLastUpdated,
    refreshNonce,
  });
  const {
    resource: workspaceHealth,
    loading: workspaceHealthLoading,
    error: workspaceHealthError,
  } = useDashboardResource<WorkspaceEndpointHealthOverviewResponse | null>({
    enabled: endpointStatusEnabled,
    fallbackErrorText: adminDashboardSourceText("loadHealthError"),
    initialLoading: false,
    initialResource: null,
    loadResource: loadWorkspaceHealth,
    onLoaded: touchLastUpdated,
    refreshNonce,
  });
  const {
    resource: mapEndpoints,
    loading: mapEndpointsLoading,
    error: mapEndpointsError,
  } = useDashboardResource<StorageEndpoint[]>({
    enabled: endpointStatusEnabled,
    fallbackErrorText: adminDashboardSourceText("loadMapError"),
    initialLoading: false,
    initialResource: EMPTY_STORAGE_ENDPOINTS,
    loadResource: loadMapEndpoints,
    refreshNonce,
  });
  const {
    resource: healthOverview,
    loading: healthOverviewLoading,
    error: healthOverviewError,
  } = useDashboardResource<EndpointHealthOverviewResponse | null>({
    enabled: endpointStatusEnabled,
    fallbackErrorText: adminDashboardSourceText("healthHistoryUnavailable"),
    initialLoading: false,
    initialResource: null,
    loadResource: loadHealthOverview,
    onLoaded: touchLastUpdated,
    refreshNonce,
  });

  return {
    summary,
    summaryLoading,
    summaryError,
    workspaceHealth,
    workspaceHealthLoading,
    workspaceHealthError,
    mapEndpoints,
    mapEndpointsLoading,
    mapEndpointsError,
    healthOverview,
    healthOverviewLoading,
    healthOverviewError,
    dashboardScope,
    scopeLoading,
    scopeError,
    storage,
    storageLoading,
    storageError,
    traffic,
    trafficLoading,
    trafficError,
    auditLogs,
    auditLoading,
    auditError,
    lastUpdated,
  };
}
