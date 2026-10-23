import AdminDashboardMap, { type AdminDashboardMapMarker } from "./components/AdminDashboardMap";
/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { listAuditLogs, type AuditLogEntry } from "../../api/audit";
import {
  fetchHealthOverview,
  fetchHealthWorkspaceOverview,
  type EndpointHealthOverviewResponse,
  type WorkspaceEndpointHealthEntry,
  type WorkspaceEndpointHealthOverviewResponse,
} from "../../api/healthchecks";
import { dismissOnboarding, type OnboardingStatus } from "../../api/onboarding";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import {
  type AdminDashboardStorage,
  type AdminDashboardScope,
  type AdminDashboardCoverage,
  type AdminSummary,
  type AdminDashboardTraffic,
  fetchAdminDashboardScope,
  fetchAdminDashboardStorage,
  fetchAdminSummary,
  fetchAdminDashboardTraffic,
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
  type WorkspacePlatformMetric,
  WorkspacePlatformMetricCard,
  WorkspaceStatusDot,
  WorkspaceStatusCounter,
} from "../../components/WorkspaceDashboardKit";
import WorkspaceIncidentsCard from "../../components/WorkspaceIncidentsCard";
import WorkspaceDashboardInfo from "../../components/WorkspaceDashboardInfo";
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
import { useOnboardingStatus } from "./useOnboardingStatus";
import { adminDashboardSourceText, useAdminDashboardI18n } from "./adminDashboardMessages";

type AdminDashboardText = ReturnType<typeof useAdminDashboardI18n>["text"];

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

function formatRelativeTime(value: string | null | undefined, text: AdminDashboardText, now = Date.now()): string {
  const parsed = parseBackendIsoDate(value);
  if (!parsed) return text("dateUnavailable");
  const diffMs = Math.max(0, now - parsed.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return text("justNow");
  if (minutes < 60) return text("minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return text("hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return text("daysAgo", { count: days });
}

function formatStaleThreshold(seconds: number | undefined, text: AdminDashboardText): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds % 3600 === 0) return text("hours", { count: seconds / 3600 });
  if (seconds % 60 === 0) return text("minutes", { count: seconds / 60 });
  return text("seconds", { count: seconds });
}

function formatEndpointFreshnessWarning(data: WorkspaceEndpointHealthOverviewResponse, text: AdminDashboardText): string | null {
  if (data.endpoint_count === 0) {
    return text("noHealthcheckData");
  }
  const staleCount = data.endpoints.filter((endpoint) => endpoint.is_stale === true).length;
  if (staleCount === 0) return null;
  const threshold = formatStaleThreshold(data.stale_after_seconds, text);
  const thresholdDetail = threshold ? text("staleAfter", { threshold }) : "";
  return text("staleHealthcheckData", { count: staleCount, total: data.endpoint_count, threshold: thresholdDetail });
}

