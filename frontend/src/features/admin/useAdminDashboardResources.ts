/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";

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

export function useAdminDashboardResources({
  endpointStatusEnabled,
  refreshNonce,
}: {
  endpointStatusEnabled: boolean;
  refreshNonce: number;
}) {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);
  const [mapEndpoints, setMapEndpoints] = useState<StorageEndpoint[]>([]);
  const [mapEndpointsLoading, setMapEndpointsLoading] = useState(false);
  const [mapEndpointsError, setMapEndpointsError] = useState<string | null>(null);
  const [healthOverview, setHealthOverview] = useState<EndpointHealthOverviewResponse | null>(null);
  const [healthOverviewLoading, setHealthOverviewLoading] = useState(false);
  const [healthOverviewError, setHealthOverviewError] = useState<string | null>(null);
  const [dashboardScope, setDashboardScope] = useState<AdminDashboardScope | null>(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [storage, setStorage] = useState<AdminDashboardStorage | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<AdminDashboardTraffic | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    fetchAdminSummary()
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setSummaryError(null);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(extractApiError(err, adminDashboardSourceText("loadOverviewError")));
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setScopeLoading(true);
    setScopeError(null);
    setDashboardScope(null);
    fetchAdminDashboardScope()
      .then((data) => {
        if (!cancelled) setDashboardScope(data);
      })
      .catch((err) => {
        if (!cancelled) setScopeError(extractApiError(err, adminDashboardSourceText("loadScopeError")));
      })
      .finally(() => {
        if (!cancelled) setScopeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setStorageLoading(true);
    setStorageError(null);
    fetchAdminDashboardStorage()
      .then((data) => {
        if (cancelled) return;
        setStorage(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setStorage(null);
        setStorageError(extractApiError(err, adminDashboardSourceText("storageUnavailable")));
      })
      .finally(() => {
        if (!cancelled) setStorageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setTrafficLoading(true);
    setTrafficError(null);
    fetchAdminDashboardTraffic()
      .then((data) => {
        if (cancelled) return;
        setTraffic(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setTraffic(null);
        setTrafficError(extractApiError(err, adminDashboardSourceText("trafficUnavailable")));
      })
      .finally(() => {
        if (!cancelled) setTrafficLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setAuditLoading(true);
    setAuditError(null);
    listAuditLogs({ limit: 6 })
      .then((data) => {
        if (cancelled) return;
        setAuditLogs(data.logs);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setAuditLogs([]);
        setAuditError(extractApiError(err, adminDashboardSourceText("loadActivityError")));
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    if (!endpointStatusEnabled) {
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      setHealthOverview(null);
      setHealthOverviewError(null);
      setHealthOverviewLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    setWorkspaceHealthError(null);
    fetchHealthWorkspaceOverview(undefined, ADMIN_INCIDENT_HISTORY_MINUTES)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspaceHealth(null);
        setWorkspaceHealthError(extractApiError(err, adminDashboardSourceText("loadHealthError")));
      })
      .finally(() => {
        if (!cancelled) setWorkspaceHealthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpointStatusEnabled, refreshNonce]);

  useEffect(() => {
    if (!endpointStatusEnabled) {
      setMapEndpoints([]);
      setMapEndpointsError(null);
      setMapEndpointsLoading(false);
      return;
    }
    let cancelled = false;
    setMapEndpointsLoading(true);
    setMapEndpointsError(null);
    listStorageEndpoints()
      .then((data) => {
        if (!cancelled) setMapEndpoints(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setMapEndpoints([]);
        setMapEndpointsError(extractApiError(err, adminDashboardSourceText("loadMapError")));
      })
      .finally(() => {
        if (!cancelled) setMapEndpointsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpointStatusEnabled, refreshNonce]);

  useEffect(() => {
    if (!endpointStatusEnabled) return;
    let cancelled = false;
    setHealthOverviewLoading(true);
    setHealthOverviewError(null);
    fetchHealthOverview("week")
      .then((data) => {
        if (cancelled) return;
        setHealthOverview(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setHealthOverview(null);
        setHealthOverviewError(extractApiError(err, adminDashboardSourceText("healthHistoryUnavailable")));
      })
      .finally(() => {
        if (!cancelled) setHealthOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpointStatusEnabled, refreshNonce]);

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
