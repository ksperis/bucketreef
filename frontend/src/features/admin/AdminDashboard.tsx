import AdminDashboardMap, { type AdminDashboardMapMarker } from "./components/AdminDashboardMap";
/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { listAuditLogs, type AuditLogEntry } from "../../api/audit";
import {
  fetchHealthOverview,
  fetchHealthSummary,
  fetchHealthWorkspaceOverview,
  type EndpointHealthOverviewResponse,
  type HealthCheckStatus,
  type WorkspaceEndpointHealthEntry,
  type WorkspaceEndpointHealthOverviewResponse,
} from "../../api/healthchecks";
import { dismissOnboarding, fetchOnboardingStatus, type OnboardingStatus } from "../../api/onboarding";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import {
  type AdminStorageStats,
  type AdminSummary,
  type AdminTrafficStats,
  fetchAdminStorage,
  fetchAdminSummary,
  fetchAdminTraffic,
} from "../../api/stats";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import {
  type WorkspaceDashboardFeature,
  type WorkspaceDashboardFeatureGroup,
  type WorkspaceDashboardSummaryItem,
  WorkspaceDashboardSummary,
  WorkspaceDashboardCard,
  WorkspaceDashboardAction,
  WorkspaceDashboardActionLink,
  WorkspaceFeatureSummary,
  WorkspaceAvailabilityMetric,
  type WorkspacePlatformMetric,
  WorkspacePlatformMetricCard,
  WorkspaceStatusDot,
  WorkspaceStatusCounter,
} from "../../components/WorkspaceDashboardKit";
import WorkspaceIncidentsCard from "../../components/WorkspaceIncidentsCard";
import UiBadge from "../../components/ui/UiBadge";
import {
  cx,
  uiCardClass,
  uiMutedTextClass,
} from "../../components/ui/styles";
import {
  OpenIcon,
  RefreshIcon,
} from "../browser/browserIcons";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime } from "../../utils/dateTime";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import { useI18n } from "../../i18n";
import { onboardingCopy } from "./onboardingCopy";

const ENDPOINT_STATUS_MAX_AGE_HOURS = 24;
const ENDPOINT_STATUS_MAX_AGE_MS = ENDPOINT_STATUS_MAX_AGE_HOURS * 60 * 60 * 1000;
const ADMIN_INCIDENT_HISTORY_MINUTES = 7 * 24 * 60;
const MAX_ENDPOINT_ROWS = 8;

function parseBackendIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatRelativeTime(value?: string | null, now = Date.now()): string {
  const parsed = parseBackendIsoDate(value);
  if (!parsed) return "Date unavailable";
  const diffMs = Math.max(0, now - parsed.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isEndpointCheckStale(value?: string | null, now = Date.now()): boolean {
  const parsed = parseBackendIsoDate(value);
  return !parsed || now - parsed.getTime() > ENDPOINT_STATUS_MAX_AGE_MS;
}

function formatEndpointFreshnessWarning(noChecksCount: number, staleCount: number, totalCount: number): string {
  const issueCount = noChecksCount + staleCount;
  const details = [
    noChecksCount > 0 ? `${noChecksCount} without checks` : null,
    staleCount > 0 ? `${staleCount} older than ${ENDPOINT_STATUS_MAX_AGE_HOURS}h` : null,
  ].filter(Boolean);
  return `Endpoint Status uses stored healthcheck samples; ${issueCount}/${totalCount} endpoint(s) need fresh checks (${details.join(
    ", "
  )}). Dashboard statuses may not reflect current availability.`;
}

function formatLatency(value?: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value)} ms`;
}

function formatCheckMode(mode?: string | null): string {
  return (mode || "http").toUpperCase();
}

function computeMeanAvailability(data?: EndpointHealthOverviewResponse | null): number | null {
  const availabilityValues =
    data?.endpoints
      .map((endpoint) => endpoint.availability_pct)
      .filter((value): value is number => value != null && Number.isFinite(value)) ?? [];
  if (availabilityValues.length === 0) return null;
  const totalAvailability = availabilityValues.reduce((total, value) => total + value, 0);
  return Math.round(totalAvailability / availabilityValues.length);
}

function formatAuditAction(log: AuditLogEntry): string {
  const action = log.action.replace(/[._-]+/g, " ").trim();
  if (log.action.includes("login")) return `User ${log.user_email} logged in`;
  if (log.entity_type === "bucket" && log.entity_id) return `Bucket "${log.entity_id}" ${action}`;
  if (log.entity_type === "endpoint" && log.entity_id) return `Endpoint ${log.entity_id} ${action}`;
  if (log.entity_id) return `${log.entity_type ?? "Entity"} ${log.entity_id} ${action}`;
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function trafficOpsSeries(traffic: AdminTrafficStats | null): number[] {
  return (traffic?.series ?? []).map((point) => point.ops).filter((value): value is number => value != null && Number.isFinite(value));
}

function formatOptionalBytes(value?: number | null): string {
  return value == null ? "" : formatBytes(value);
}

function formatOptionalCompactNumber(value?: number | null): string {
  return value == null ? "" : formatCompactNumber(value);
}

function OnboardingPanel({
  onboarding,
  error,
  dismissBusy,
  onDismiss,
}: {
  onboarding: OnboardingStatus;
  error: string | null;
  dismissBusy: boolean;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const latest = onboarding.journeys?.[0];
  const destination = latest ? `/admin/onboarding?journey=${encodeURIComponent(latest.id)}` : "/admin/onboarding";
  return <section className={cx(uiCardClass, "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between")}>
    <div className="min-w-0">
      <h2 className="ui-body font-semibold text-[var(--ui-text)]">{t(onboardingCopy.title)}</h2>
      <p className={cx("mt-0.5 ui-caption", uiMutedTextClass)}>{t(onboardingCopy.description)}</p>
      {latest && <p className={cx("mt-0.5 ui-caption", uiMutedTextClass)}>{latest.draft.name} · {latest.draft.workspace} · {t(latest.usage_validated ? onboardingCopy.verified : onboardingCopy.unverified)}</p>}
      {error && <p role="alert" className="mt-2 ui-caption">{error}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <WorkspaceDashboardActionLink to={destination}>{t(latest ? onboardingCopy.resume : onboardingCopy.start)}</WorkspaceDashboardActionLink>
      <WorkspaceDashboardAction variant="ghost" size="sm" onClick={onDismiss} disabled={dismissBusy} loading={dismissBusy}>{t(onboardingCopy.dismiss)}</WorkspaceDashboardAction>
    </div>
  </section>;
}

function EndpointHealthSection({ data, loading, unavailableReason, freshnessWarning }: {
  data: WorkspaceEndpointHealthOverviewResponse | null;
  loading: boolean;
  unavailableReason?: string | null;
  freshnessWarning: string | null;
}) {
  const endpoints = unavailableReason ? [] : data?.endpoints.slice(0, MAX_ENDPOINT_ROWS) ?? [];
  return (
    <div className="ui-dashboard-operational-grid">
      <WorkspaceDashboardCard
        title="Endpoint Health"
        presentation="compact"
        action={<WorkspaceDashboardActionLink to="/admin/endpoint-status">Open Endpoint Status</WorkspaceDashboardActionLink>}
      >
        <p className="ui-dashboard-note">Stored healthcheck samples and latency.{data && <> Data refreshed {formatLocalDateTime(data.generated_at)}.</>}</p>
        {freshnessWarning && !unavailableReason && <div className="mt-2"><PageBanner tone="warning">{freshnessWarning}</PageBanner></div>}
        {loading ? <p role="status" className="ui-dashboard-note mt-2">Loading endpoint health…</p> : unavailableReason ? <p role="status" className="ui-dashboard-note mt-2">{unavailableReason}</p> : (
          <>
            <div className="ui-dashboard-badges mt-2">
              <WorkspaceStatusCounter presentation="compact" label="Up" value={data?.up_count} status="up" />
              <WorkspaceStatusCounter presentation="compact" label="Degraded" value={data?.degraded_count} status="degraded" />
              <WorkspaceStatusCounter presentation="compact" label="Down" value={data?.down_count} status="down" />
              <WorkspaceStatusCounter presentation="compact" label="Unknown" value={data?.unknown_count} status="unknown" />
            </div>
            <ul className="ui-dashboard-endpoint-list" aria-label="Endpoint health samples">
              {endpoints.map((endpoint) => <EndpointRow key={endpoint.endpoint_id} endpoint={endpoint} />)}
            </ul>
            {(data?.endpoints.length ?? 0) > MAX_ENDPOINT_ROWS && <p className="ui-dashboard-note">+ {(data?.endpoints.length ?? 0) - MAX_ENDPOINT_ROWS} more endpoint(s)</p>}
          </>
        )}
      </WorkspaceDashboardCard>
      <WorkspaceIncidentsCard
        presentation="compact"
        incidents={unavailableReason ? [] : data?.incidents ?? []}
        loading={loading}
        unavailableReason={unavailableReason}
        incidentHighlightMinutes={data?.incident_highlight_minutes}
        action={{ to: "/admin/endpoint-status", label: "View all incidents" }}
        showEmptyState
      />
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: WorkspaceEndpointHealthEntry }) {
  const stale = isEndpointCheckStale(endpoint.checked_at);
  const checkedAtLabel = endpoint.checked_at ? `Checked ${formatRelativeTime(endpoint.checked_at)}` : "No healthcheck yet";
  return (
    <li className="ui-dashboard-endpoint-row">
      <span className="ui-dashboard-endpoint-name">
        <WorkspaceStatusDot status={endpoint.status} className="shrink-0" />
        <span title={endpoint.name}>{endpoint.name}</span>
      </span>
      <span className="ui-dashboard-endpoint-measurements">
        <span className="ui-dashboard-note">{formatLatency(endpoint.latency_ms)}</span>
        <span className="ui-dashboard-note">{formatCheckMode(endpoint.check_mode)}</span>
      </span>
      <span className="ui-dashboard-endpoint-check" data-stale={stale} title={formatLocalDateTime(endpoint.checked_at)}>{checkedAtLabel}</span>
      <UiBadge tone={endpoint.status === "up" ? "success" : endpoint.status === "degraded" ? "warning" : endpoint.status === "down" ? "danger" : "neutral"} className="ui-dashboard-badge ui-dashboard-endpoint-state">
        {endpoint.status === "up" ? "Up" : endpoint.status === "degraded" ? "Degraded" : endpoint.status === "down" ? "Down" : "Unknown"}
      </UiBadge>
    </li>
  );
}

function StorageTrafficSummary({
  storage,
  storageLoading,
  storageError,
  traffic,
  trafficLoading,
  trafficError,
  healthScore,
  healthScoreLoading,
  healthScoreUnavailableReason,
}: {
  storage: AdminStorageStats | null;
  storageLoading: boolean;
  storageError: string | null;
  traffic: AdminTrafficStats | null;
  trafficLoading: boolean;
  trafficError: string | null;
  healthScore: number | null;
  healthScoreLoading: boolean;
  healthScoreUnavailableReason?: string | null;
}) {
  const storageTotals = storage?.storage_totals;
  const requestsSeries = trafficOpsSeries(traffic);
  const storageReason = storageError || (!storageLoading && !storage ? "Storage metrics are not available." : undefined);
  const trafficReason = trafficError || (!trafficLoading && !traffic ? "Usage logs are not available." : undefined);
  const metrics: WorkspacePlatformMetric[] = [
    {
      label: "Buckets",
      value: storageLoading ? "..." : formatOptionalCompactNumber(storageReason ? null : storageTotals?.bucket_count ?? storage?.total_buckets ?? null),
      tone: "blue",

    },
    {
      label: "Objects",
      value: storageLoading ? "..." : formatOptionalCompactNumber(storageReason ? null : storageTotals?.object_count ?? null),
      tone: "violet",

    },
    {
      label: "Stored data",
      value: storageLoading ? "..." : formatOptionalBytes(storageReason ? null : storageTotals?.used_bytes ?? null),
      tone: "emerald",

    },
    {
      label: "Requests (24h)",
      value: trafficLoading ? "..." : formatOptionalCompactNumber(trafficReason ? null : traffic?.totals.ops ?? null),
      delta: trafficReason ? undefined : traffic?.totals.success_rate != null ? `${formatPercentage(traffic.totals.success_rate * 100)} success` : undefined,
      series: !trafficReason && requestsSeries.length > 0 ? requestsSeries : undefined,
      tone: "blue",

    },
  ];

  return (
    <WorkspaceDashboardCard title="Storage & traffic" presentation="compact">
      <div className="ui-dashboard-metrics">
        {metrics.map((metric) => <WorkspacePlatformMetricCard key={metric.label} metric={metric} />)}
        <WorkspaceAvailabilityMetric score={healthScore} loading={healthScoreLoading} unavailableReason={healthScoreUnavailableReason} />
      </div>
      {storageReason && <p role="status" className="ui-dashboard-note mt-2">Storage: {storageReason}</p>}
      {trafficReason && <p role="status" className="ui-dashboard-note mt-2">Traffic: {trafficReason}</p>}
    </WorkspaceDashboardCard>
  );
}

function RecentActivityCard({ logs, loading, unavailableReason }: {
  logs: AuditLogEntry[];
  loading: boolean;
  unavailableReason?: string | null;
}) {
  return (
    <WorkspaceDashboardCard title="Recent activity" presentation="compact">
      {loading ? <p role="status" className="ui-dashboard-note">Loading activity…</p> : unavailableReason ? <p role="status" className="ui-dashboard-note">{unavailableReason}</p> : logs.length === 0 ? <p className="ui-dashboard-note">No recent audit activity.</p> : (
        <ul className="ui-dashboard-activity">
          {logs.slice(0, 3).map((log) => (
            <li key={log.id}>
              <span className="ui-dashboard-note ui-dashboard-activity-text">{formatAuditAction(log)}</span>
              <span className="ui-dashboard-note" title={formatLocalDateTime(log.created_at)}>{formatRelativeTime(log.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="ui-dashboard-panel-footer">
        <WorkspaceDashboardActionLink to="/admin/audit">View audit logs<OpenIcon className="h-3.5 w-3.5" /></WorkspaceDashboardActionLink>
      </div>
    </WorkspaceDashboardCard>
  );
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [endpointFreshnessWarning, setEndpointFreshnessWarning] = useState<string | null>(null);
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);
  const [mapEndpoints, setMapEndpoints] = useState<StorageEndpoint[]>([]);
  const [mapEndpointsLoading, setMapEndpointsLoading] = useState(false);
  const [mapEndpointsError, setMapEndpointsError] = useState<string | null>(null);
  const [healthOverview, setHealthOverview] = useState<EndpointHealthOverviewResponse | null>(null);
  const [healthOverviewLoading, setHealthOverviewLoading] = useState(false);
  const [healthOverviewError, setHealthOverviewError] = useState<string | null>(null);
  const [storage, setStorage] = useState<AdminStorageStats | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<AdminTrafficStats | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [dismissBusy, setDismissBusy] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { generalSettings } = useGeneralSettings();

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
        setSummaryError(extractApiError(err, "Unable to load admin overview."));
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
    fetchOnboardingStatus()
      .then((data) => {
        if (cancelled) return;
        setOnboarding(data);
        setOnboardingError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setOnboardingError(extractApiError(err, "Unable to load onboarding status."));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    if (summaryLoading) return;
    if (!summary || summary.total_endpoints === 0) {
      setStorage(null);
      setStorageError(null);
      setStorageLoading(false);
      return;
    }
    let cancelled = false;
    setStorageLoading(true);
    setStorageError(null);
    fetchAdminStorage()
      .then((data) => {
        if (cancelled) return;
        setStorage(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setStorage(null);
        setStorageError(extractApiError(err, "Storage metrics are not available."));
      })
      .finally(() => {
        if (!cancelled) setStorageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, summary, summaryLoading]);

  useEffect(() => {
    if (summaryLoading) return;
    if (!summary || summary.total_endpoints === 0) {
      setTraffic(null);
      setTrafficError(null);
      setTrafficLoading(false);
      return;
    }
    let cancelled = false;
    setTrafficLoading(true);
    setTrafficError(null);
    fetchAdminTraffic("day")
      .then((data) => {
        if (cancelled) return;
        setTraffic(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setTraffic(null);
        setTrafficError(extractApiError(err, "Usage logs are not available."));
      })
      .finally(() => {
        if (!cancelled) setTrafficLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, summary, summaryLoading]);

  useEffect(() => {
    let cancelled = false;
    setAuditLoading(true);
    setAuditError(null);
    listAuditLogs({ limit: 3 })
      .then((data) => {
        if (cancelled) return;
        setAuditLogs(data.logs ?? []);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setAuditLogs([]);
        setAuditError(extractApiError(err, "Audit activity is not available."));
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) {
      setEndpointFreshnessWarning(null);
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      setHealthOverview(null);
      setHealthOverviewError(null);
      setHealthOverviewLoading(false);
      return;
    }
    let cancelled = false;
    const verifyEndpointStatusFreshness = async () => {
      try {
        const data = await fetchHealthSummary();
        if (cancelled) return;
        const endpoints = data.endpoints ?? [];
        if (endpoints.length === 0) {
          setEndpointFreshnessWarning("Endpoint Status is enabled, but no endpoint healthcheck data is available.");
          return;
        }
        const now = Date.now();
        let noChecksCount = 0;
        let staleCount = 0;
        for (const endpoint of endpoints) {
          if ((endpoint.error_message ?? "").toLowerCase().includes("no checks yet")) {
            noChecksCount += 1;
            continue;
          }
          const checkedAt = parseBackendIsoDate(endpoint.checked_at);
          if (!checkedAt || now - checkedAt.getTime() > ENDPOINT_STATUS_MAX_AGE_MS) {
            staleCount += 1;
          }
        }
        if (noChecksCount > 0 || staleCount > 0) {
          setEndpointFreshnessWarning(formatEndpointFreshnessWarning(noChecksCount, staleCount, endpoints.length));
          return;
        }
        setEndpointFreshnessWarning(null);
      } catch {
        if (!cancelled) {
          setEndpointFreshnessWarning("Endpoint Status is enabled, but freshness could not be verified.");
        }
      }
    };
    verifyEndpointStatusFreshness();
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) return;
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
        setWorkspaceHealthError(extractApiError(err, "Unable to load workspace endpoint health."));
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceHealthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) {
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
        if (cancelled) return;
        setMapEndpoints(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setMapEndpoints([]);
        setMapEndpointsError(extractApiError(err, "Unable to load endpoint map coordinates."));
      })
      .finally(() => {
        if (!cancelled) {
          setMapEndpointsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) return;
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
        setHealthOverviewError(extractApiError(err, "7-day endpoint health history is not available."));
      })
      .finally(() => {
        if (!cancelled) {
          setHealthOverviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  const handleDismissOnboarding = async () => {
    if (!onboarding) return;
    setDismissBusy(true);
    try {
      const data = await dismissOnboarding();
      setOnboarding(data);
    } catch (err) {
      setOnboardingError(extractApiError(err, "Unable to dismiss onboarding yet."));
    } finally {
      setDismissBusy(false);
    }
  };

  const coreFeatures = useMemo<WorkspaceDashboardFeature[]>(
    () => [
      { id: "manager", label: "Manager", enabled: generalSettings.manager_enabled },
      { id: "browser", label: "Browser", enabled: generalSettings.browser_enabled },
      { id: "portal", label: "Portal", enabled: generalSettings.portal_enabled },
      { id: "ceph_admin", label: "Ceph Admin", enabled: generalSettings.ceph_admin_enabled, massManagement: true },
      { id: "storage_ops", label: "Storage Ops", enabled: generalSettings.storage_ops_enabled, massManagement: true },
    ],
    [
      generalSettings.browser_enabled,
      generalSettings.ceph_admin_enabled,
      generalSettings.manager_enabled,
      generalSettings.portal_enabled,
      generalSettings.storage_ops_enabled,
    ]
  );

  const extraFeatures = useMemo<WorkspaceDashboardFeature[]>(
    () => [
      { id: "billing", label: "Billing", enabled: generalSettings.billing_enabled },
      { id: "endpoint_status", label: "Endpoint Status", enabled: generalSettings.endpoint_status_enabled },
      { id: "quota_alerts", label: "Quota alerts", enabled: generalSettings.quota_alerts_enabled },
      { id: "usage_history", label: "Usage history", enabled: generalSettings.usage_history_enabled },
    ],
    [
      generalSettings.billing_enabled,
      generalSettings.endpoint_status_enabled,
      generalSettings.quota_alerts_enabled,
      generalSettings.usage_history_enabled,
    ]
  );

  const featureGroups = useMemo<WorkspaceDashboardFeatureGroup[]>(
    () => [
      { title: "Core features", features: coreFeatures },
      { title: "Extra features", features: extraFeatures },
    ],
    [coreFeatures, extraFeatures]
  );

  const administrationItems = useMemo<WorkspaceDashboardSummaryItem[]>(() => {
    const totalUiUsers = (summary?.total_users ?? 0) + (summary?.total_admins ?? 0) + (summary?.total_none_users ?? 0);
    return [
      {
        id: "ui-users",
        label: "UI Users",
        value: totalUiUsers,
        hint: `Admins: ${summary?.total_admins ?? 0}  Users: ${summary?.total_users ?? 0}`,
        to: "/admin/users",
      },
      {
        id: "active-sessions",
        label: "Active Sessions",
        value: summary?.total_active_sessions ?? 0,
        hint: `UI: ${summary?.active_sessions_by_type?.ui ?? 0} · S3: ${summary?.active_sessions_by_type?.s3 ?? 0}`,
        to: "/admin/identity-security",
      },
      {
        id: "accounts-primary",
        label: "Accounts",
        value: summary?.total_accounts ?? 0,
        hint: `Assigned: ${summary?.assigned_accounts ?? 0}`,
        to: "/admin/s3-accounts",
      },
      {
        id: "s3-users",
        label: "S3 Users",
        value: summary?.total_s3_users ?? 0,
        hint: `Assigned: ${summary?.assigned_s3_users ?? 0}`,
        to: "/admin/s3-users",
      },
      {
        id: "shared-s3-connections",
        label: "Shared S3 Connections",
        value: summary?.total_shared_connections ?? 0,
        hint: "Admin-managed",
        to: "/admin/s3-connections",
      },
      {
        id: "endpoints",
        label: "Endpoints",
        value: summary?.total_endpoints ?? 0,
        hint: `Ceph: ${summary?.total_ceph_endpoints ?? 0}  Other: ${summary?.total_other_endpoints ?? 0}`,
        to: "/admin/storage-endpoints",
      },
    ];
  }, [summary]);

  const mapMarkers = useMemo<AdminDashboardMapMarker[]>(() => {
    const statusByEndpointId = new Map<number, HealthCheckStatus>();
    workspaceHealth?.endpoints.forEach((endpoint) => {
      statusByEndpointId.set(endpoint.endpoint_id, endpoint.status);
    });
    return mapEndpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      latitude: endpoint.latitude,
      longitude: endpoint.longitude,
      status: statusByEndpointId.get(endpoint.id) ?? "unknown",
    }));
  }, [mapEndpoints, workspaceHealth]);

  const endpointUnavailableReason = !generalSettings.endpoint_status_enabled
    ? "Endpoint Status feature is disabled."
    : workspaceHealthError
      ? workspaceHealthError
      : !workspaceHealthLoading && workspaceHealth && workspaceHealth.endpoint_count === 0
        ? "Endpoint Status has no endpoint data yet."
        : null;
  const healthScore = computeMeanAvailability(healthOverview);
  const healthScoreUnavailableReason =
    (!generalSettings.endpoint_status_enabled ? "Endpoint Status feature is disabled." : null) ||
    healthOverviewError ||
    (healthScore == null && !healthOverviewLoading ? "7-day endpoint health history is not available." : null);
  const refreshing =
    summaryLoading ||
    storageLoading ||
    trafficLoading ||
    auditLoading ||
    workspaceHealthLoading ||
    healthOverviewLoading ||
    mapEndpointsLoading;

  return (
    <div className="ui-dashboard-compact" data-testid="admin-dashboard">
      <PageHeader
        title="Admin overview"
        description="Monitor the health and status of your S3 infrastructure."
        breadcrumbs={adminPageBreadcrumbs("dashboard")}
        rightContent={
          <div className="flex items-center gap-3">
            <span title="Last data update; healthcheck samples retain their own timestamps." className={cx("hidden ui-caption sm:inline", uiMutedTextClass)}>
              Updated {lastUpdated ? formatLocalDateTime(lastUpdated) : "-"}
            </span>
            <WorkspaceDashboardAction
              type="button"
              onClick={() => setRefreshNonce((current) => current + 1)}
              aria-label="Refresh admin dashboard"
              title="Refresh"
              variant="secondary"
              className="ui-dashboard-action-icon"
              disabled={refreshing}
            >
              <RefreshIcon className={cx("h-4 w-4", refreshing && "animate-spin")} />
            </WorkspaceDashboardAction>
          </div>
        }
      />

      {onboarding && !onboarding.dismissed && (
        <OnboardingPanel
          onboarding={onboarding}
          error={onboardingError}
          dismissBusy={dismissBusy}
          onDismiss={handleDismissOnboarding}
        />
      )}

      <EndpointHealthSection
        data={workspaceHealth}
        loading={workspaceHealthLoading}
        unavailableReason={endpointUnavailableReason}
        freshnessWarning={endpointFreshnessWarning}
      />
      <StorageTrafficSummary
        storage={storage}
        storageLoading={storageLoading}
        storageError={storageError}
        traffic={traffic}
        trafficLoading={trafficLoading}
        trafficError={trafficError}
        healthScore={healthScore}
        healthScoreLoading={healthOverviewLoading}
        healthScoreUnavailableReason={healthScoreUnavailableReason}
      />
      <WorkspaceDashboardSummary items={administrationItems} loading={summaryLoading} unavailableReason={summaryError} />
      <div className="ui-dashboard-secondary-grid">
        <RecentActivityCard logs={auditLogs} loading={auditLoading} unavailableReason={auditError} />
        {generalSettings.endpoint_status_enabled && <AdminDashboardMap markers={mapMarkers} loading={mapEndpointsLoading} error={mapEndpointsError} />}
      </div>
      <WorkspaceDashboardCard title="Enabled features" presentation="compact">
        <div className="ui-dashboard-features">
          {featureGroups.map((group) => <WorkspaceFeatureSummary key={group.title} group={group} />)}
        </div>
      </WorkspaceDashboardCard>
    </div>
  );
}