function formatLatency(value?: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value)} ms`;
}

function formatCheckMode(mode?: string | null): string {
  return (mode || "http").toUpperCase();
}

function computeMeanAvailability(data: EndpointHealthOverviewResponse | null, scope: AdminDashboardScope | null): number | null {
  const ids = new Set(scope?.endpoints.map((endpoint) => endpoint.endpoint_id));
  const availabilityValues =
    data?.endpoints
      .filter((endpoint) => ids.has(endpoint.endpoint_id))
      .map((endpoint) => endpoint.availability_pct)
      .filter((value): value is number => value != null && Number.isFinite(value)) ?? [];
  if (availabilityValues.length === 0) return null;
  const totalAvailability = availabilityValues.reduce((total, value) => total + value, 0);
  return Math.round(totalAvailability / availabilityValues.length);
}

function formatAuditAction(log: AuditLogEntry, text: AdminDashboardText): string {
  const action = log.action.replace(/[._-]+/g, " ").trim();
  if (log.action.includes("login")) return text("userLoggedIn", { email: log.user_email });
  if (log.entity_type === "bucket" && log.entity_id) return text("bucketAction", { id: log.entity_id, action });
  if (log.entity_type === "endpoint" && log.entity_id) return text("endpointAction", { id: log.entity_id, action });
  if (log.entity_id) return text("entityAction", { entity: log.entity_type ?? text("entity"), id: log.entity_id, action });
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function trafficOpsSeries(traffic: AdminDashboardTraffic | null): number[] {
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
  const latest = onboarding.journeys?.find((item) => !item.configured);
  const destination = latest ? `/admin/onboarding?journey=${encodeURIComponent(latest.id)}` : "/admin/onboarding";
  return <section className={cx(uiCardClass, "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between")}>
    <div className="min-w-0">
      <h2 className="ui-body font-semibold text-[var(--ui-text)]">{t(onboardingCopy.title)}</h2>
      <p className={cx("mt-0.5 ui-caption", uiMutedTextClass)}>{t(onboardingCopy.description)}</p>
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
  const { text } = useAdminDashboardI18n();
  const endpoints = unavailableReason ? [] : data?.endpoints.slice(0, MAX_ENDPOINT_ROWS) ?? [];
  return (
    <div className="ui-dashboard-operational-grid">
      <WorkspaceDashboardCard
        title={text("endpointHealth")}
        action={<WorkspaceDashboardActionLink to="/admin/endpoint-status">{text("openEndpointStatus")}</WorkspaceDashboardActionLink>}
      >
        <p className="ui-dashboard-note">{text("healthSamples")}{data && <>{text("dataRefreshed", { timestamp: formatLocalDateTime(data.generated_at) })}</>}</p>
        {freshnessWarning && !unavailableReason && <div className="mt-2"><PageBanner tone="warning">{freshnessWarning}</PageBanner></div>}
        {loading ? <p role="status" className="ui-dashboard-note mt-2">{text("loadingHealth")}</p> : unavailableReason ? <p role="status" className="ui-dashboard-note mt-2">{unavailableReason}</p> : (
          <>
            <div className="ui-dashboard-badges mt-2">
              <WorkspaceStatusCounter label={text("status_up")} value={data?.up_count} status="up" />
              <WorkspaceStatusCounter label={text("status_degraded")} value={data?.degraded_count} status="degraded" />
              <WorkspaceStatusCounter label={text("status_down")} value={data?.down_count} status="down" />
              <WorkspaceStatusCounter label={text("status_unknown")} value={data?.unknown_count} status="unknown" />
            </div>
            <ul className="ui-dashboard-endpoint-list" aria-label={text("endpointHealthSamples")}>
              {endpoints.map((endpoint) => <EndpointRow key={endpoint.endpoint_id} endpoint={endpoint} />)}
            </ul>
            {(data?.endpoints.length ?? 0) > MAX_ENDPOINT_ROWS && <p className="ui-dashboard-note">{text("moreEndpoints", { count: (data?.endpoints.length ?? 0) - MAX_ENDPOINT_ROWS })}</p>}
          </>
        )}
      </WorkspaceDashboardCard>
      <WorkspaceIncidentsCard
        incidents={unavailableReason ? [] : data?.incidents ?? []}
        loading={loading}
        unavailableReason={unavailableReason}
        incidentHighlightMinutes={data?.incident_highlight_minutes}
        action={{ to: "/admin/endpoint-status", label: text("allIncidents") }}
        showEmptyState
      />
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: WorkspaceEndpointHealthEntry }) {
  const { text } = useAdminDashboardI18n();
  const stale = endpoint.is_stale === true;
  const effectiveStatus = stale ? "unknown" : endpoint.status;
  const checkedAtLabel = endpoint.checked_at
    ? text("checked", { time: formatRelativeTime(endpoint.checked_at, text), stale: stale ? text("stale") : "" })
    : text("noHealthcheck");
  return (
    <li className="ui-dashboard-endpoint-row">
      <span className="ui-dashboard-endpoint-name">
        <WorkspaceStatusDot status={effectiveStatus} className="shrink-0" />
        <span title={endpoint.name}>{endpoint.name}</span>
      </span>
      <span className="ui-dashboard-endpoint-measurements">
        <span className="ui-dashboard-note">{formatLatency(endpoint.latency_ms)}</span>
        <span className="ui-dashboard-note">{formatCheckMode(endpoint.check_mode)}</span>
      </span>
      <span className="ui-dashboard-endpoint-check" data-stale={stale} title={formatLocalDateTime(endpoint.checked_at)}>{checkedAtLabel}</span>
      <UiBadge tone={effectiveStatus === "up" ? "success" : effectiveStatus === "degraded" ? "warning" : effectiveStatus === "down" ? "danger" : "neutral"} className="ui-dashboard-badge ui-dashboard-endpoint-state">
        {text(effectiveStatus === "up" ? "status_up" : effectiveStatus === "degraded" ? "status_degraded" : effectiveStatus === "down" ? "status_down" : "status_unknown")}
      </UiBadge>
    </li>
  );
}

function coverageLabel(coverage?: AdminDashboardCoverage): string {
  return coverage ? `${coverage.complete_count}/${coverage.eligible_count}` : "—";
}

function coverageNote(coverage: AdminDashboardCoverage | undefined, text: AdminDashboardText): string | null {
  if (!coverage || coverage.eligible_count === 0) return null;
  if (coverage.complete_count === coverage.eligible_count) return null;
  const details = coverage.issues.map((issue) => {
    if (!issue.endpoint_url) return `${issue.name}: ${issue.reason}`;
    const reason = issue.reason
      .replace(/(?:<|\[)redacted-endpoint(?:>|\]):\s*/gi, "")
      .trim();
    return `${issue.name} — ${issue.endpoint_url}: ${reason}`;
  }).join("; ");
  const prefix = text(coverage.contributing_count > 0 ? "partialData" : "dataUnavailable");
  return text("coverageNote", { prefix, complete: coverage.complete_count, total: coverage.eligible_count, details: details ? ` ${details}` : "" });
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
  availabilityCoverage,
  availabilityNote,
}: {
  storage: AdminDashboardStorage | null;
  storageLoading: boolean;
  storageError: string | null;
  traffic: AdminDashboardTraffic | null;
  trafficLoading: boolean;
  trafficError: string | null;
  healthScore: number | null;
  healthScoreLoading: boolean;
  healthScoreUnavailableReason?: string | null;
  availabilityCoverage: string;
  availabilityNote: string | null;
}) {
  const { text } = useAdminDashboardI18n();
  const storageTotals = storage?.storage_totals;
  const requestsSeries = trafficOpsSeries(traffic);
  const storageReason = storageError || (!storageLoading && !storage ? text("storageUnavailable") : storage?.coverage?.eligible_count === 0 ? text("noStorageEndpoint") : undefined);
  const trafficReason = trafficError || (!trafficLoading && !traffic ? text("trafficUnavailable") : traffic?.coverage?.eligible_count === 0 ? text("noTrafficEndpoint") : undefined);
  const status = (label: string, loading: boolean, reason?: string | null, coverage?: AdminDashboardCoverage) => {
    if (loading) return null;
    if (reason || (coverage && coverage.contributing_count === 0)) return text("unavailableStatus", { label });
    if (coverage && coverage.complete_count < coverage.eligible_count) return text("partialStatus", { label });
    return null;
  };
  const statuses = [
    status(text("storage"), storageLoading, storageReason, storage?.coverage),
    status(text("traffic"), trafficLoading, trafficReason, traffic?.coverage),
    healthScoreLoading ? null : healthScoreUnavailableReason ? text("availabilityUnavailable") : availabilityNote ? text("availabilityPartial") : null,
  ].filter((value): value is string => value !== null);
  const metrics: WorkspacePlatformMetric[] = [
    {
      label: text("buckets"),
      value: storageLoading ? "..." : formatOptionalCompactNumber(storageReason ? null : storageTotals?.bucket_count ?? null),
      tone: "blue",
    },
    {
      label: text("objects"),
      value: storageLoading ? "..." : formatOptionalCompactNumber(storageReason ? null : storageTotals?.object_count ?? null),
      tone: "violet",
    },
    {
      label: text("storedData"),
      value: storageLoading ? "..." : formatOptionalBytes(storageReason ? null : storageTotals?.used_bytes ?? null),
      tone: "emerald",
    },
    {
      label: text("requests"),
      value: trafficLoading ? "..." : formatOptionalCompactNumber(trafficReason ? null : traffic?.totals.ops ?? null),
      delta: trafficReason ? undefined : traffic?.totals.success_rate != null ? text("success", { percent: formatPercentage(traffic.totals.success_rate * 100) }) : undefined,
      series: !trafficReason && requestsSeries.length > 0 ? requestsSeries : undefined,
      tone: "blue",
    },
    {
      label: text("availabilityWeek"),
      value: healthScoreLoading ? "…" : healthScore == null || healthScoreUnavailableReason ? "—" : `${healthScore}%`,
      tone: "emerald",
    },
  ];

  return (
    <WorkspaceDashboardCard aria-label={text("storageTraffic")} wrapHeading
      title={text("storageTraffic")}
      titleAccessory={<WorkspaceDashboardInfo label={text("aboutMetrics")}>
          <p className="ui-dashboard-note">{text("aggregation")}</p>
          <table className="ui-dashboard-info-table ui-data-table" aria-label={text("metricCoverage")}>
            <thead><tr><th scope="col">{text("measure")}</th><th scope="col">{text("endpoints")}</th><th scope="col">{text("dataDate")}</th></tr></thead>
            <tbody>
              <tr><td>{text("storage")}</td><td>{storageLoading ? text("loading") : coverageLabel(storage?.coverage)}</td><td>{storage?.generated_at ? <time dateTime={storage.generated_at}>{formatLocalDateTime(storage.generated_at)}</time> : "—"}</td></tr>
              <tr><td>{text("traffic")}</td><td>{trafficLoading ? text("loading") : coverageLabel(traffic?.coverage)}</td><td>{traffic?.end ? <time dateTime={traffic.end}>{formatLocalDateTime(traffic.end)}</time> : "—"}</td></tr>
              <tr><td>{text("availability")}</td><td>{availabilityCoverage}</td><td>{text("weekMean")}</td></tr>
            </tbody>
          </table>
          {storageReason && <p className="ui-dashboard-note mt-2">{text("storageDetail", { reason: storageReason })}</p>}
          {trafficReason && <p className="ui-dashboard-note mt-2">{text("trafficDetail", { reason: trafficReason })}</p>}
          {!storageReason && coverageNote(storage?.coverage, text) && <p className="ui-dashboard-note mt-2">{text("storageDetail", { reason: coverageNote(storage?.coverage, text)! })}</p>}
          {!trafficReason && coverageNote(traffic?.coverage, text) && <p className="ui-dashboard-note mt-2">{text("trafficDetail", { reason: coverageNote(traffic?.coverage, text)! })}</p>}
          {healthScoreUnavailableReason && <p className="ui-dashboard-note mt-2">{text("availabilityDetail", { reason: healthScoreUnavailableReason })}</p>}
          {availabilityNote && <p className="ui-dashboard-note mt-2">{text("availabilityDetail", { reason: availabilityNote })}</p>}
          <p className="ui-dashboard-note mt-2">{text("coverageHelp")}</p>
          <p className="ui-dashboard-note mt-2">{text("availabilityHelp")}</p>
          <p className="ui-dashboard-note mt-2">{text("cacheHelp")}</p>
        </WorkspaceDashboardInfo>}
      action={statuses.length > 0 ? <span role="status" className="ui-dashboard-badges">{statuses.map(label => <UiBadge key={label} tone="warning" className="ui-dashboard-badge">{label}</UiBadge>)}</span> : undefined}
    >
      <p className="ui-dashboard-note">{text("supervisedCeph")}</p>
      <div className="ui-dashboard-metrics mt-2">
        {metrics.map((metric) => <WorkspacePlatformMetricCard key={metric.label} metric={metric} />)}
      </div>
    </WorkspaceDashboardCard>
  );
}

function RecentActivityCard({ logs, loading, unavailableReason }: {
  logs: AuditLogEntry[];
  loading: boolean;
  unavailableReason?: string | null;
}) {
  const { text } = useAdminDashboardI18n();
  return (
    <WorkspaceDashboardCard
      title={text("recentActivity")}
      action={<WorkspaceDashboardActionLink to="/admin/audit">{text("auditLogs")}<OpenIcon className="h-3.5 w-3.5" /></WorkspaceDashboardActionLink>}
    >
      {loading ? <p role="status" className="ui-dashboard-note">{text("loadingActivity")}</p> : unavailableReason ? <p role="status" className="ui-dashboard-note">{unavailableReason}</p> : logs.length === 0 ? <p className="ui-dashboard-note">{text("noActivity")}</p> : (
        <ul className="ui-dashboard-activity">
          {logs.slice(0, 6).map((log) => (
            <li key={log.id}>
              <span className="ui-dashboard-note ui-dashboard-activity-text">{formatAuditAction(log, text)}</span>
              <span className="ui-dashboard-note" title={formatLocalDateTime(log.created_at)}>{formatRelativeTime(log.created_at, text)}</span>
            </li>
          ))}
        </ul>
      )}
    </WorkspaceDashboardCard>
  );
}

export default function AdminDashboard() {
  const { text, translateText } = useAdminDashboardI18n();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [onboardingActionError, setOnboardingActionError] = useState<string | null>(null);
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
  const [dismissBusy, setDismissBusy] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { generalSettings } = useGeneralSettings();
  const {
    status: onboarding,
    error: onboardingStatusError,
    setStatus: setOnboarding,
  } = useOnboardingStatus();

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
      .then((data) => { if (!cancelled) setDashboardScope(data); })
      .catch((err) => { if (!cancelled) setScopeError(extractApiError(err, adminDashboardSourceText("loadScopeError"))); })
      .finally(() => { if (!cancelled) setScopeLoading(false); });
    return () => { cancelled = true; };
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
        setAuditLogs(data.logs ?? []);
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
    if (!generalSettings.endpoint_status_enabled) {
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
        if (!cancelled) {
          setWorkspaceHealthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  const endpointFreshnessWarning = useMemo(
    () => (workspaceHealth ? formatEndpointFreshnessWarning(workspaceHealth, text) : null),
    [workspaceHealth, text],
  );

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
        setMapEndpointsError(extractApiError(err, adminDashboardSourceText("loadMapError")));
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
        setHealthOverviewError(extractApiError(err, adminDashboardSourceText("healthHistoryUnavailable")));
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
    setOnboardingActionError(null);
    try {
      const data = await dismissOnboarding();
      setOnboarding(data);
    } catch (err) {
      setOnboardingActionError(extractApiError(err, adminDashboardSourceText("hideSetupError")));
    } finally {
      setDismissBusy(false);
    }
  };

  const coreFeatures = useMemo<WorkspaceDashboardFeature[]>(
    () => [
      { id: "manager", label: text("manager"), enabled: generalSettings.manager_enabled },
      { id: "browser", label: text("browser"), enabled: generalSettings.browser_enabled },
      { id: "portal", label: text("portal"), enabled: generalSettings.portal_enabled },
      { id: "ceph_admin", label: text("cephAdmin"), enabled: generalSettings.ceph_admin_enabled, massManagement: true },
      { id: "storage_ops", label: text("storageOps"), enabled: generalSettings.storage_ops_enabled, massManagement: true },
    ],
    [
      generalSettings.browser_enabled,
      generalSettings.ceph_admin_enabled,
      generalSettings.manager_enabled,
      generalSettings.portal_enabled,
      generalSettings.storage_ops_enabled,
      text,
    ]
  );

  const extraFeatures = useMemo<WorkspaceDashboardFeature[]>(
    () => [
      { id: "cost", label: text("cost"), enabled: generalSettings.cost_enabled },
      { id: "endpoint_status", label: text("endpointStatus"), enabled: generalSettings.endpoint_status_enabled },
      { id: "quota_alerts", label: text("quotaAlerts"), enabled: generalSettings.quota_alerts_enabled },
      { id: "usage_history", label: text("usageHistory"), enabled: generalSettings.usage_history_enabled },
    ],
    [
      generalSettings.cost_enabled,
      generalSettings.endpoint_status_enabled,
      generalSettings.quota_alerts_enabled,
      generalSettings.usage_history_enabled,
      text,
    ]
  );

  const featureGroups = useMemo<WorkspaceDashboardFeatureGroup[]>(
    () => [
      { title: text("coreFeatures"), features: coreFeatures },
      { title: text("extraFeatures"), features: extraFeatures },
    ],
    [coreFeatures, extraFeatures, text]
  );

  const administrationItems = useMemo<WorkspaceDashboardSummaryItem[]>(() => {
    const totalUiUsers = (summary?.total_users ?? 0) + (summary?.total_admins ?? 0) + (summary?.total_none_users ?? 0);
    return [
      {
        id: "ui-users",
        label: text("uiUsers"),
        value: totalUiUsers,
        hint: text("userCounts", { admins: summary?.total_admins ?? 0, users: summary?.total_users ?? 0 }),
        to: "/admin/users",
      },
      {
        id: "active-sessions",
        label: text("activeSessions"),
        value: summary?.total_active_sessions ?? 0,
        hint: text("sessionCounts", { ui: summary?.active_sessions_by_type?.ui ?? 0, s3: summary?.active_sessions_by_type?.s3 ?? 0 }),
        to: "/admin/identity-security",
      },
      {
        id: "accounts-primary",
        label: text("accounts"),
        value: summary?.total_accounts ?? 0,
        hint: text("assigned", { count: summary?.assigned_accounts ?? 0 }),
        to: "/admin/s3-accounts",
      },
      {
        id: "s3-users",
        label: text("s3Users"),
        value: summary?.total_s3_users ?? 0,
        hint: text("assigned", { count: summary?.assigned_s3_users ?? 0 }),
        to: "/admin/s3-users",
      },
      {
        id: "shared-s3-connections",
        label: text("sharedConnections"),
        value: summary?.total_shared_connections ?? 0,
        hint: text("adminManaged"),
        to: "/admin/s3-connections",
      },
      {
        id: "endpoints",
        label: text("endpoints"),
        value: summary?.total_endpoints ?? 0,
        hint: text("endpointCounts", { ceph: summary?.total_ceph_endpoints ?? 0, other: summary?.total_other_endpoints ?? 0 }),
        to: "/admin/storage-endpoints",
      },
    ];
  }, [summary, text]);

  const mapMarkers = useMemo<AdminDashboardMapMarker[]>(() => {
    const healthByEndpointId = new Map<number, WorkspaceEndpointHealthEntry>();
    workspaceHealth?.endpoints.forEach((endpoint) => {
      healthByEndpointId.set(endpoint.endpoint_id, endpoint);
    });
    return mapEndpoints.map((endpoint) => {
      const health = healthByEndpointId.get(endpoint.id);
      return {
        id: endpoint.id,
        name: endpoint.name,
        endpointUrl: endpoint.endpoint_url,
        provider: endpoint.provider,
        region: endpoint.region,
        isDefault: endpoint.is_default,
        latitude: endpoint.latitude,
        longitude: endpoint.longitude,
        status: health?.is_stale ? "unknown" : (health?.status ?? "unknown"),
        latencyMs: health?.latency_ms,
      };
    });
  }, [mapEndpoints, workspaceHealth]);

  const endpointUnavailableReason = !generalSettings.endpoint_status_enabled
    ? text("endpointStatusDisabled")
    : workspaceHealthError
      ? translateText(workspaceHealthError)
      : !workspaceHealthLoading && workspaceHealth && workspaceHealth.endpoint_count === 0
        ? text("noEndpointData")
        : null;
  const healthScore = computeMeanAvailability(healthOverview, dashboardScope);
  const measuredIds = new Set(healthOverview?.endpoints.filter((endpoint) => endpoint.availability_pct != null && Number.isFinite(endpoint.availability_pct)).map((endpoint) => endpoint.endpoint_id));
  const missingHealth = dashboardScope?.endpoints.filter((endpoint) => !measuredIds.has(endpoint.endpoint_id)) ?? [];
  const availabilityLoading = scopeLoading || healthOverviewLoading;
  const availabilityCoverage = availabilityLoading ? text("loading") : dashboardScope && generalSettings.endpoint_status_enabled && !healthOverviewError
    ? `${dashboardScope.endpoints.length - missingHealth.length}/${dashboardScope.endpoints.length}` : "—";
  const availabilityNote = !availabilityLoading && generalSettings.endpoint_status_enabled && !healthOverviewError && missingHealth.length > 0
    ? text("missingWeekMeasurements", { endpoints: missingHealth.map((endpoint) => endpoint.name).join(", ") }) : null;
  const healthScoreUnavailableReason =
    (!generalSettings.endpoint_status_enabled ? text("endpointStatusDisabled") : null) ||
    (scopeError ? translateText(scopeError) : null) ||
    (healthOverviewError ? translateText(healthOverviewError) : null) ||
    (dashboardScope?.endpoints.length === 0 ? text("noSupervisedEndpoint") : null) ||
    (healthScore == null && !healthOverviewLoading ? text("healthHistoryUnavailable") : null);
  const refreshing =
    summaryLoading ||
    scopeLoading ||
    storageLoading ||
    trafficLoading ||
    auditLoading ||
    workspaceHealthLoading ||
    healthOverviewLoading ||
    mapEndpointsLoading;

  return (
    <div className="ui-dashboard-compact" data-testid="admin-dashboard">
      <PageHeader
        title={text("title")}
        description={text("description")}
        breadcrumbs={adminPageBreadcrumbs("dashboard").map((breadcrumb) => ({ ...breadcrumb, label: text(breadcrumb.to === "/admin" ? "admin" : "dashboard") }))}
        rightContent={
          <div className="flex items-center gap-3">
            <span title={text("lastRetrievalHelp")} className={cx("hidden ui-caption sm:inline", uiMutedTextClass)}>
              {text("updated", { timestamp: lastUpdated ? formatLocalDateTime(lastUpdated) : "-" })}
            </span>
            <WorkspaceDashboardAction
              type="button"
              onClick={() => setRefreshNonce((current) => current + 1)}
              aria-label={text("refresh")}
              title={text("refreshHelp")}
              variant="secondary"
              className="ui-dashboard-action-icon"
              disabled={refreshing}
            >
              <RefreshIcon className={cx("h-4 w-4", refreshing && "animate-spin")} />
            </WorkspaceDashboardAction>
          </div>
        }
      />

      {onboarding && !onboarding.dismissed && !onboarding.complete && (
        <OnboardingPanel
          onboarding={onboarding}
          error={onboardingActionError || onboardingStatusError ? translateText((onboardingActionError || onboardingStatusError)!) : null}
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
        storageError={storageError ? translateText(storageError) : null}
        traffic={traffic}
        trafficLoading={trafficLoading}
        trafficError={trafficError ? translateText(trafficError) : null}
        healthScore={healthScore}
        healthScoreLoading={availabilityLoading}
        healthScoreUnavailableReason={healthScoreUnavailableReason}
        availabilityCoverage={availabilityCoverage}
        availabilityNote={availabilityNote}
      />
      <WorkspaceDashboardSummary items={administrationItems} loading={summaryLoading} unavailableReason={summaryError ? translateText(summaryError) : null} title={text("administration")} />
      <div className="ui-dashboard-secondary-grid">
        <RecentActivityCard logs={auditLogs} loading={auditLoading} unavailableReason={auditError ? translateText(auditError) : null} />
        {generalSettings.endpoint_status_enabled && <AdminDashboardMap markers={mapMarkers} loading={mapEndpointsLoading} error={mapEndpointsError ? translateText(mapEndpointsError) : null} />}
      </div>
      <WorkspaceDashboardCard title={text("enabledFeatures")}>
        <div className="ui-dashboard-features">
          {featureGroups.map((group) => <WorkspaceFeatureSummary key={group.title} group={group} />)}
        </div>
      </WorkspaceDashboardCard>
    </div>
  );
}
