/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { Bucket } from "../../api/bucketContracts";
import {
  getManagerUsageStatsAggregate,
  type BucketUsageStatsAggregate,
} from "../../api/bucketUsageStats";
import {
  fetchManagerWorkspaceHealthOverview,
  type WorkspaceEndpointHealthOverviewResponse,
} from "../../api/healthchecks";
import { listManagerActivity, type ManagerActivityEntry } from "../../api/managerActivity";
import { listBuckets } from "../../api/managerBuckets";
import { fetchManagerContext, type ManagerContext } from "../../api/managerContext";
import {
  fetchManagerTraffic,
  fetchManagerUsageTrends,
  type ManagerTrafficStats,
  type ManagerUsageTrendsResponse,
  type TrafficWindow,
} from "../../api/stats";
import {
  WORKSPACE_TRAFFIC_TREND_WINDOWS as TRAFFIC_TREND_WINDOWS,
  selectWorkspaceTrafficTrend,
  type WorkspaceTrafficTrendSelection,
} from "../../components/workspaceDashboardKpis";
import { extractApiError } from "../../utils/apiError";

type ManagerDashboardTextFunction = (message: string, values?: Record<string, string | number>) => string;

type UseManagerDashboardResourcesOptions = {
  contextIdForApi: S3ExecutionContextSelector;
  hasContext: boolean;
  endpointStatusEnabled: boolean;
  activityHistoryEnabled: boolean;
  trafficFeatureEnabled: boolean;
  usageFeatureEnabled: boolean;
  canLoadUsageStatsDataTypes: boolean;
  refreshNonce: number;
  text: ManagerDashboardTextFunction;
};

