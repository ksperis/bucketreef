/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  EndpointHealthGlobalIncident,
  EndpointHealthLatencyOverviewEndpoint,
  EndpointHealthOverviewEndpoint,
  fetchHealthGlobalIncidents,
  fetchHealthLatencyOverview,
  fetchHealthOverview,
  runHealthchecks,
  type HealthCheckStatus,
} from "../../api/healthchecks";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { extractApiError } from "../../utils/apiError";
import {
  EndpointTimelineBar,
  formatCheckMode,
  formatLatency,
  formatPercent,
  formatStatusLabel,
  formatTimestamp,
  StatusPill,
} from "./endpointStatusShared";
import { useEndpointStatusText } from "./endpointStatusMessages";

type WindowOption = { value: "day" | "week" | "month" };
type IncidentWindowOption = { value: "month" | "quarter" | "half_year" };
type IncidentRow = EndpointHealthGlobalIncident & { rowKey: string };

const TIMELINE_WINDOW_OPTIONS: WindowOption[] = [
  { value: "day" },
  { value: "week" },
  { value: "month" },
];

const INCIDENT_WINDOW_OPTIONS: IncidentWindowOption[] = [
  { value: "month" },
  { value: "quarter" },
  { value: "half_year" },
];

function latencyBarClass(status: HealthCheckStatus) {
  if (status === "up") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "down") return "bg-rose-500";
  return "bg-slate-400";
}

const LATENCY_WARNING_MIN_RATIO_PERCENT = 110;
const LATENCY_WARNING_MIN_DELTA_MS = 10;

export function isLatencyMeaningfullyAboveAverage(currentLatency?: number | null, avgLatency?: number | null) {
  if (currentLatency == null || avgLatency == null) return false;
  return (
    currentLatency - avgLatency >= LATENCY_WARNING_MIN_DELTA_MS &&
    currentLatency * 100 >= avgLatency * LATENCY_WARNING_MIN_RATIO_PERCENT
  );
}

function buildStatusCounts(endpoints: EndpointHealthLatencyOverviewEndpoint[]) {
  return endpoints.reduce(
    (acc, endpoint) => {
      acc.total += 1;
      acc[endpoint.status] += 1;
      return acc;
    },
    { total: 0, up: 0, degraded: 0, down: 0, unknown: 0 }
  );
}

