/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

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
import useAdminResourceController from "./useAdminResourceController";

const ADMIN_INCIDENT_HISTORY_MINUTES = 7 * 24 * 60;
const EMPTY_AUDIT_LOGS: AuditLogEntry[] = [];
const EMPTY_STORAGE_ENDPOINTS: StorageEndpoint[] = [];

function dashboardErrorFormatter(key: Parameters<typeof adminDashboardSourceText>[0]) {
  const fallback = adminDashboardSourceText(key);
  return (error: unknown) => extractApiError(error, fallback);
}

const formatSummaryError = dashboardErrorFormatter("loadOverviewError");
const formatScopeError = dashboardErrorFormatter("loadScopeError");
const formatStorageError = dashboardErrorFormatter("storageUnavailable");
const formatTrafficError = dashboardErrorFormatter("trafficUnavailable");
const formatAuditError = dashboardErrorFormatter("loadActivityError");
const formatWorkspaceHealthError = dashboardErrorFormatter("loadHealthError");
const formatMapEndpointsError = dashboardErrorFormatter("loadMapError");
const formatHealthOverviewError = dashboardErrorFormatter("healthHistoryUnavailable");

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
  } = useAdminResourceController<AdminSummary | null>({
    clearErrorOnLoad: false,
    formatError: formatSummaryError,
    initialLoading: true,
    initialResource: null,
    loadResource: fetchAdminSummary,
    onLoaded: touchLastUpdated,
    reloadToken: refreshNonce,
    resetResourceOnError: true,
  });
  const {
    resource: dashboardScope,
    loading: scopeLoading,
    error: scopeError,
  } = useAdminResourceController<AdminDashboardScope | null>({
    formatError: formatScopeError,
    initialLoading: true,
    initialResource: null,
    loadResource: fetchAdminDashboardScope,
    reloadToken: refreshNonce,
    resetResourceOnError: true,
    resetResourceOnLoad: true,
  });
  const {
    resource: storage,
    loading: storageLoading,
    error: storageError,
  } = useAdminResourceController<AdminDashboardStorage | null>({
    formatError: formatStorageError,
    initialLoading: true,
    initialResource: null,
    loadResource: fetchAdminDashboardStorage,
    onLoaded: touchLastUpdated,
    reloadToken: refreshNonce,
    resetResourceOnError: true,
  });
  const {
    resource: traffic,
    loading: trafficLoading,
    error: trafficError,
  } = useAdminResourceController<AdminDashboardTraffic | null>({
    formatError: formatTrafficError,
    initialLoading: true,
    initialResource: null,
    loadResource: fetchAdminDashboardTraffic,
    onLoaded: touchLastUpdated,
    reloadToken: refreshNonce,
    resetResourceOnError: true,
  });
  const {
    resource: auditLogs,
    loading: auditLoading,
    error: auditError,
  } = useAdminResourceController<AuditLogEntry[]>({
    formatError: formatAuditError,
    initialLoading: true,
    initialResource: EMPTY_AUDIT_LOGS,
    loadResource: loadAuditLogs,
    onLoaded: touchLastUpdated,
    reloadToken: refreshNonce,
    resetResourceOnError: true,
  });
  const {
    resource: workspaceHealth,
    loading: workspaceHealthLoading,
    error: workspaceHealthError,
  } = useAdminResourceController<WorkspaceEndpointHealthOverviewResponse | null>({
    enabled: endpointStatusEnabled,
    formatError: formatWorkspaceHealthError,
    initialLoading: false,
    initialResource: null,
    loadResource: loadWorkspaceHealth,
    onLoaded: touchLastUpdated,
    reloadToken: refreshNonce,
    resetResourceOnError: true,
    resetResourceWhenDisabled: true,
  });
  const {
    resource: mapEndpoints,
    loading: mapEndpointsLoading,
    error: mapEndpointsError,
  } = useAdminResourceController<StorageEndpoint[]>({
    enabled: endpointStatusEnabled,
    formatError: formatMapEndpointsError,
    initialLoading: false,
    initialResource: EMPTY_STORAGE_ENDPOINTS,
    loadResource: loadMapEndpoints,
    reloadToken: refreshNonce,
    resetResourceOnError: true,
    resetResourceWhenDisabled: true,
  });
  const {
    resource: healthOverview,
    loading: healthOverviewLoading,
    error: healthOverviewError,
  } = useAdminResourceController<EndpointHealthOverviewResponse | null>({
    enabled: endpointStatusEnabled,
    formatError: formatHealthOverviewError,
    initialLoading: false,
    initialResource: null,
    loadResource: loadHealthOverview,
    onLoaded: touchLastUpdated,
    reloadToken: refreshNonce,
    resetResourceOnError: true,
    resetResourceWhenDisabled: true,
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