export function useManagerDashboardResources({
  contextIdForApi,
  hasContext,
  endpointStatusEnabled,
  activityHistoryEnabled,
  trafficFeatureEnabled,
  usageFeatureEnabled,
  canLoadUsageStatsDataTypes,
  refreshNonce,
  text,
}: UseManagerDashboardResourcesOptions) {
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketCountLoading, setBucketCountLoading] = useState(false);
  const [bucketCountError, setBucketCountError] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<ManagerActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [trafficStats, setTrafficStats] = useState<ManagerTrafficStats | null>(null);
  const [trafficTrend, setTrafficTrend] = useState<WorkspaceTrafficTrendSelection | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [usageTrends, setUsageTrends] = useState<ManagerUsageTrendsResponse | null>(null);
  const [usageTrendsLoading, setUsageTrendsLoading] = useState(false);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [managerLimits, setManagerLimits] = useState<ManagerContext | null>(null);

  useEffect(() => {
    if (!hasContext) {
      setManagerLimits(null);
      return;
    }
    let cancelled = false;
    setManagerLimits(null);
    fetchManagerContext(contextIdForApi, { includeLimits: true })
      .then((context) => {
        if (!cancelled) setManagerLimits(context);
      })
      .catch(() => {
        if (!cancelled) setManagerLimits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [contextIdForApi, hasContext, refreshNonce]);

  useEffect(() => {
    if (!hasContext || !endpointStatusEnabled) {
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    setWorkspaceHealthError(null);
    fetchManagerWorkspaceHealthOverview(contextIdForApi)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspaceHealth(null);
        setWorkspaceHealthError(extractApiError(err, text("Unable to load endpoint health for this context.")));
      })
      .finally(() => {
        if (!cancelled) setWorkspaceHealthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contextIdForApi, endpointStatusEnabled, hasContext, refreshNonce, text]);

  useEffect(() => {
    if (!hasContext) {
      setBuckets([]);
      setBucketCountError(null);
      setBucketCountLoading(false);
      return;
    }
    let cancelled = false;
    setBucketCountLoading(true);
    setBucketCountError(null);
    listBuckets(contextIdForApi, { with_stats: false })
      .then((items) => {
        if (cancelled) return;
        setBuckets(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setBuckets([]);
        setBucketCountError(extractApiError(err, text("Unable to load bucket count.")));
      })
      .finally(() => {
        if (!cancelled) setBucketCountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contextIdForApi, hasContext, refreshNonce, text]);

  useEffect(() => {
    if (!hasContext || !activityHistoryEnabled) {
      setActivityLogs([]);
      setActivityError(null);
      setActivityLoading(false);
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    listManagerActivity(contextIdForApi, { limit: 5 })
      .then((items) => {
        if (cancelled) return;
        setActivityLogs(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setActivityLogs([]);
        setActivityError(extractApiError(err, text("Unable to load manager activity.")));
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityHistoryEnabled, contextIdForApi, hasContext, refreshNonce, text]);

  useEffect(() => {
    if (!hasContext || !trafficFeatureEnabled) {
      setTrafficStats(null);
      setTrafficTrend(null);
      setTrafficError(null);
      setTrafficLoading(false);
      return;
    }
    let cancelled = false;
    setTrafficLoading(true);
    setTrafficError(null);
    Promise.allSettled(
      TRAFFIC_TREND_WINDOWS.map((option) =>
        fetchManagerTraffic(contextIdForApi, option.window).then((data) => [option.window, data] as const)
      )
    )
      .then((results) => {
        if (cancelled) return;
        const entries = results
          .filter((result): result is PromiseFulfilledResult<readonly [TrafficWindow, ManagerTrafficStats]> => result.status === "fulfilled")
          .map((result) => result.value);
        const statsByWindow = Object.fromEntries(entries) as Partial<Record<TrafficWindow, ManagerTrafficStats>>;
        const dayStats = statsByWindow.day ?? null;
        setTrafficStats(dayStats);
        setTrafficTrend(selectWorkspaceTrafficTrend(statsByWindow));
        const dayFailure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        setTrafficError(dayStats ? null : extractApiError(dayFailure?.reason, text("Unable to load traffic usage.")));
      })
      .catch((err) => {
        if (cancelled) return;
        setTrafficStats(null);
        setTrafficTrend(null);
        setTrafficError(extractApiError(err, text("Unable to load traffic usage.")));
      })
      .finally(() => {
        if (!cancelled) setTrafficLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contextIdForApi, hasContext, refreshNonce, text, trafficFeatureEnabled]);

  useEffect(() => {
    if (!hasContext || !usageFeatureEnabled) {
      setUsageTrends(null);
      setUsageTrendsLoading(false);
      return;
    }
    let cancelled = false;
    setUsageTrendsLoading(true);
    fetchManagerUsageTrends(contextIdForApi)
      .then((data) => {
        if (!cancelled) setUsageTrends(data);
      })
      .catch(() => {
        if (!cancelled) setUsageTrends(null);
      })
      .finally(() => {
        if (!cancelled) setUsageTrendsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contextIdForApi, hasContext, refreshNonce, usageFeatureEnabled]);

  useEffect(() => {
    if (!canLoadUsageStatsDataTypes) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      return;
    }
    let cancelled = false;
    setUsageStatsLoading(true);
    getManagerUsageStatsAggregate(contextIdForApi)
      .then((data) => {
        if (!cancelled) setUsageStatsAggregate(data.aggregate);
      })
      .catch(() => {
        if (!cancelled) setUsageStatsAggregate(null);
      })
      .finally(() => {
        if (!cancelled) setUsageStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadUsageStatsDataTypes, contextIdForApi, refreshNonce]);

  return {
    workspaceHealth,
    workspaceHealthLoading,
    workspaceHealthError,
    buckets,
    bucketCountLoading,
    bucketCountError,
    activityLogs,
    activityLoading,
    activityError,
    trafficStats,
    trafficTrend,
    trafficLoading,
    trafficError,
    usageTrends,
    usageTrendsLoading,
    usageStatsAggregate,
    usageStatsLoading,
    managerLimits,
  };
}