export default function EndpointStatusPage() {
  const { text, locale } = useEndpointStatusText();
  const navigate = useNavigate();

  const [latencyEndpoints, setLatencyEndpoints] = useState<EndpointHealthLatencyOverviewEndpoint[]>([]);
  const [latencyUpdatedAt, setLatencyUpdatedAt] = useState<string | null>(null);
  const [latencyLoading, setLatencyLoading] = useState<boolean>(true);
  const [latencyError, setLatencyError] = useState<string | null>(null);

  const [timelineWindow, setTimelineWindow] = useState<WindowOption["value"]>("week");
  const [timelineEndpoints, setTimelineEndpoints] = useState<EndpointHealthOverviewEndpoint[]>([]);
  const [timelineStart, setTimelineStart] = useState<string | null>(null);
  const [timelineEnd, setTimelineEnd] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState<boolean>(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const [incidentWindow, setIncidentWindow] = useState<IncidentWindowOption["value"]>("half_year");
  const [globalIncidents, setGlobalIncidents] = useState<EndpointHealthGlobalIncident[]>([]);
  const [globalIncidentsTotal, setGlobalIncidentsTotal] = useState<number>(0);
  const [incidentsLoading, setIncidentsLoading] = useState<boolean>(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<HealthCheckStatus | "all">("all");

  const loadLatencyOverview = useCallback(async () => {
    setLatencyLoading(true);
    setLatencyError(null);
    try {
      const payload = await fetchHealthLatencyOverview("day");
      setLatencyEndpoints(payload.endpoints ?? []);
      setLatencyUpdatedAt(payload.generated_at ?? null);
    } catch (err) {
      setLatencyEndpoints([]);
      setLatencyError(extractApiError(err, text("latencyOverviewFailed")));
    } finally {
      setLatencyLoading(false);
    }
  }, [text]);

  const loadTimelineOverview = useCallback(async (windowValue: WindowOption["value"]) => {
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const payload = await fetchHealthOverview(windowValue);
      setTimelineEndpoints(payload.endpoints ?? []);
      setTimelineStart(payload.start ?? null);
      setTimelineEnd(payload.end ?? null);
    } catch (err) {
      setTimelineEndpoints([]);
      setTimelineStart(null);
      setTimelineEnd(null);
      setTimelineError(extractApiError(err, text("timelineOverviewFailed")));
    } finally {
      setTimelineLoading(false);
    }
  }, [text]);

  const loadGlobalIncidents = useCallback(async (windowValue: IncidentWindowOption["value"]) => {
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const payload = await fetchHealthGlobalIncidents(windowValue, 300);
      setGlobalIncidents(payload.incidents ?? []);
      setGlobalIncidentsTotal(payload.total ?? 0);
    } catch (err) {
      setGlobalIncidents([]);
      setGlobalIncidentsTotal(0);
      setIncidentsError(extractApiError(err, text("globalIncidentsFailed")));
    } finally {
      setIncidentsLoading(false);
    }
  }, [text]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadLatencyOverview(), loadTimelineOverview(timelineWindow), loadGlobalIncidents(incidentWindow)]);
  }, [incidentWindow, loadGlobalIncidents, loadLatencyOverview, loadTimelineOverview, timelineWindow]);

  const handleRunNow = useCallback(async () => {
    if (runLoading) return;
    setRunLoading(true);
    setActionMessage(null);
    setActionError(null);
    try {
      await runHealthchecks();
      setActionMessage(text("healthchecksExecuted"));
      await loadAll();
    } catch (err) {
      setActionError(extractApiError(err, text("healthchecksRunFailed")));
    } finally {
      setRunLoading(false);
    }
  }, [loadAll, runLoading, text]);

  useEffect(() => {
    loadLatencyOverview();
  }, [loadLatencyOverview]);

  useEffect(() => {
    loadTimelineOverview(timelineWindow);
  }, [timelineWindow, loadTimelineOverview]);

  useEffect(() => {
    loadGlobalIncidents(incidentWindow);
  }, [incidentWindow, loadGlobalIncidents]);

  const stats = useMemo(() => buildStatusCounts(latencyEndpoints), [latencyEndpoints]);
  const filteredLatencyEndpoints = useMemo(
    () => latencyEndpoints.filter((endpoint) => statusFilter === "all" || endpoint.status === statusFilter),
    [latencyEndpoints, statusFilter]
  );
  const filteredTimelineEndpoints = useMemo(
    () => timelineEndpoints.filter((endpoint) => statusFilter === "all" || endpoint.status === statusFilter),
    [timelineEndpoints, statusFilter]
  );
  const filteredGlobalIncidents = useMemo(
    () => globalIncidents.filter((incident) => statusFilter === "all" || incident.status === statusFilter),
    [globalIncidents, statusFilter]
  );
  const incidentRows = useMemo<IncidentRow[]>(
    () =>
      filteredGlobalIncidents.map((incident, index) => ({
        ...incident,
        rowKey: [
          incident.endpoint_id,
          incident.start,
          incident.end ?? "ongoing",
          incident.status,
          incident.check_mode ?? "http",
          incident.check_type ?? "availability",
          incident.scope ?? "endpoint",
          index,
        ].join(":"),
      })),
    [filteredGlobalIncidents]
  );

  const maxOverviewLatency = useMemo(() => {
    const values = filteredLatencyEndpoints
      .map((endpoint) => endpoint.max_latency_ms)
      .filter((value): value is number => value != null && value > 0);
    if (values.length === 0) return 1;
    return Math.max(...values, 1);
  }, [filteredLatencyEndpoints]);
  const incidentsTableStatus = resolveListTableStatus({
    loading: incidentsLoading,
    error: incidentsError,
    rowCount: incidentRows.length,
  });
  const incidentsCountLabel =
    statusFilter === "all"
      ? `${text(globalIncidentsTotal === 1 ? "oneIncident" : "manyIncidents", { count: globalIncidentsTotal })}${
          globalIncidentsTotal > globalIncidents.length ? text("showingFirstIncidents", { count: globalIncidents.length }) : ""
        }`
      : text(globalIncidents.length === 1 ? "matchingIncident" : "matchingIncidents", {
          count: incidentRows.length,
          total: globalIncidents.length,
          status: formatStatusLabel(statusFilter, locale).toLowerCase(),
        });
  const incidentsEmptyMessage =
    statusFilter === "all" ? text("noIncidents") : text("noStatusIncidents", { status: formatStatusLabel(statusFilter, locale).toLowerCase() });
  const incidentTableColumns = useMemo<Array<DataTableColumn<IncidentRow>>>(
    () => [
      {
        id: "endpoint",
        label: text("endpoint"),
        primary: true,
        cellClassName: "min-w-[16rem]",
        render: (incident) => (
          <span className="block max-w-full">
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{incident.endpoint_name}</p>
            <p className="break-all ui-caption text-slate-500 dark:text-slate-400">{incident.endpoint_url || "-"}</p>
          </span>
        ),
      },
      {
        id: "status",
        label: text("status"),
        render: (incident) => <StatusPill status={incident.status} />,
      },
      {
        id: "start",
        label: text("start"),
        cellClassName: "whitespace-nowrap ui-caption text-slate-500 dark:text-slate-400",
        render: (incident) => formatTimestamp(incident.start, locale),
      },
      {
        id: "end",
        label: text("end"),
        cellClassName: "whitespace-nowrap ui-caption text-slate-500 dark:text-slate-400",
        render: (incident) => (incident.end ? formatTimestamp(incident.end, locale) : text("ongoing")),
      },
      {
        id: "duration",
        label: text("duration"),
        cellClassName: "whitespace-nowrap ui-caption text-slate-500 dark:text-slate-400",
        render: (incident) => (incident.duration_minutes != null ? `${incident.duration_minutes} ${text("minuteUnit")}` : "-"),
      },
      {
        id: "type",
        label: text("type"),
        cellClassName: "min-w-[14rem] ui-caption text-slate-500 dark:text-slate-400",
        render: (incident) => {
          const checkType = incident.check_type || "availability";
          const scope = incident.scope || "endpoint";
          const typeLabel = checkType === "availability" ? text("checkTypeAvailability") : checkType === "latency" ? text("checkTypeLatency") : checkType.toUpperCase();
          const scopeLabel = scope === "endpoint" ? text("checkScopeEndpoint") : scope.toUpperCase();
          return `${typeLabel} · ${scopeLabel} · ${formatCheckMode(incident.check_mode)}`;
        },
      },
      {
        id: "actions",
        label: text("actions"),
        align: "right",
        mobileRole: "actions",
        render: (incident) => (
          <ListActionButton
            type="button"
            onClick={() => navigate(`/admin/endpoint-status/${incident.endpoint_id}`)}
            {...dataTableDefaultActionProps}
          >
            {text("open")}
          </ListActionButton>
        ),
      },
    ],
    [locale, navigate, text]
  );

  return (
    <PageShell actionPresentation="listing"
      title={text("title")}
      description={text("description")}
      breadcrumbs={adminPageBreadcrumbs("endpoint-status").map((breadcrumb, index) => ({ ...breadcrumb, label: text(index === 0 ? "admin" : "title") }))}
      actions={[
        { label: runLoading ? text("running") : text("checkNow"), onClick: handleRunNow, disabled: import.meta.env.MODE === "demo" },
        { label: text("refresh"), onClick: loadAll, variant: "ghost" },
      ]}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={text("globalStatusFilter")}>
          {[
            { key: "all" as const, label: text("all"), value: stats.total },
            { key: "up" as const, label: text("status_up"), value: stats.up },
            { key: "degraded" as const, label: text("status_degraded"), value: stats.degraded },
            { key: "down" as const, label: text("status_down"), value: stats.down },
            { key: "unknown" as const, label: text("status_unknown"), value: stats.unknown },
          ].map((item) => (
            <ListActionButton key={item.key} aria-pressed={statusFilter === item.key}
              variant={item.value === 0 || latencyLoading || latencyError ? "secondary" : item.key === "down" ? "danger" : item.key === "degraded" ? "warning" : item.key === "up" ? "success" : "secondary"}
              onClick={() => setStatusFilter((current) => current === item.key ? "all" : item.key)}>
              {item.label} <span>{latencyLoading ? "…" : latencyError ? "—" : item.value}</span>
            </ListActionButton>
          ))}
        </div>
        <span className="text-xs text-[var(--ui-text-muted)]">{text("updated", { timestamp: latencyLoading ? text("loading") : latencyError ? text("unavailable") : latencyUpdatedAt ? formatTimestamp(latencyUpdatedAt, locale) : text("unavailable") })}</span>
      </div>

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {latencyError && <PageBanner tone="error">{latencyError}</PageBanner>}
      {timelineError && <PageBanner tone="error">{timelineError}</PageBanner>}
      {incidentsError && <PageBanner tone="error">{incidentsError}</PageBanner>}

      <div className="ui-surface-card">
        <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{text("endpointLatency")}</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {text("latencyDescription")}
          </p>
        </div>
        <div className="px-4 py-4 sm:px-6">
          {latencyLoading && <p className="ui-body text-slate-500 dark:text-slate-400">{text("latencyLoading")}</p>}
          {!latencyLoading && filteredLatencyEndpoints.length === 0 && (
            <p className="ui-body text-slate-500 dark:text-slate-400">{text("noEndpointsForFilter")}</p>
          )}
          {!latencyLoading && filteredLatencyEndpoints.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredLatencyEndpoints.map((endpoint) => {
                const currentLatency = endpoint.status === "down" ? null : endpoint.latency_ms;
                const minLatency = endpoint.min_latency_ms ?? null;
                const avgLatency = endpoint.avg_latency_ms ?? null;
                const maxLatency = endpoint.max_latency_ms ?? null;
                const currentAboveAverage = isLatencyMeaningfullyAboveAverage(currentLatency, avgLatency);
                const relativePct = currentLatency == null ? null : Math.round((currentLatency / maxOverviewLatency) * 100);
                const relativeWidth = relativePct == null ? 0 : Math.max(8, Math.min(100, relativePct));
                const minMarkerPct = minLatency == null ? null : Math.max(0, Math.min(100, (minLatency / maxOverviewLatency) * 100));
                const maxMarkerPct = maxLatency == null ? null : Math.max(0, Math.min(100, (maxLatency / maxOverviewLatency) * 100));
                const relativeLabel = relativePct == null ? text("noLatencySample") : text("relativeLatency", { percent: relativePct });

                return (
                  <button
                    key={endpoint.endpoint_id}
                    type="button"
                    onClick={() => navigate(`/admin/endpoint-status/${endpoint.endpoint_id}`)}
                    className="rounded-lg border border-slate-200/90 bg-white p-3 text-left transition hover:-translate-y-[1px] hover:border-primary/50 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate ui-caption font-semibold text-slate-900 dark:text-slate-100">{endpoint.name}</p>
                      <StatusPill status={endpoint.status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{text("currentLatency")}</p>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{formatLatency(currentLatency)}</p>
                    </div>
                    <div className="relative mt-1 h-2.5">
                      <div className="absolute inset-x-0 top-0.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" />
                      {minMarkerPct != null && (
                        <div className="absolute top-0 h-2.5 w-px bg-slate-500/80 dark:bg-slate-300/80" style={{ left: `${minMarkerPct}%` }} />
                      )}
                      {maxMarkerPct != null && (
                        <div className="absolute top-0 h-2.5 w-px bg-slate-700 dark:bg-slate-100" style={{ left: `${maxMarkerPct}%` }} />
                      )}
                      {currentLatency != null && (
                        <div
                          className={`absolute left-0 top-0.5 h-1.5 rounded-full ${currentAboveAverage ? "bg-amber-500" : latencyBarClass(endpoint.status)}`}
                          style={{ width: `${relativeWidth}%` }}
                        />
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{relativeLabel}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{formatCheckMode(endpoint.check_mode)}</p>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{text("minLatency", { latency: formatLatency(minLatency) })}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{text("avgLatency", { latency: formatLatency(avgLatency) })}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{text("maxLatency", { latency: formatLatency(maxLatency) })}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="ui-surface-card">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{text("endpointTimelines")}</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {text("timelinesDescription")}
            </p>
          </div>
          <UiSegmentedControl
            ariaLabel={text("timelineWindow")}
            options={TIMELINE_WINDOW_OPTIONS.map(({ value }) => ({ value, label: text(`windowLabel_${value}`), helper: text(`windowHelp_${value}`) }))}
            value={timelineWindow}
            onChange={setTimelineWindow}
          />
        </div>
        <div className="space-y-3 px-6 py-4">
          {timelineLoading && <p className="ui-body text-slate-500 dark:text-slate-400">{text("timelinesLoading")}</p>}
          {!timelineLoading && filteredTimelineEndpoints.length === 0 && (
            <p className="ui-body text-slate-500 dark:text-slate-400">{text("noTimelinesForFilter")}</p>
          )}
          {!timelineLoading &&
            filteredTimelineEndpoints.map((endpoint) => (
              <button
                key={`timeline-${endpoint.endpoint_id}`}
                type="button"
                onClick={() => navigate(`/admin/endpoint-status/${endpoint.endpoint_id}`)}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left transition hover:border-primary/50 hover:bg-primary/5 dark:border-slate-700 dark:hover:bg-primary-900/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="ui-caption font-semibold text-slate-900 dark:text-slate-100">{endpoint.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="ui-caption text-slate-500 dark:text-slate-400">{text("availabilityPercent", { percent: formatPercent(endpoint.availability_pct ?? null) })}</span>
                    <span className="ui-caption text-slate-500 dark:text-slate-400">{formatCheckMode(endpoint.check_mode)}</span>
                    <StatusPill status={endpoint.status} />
                  </div>
                </div>
                <EndpointTimelineBar points={endpoint.timeline} rangeStart={timelineStart} rangeEnd={timelineEnd} className="mt-2 h-3" />
              </button>
            ))}
        </div>
      </div>

      <ListPageSection
          title={text("incidents")}
          description={text("incidentsDescription")}
          variant="section"
          countLabel={incidentsCountLabel}
          filters={
            <UiSegmentedControl
              ariaLabel={text("incidentWindow")}
              options={INCIDENT_WINDOW_OPTIONS.map(({ value }) => ({ value, label: text(`windowLabel_${value}`), helper: text(`windowHelp_${value}`) }))}
              value={incidentWindow}
              onChange={setIncidentWindow}
            />
          }
      >
        <DataTableShell
          columns={incidentTableColumns}
          rows={incidentRows}
          rowKey={(incident) => incident.rowKey}
          status={incidentsTableStatus}
          loadingMessage={text("incidentsLoading")}
          errorMessage={text("incidentsFailed")}
          emptyMessage={incidentsEmptyMessage}
          primaryColumnId="endpoint"
          responsiveCards
          tableClassName="ui-data-table"
          rowClassName="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
        />
      </ListPageSection>
    </PageShell>
  );
}
