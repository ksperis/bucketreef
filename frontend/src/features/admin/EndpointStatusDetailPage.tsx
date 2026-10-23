/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EndpointHealthIncident,
  EndpointHealthRawCheck,
  EndpointHealthSeries,
  EndpointHealthSummary,
  fetchHealthIncidents,
  fetchHealthRawChecks,
  fetchHealthSeries,
  fetchHealthSummary,
  runHealthchecks,
} from "../../api/healthchecks";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import ListSectionCard from "../../components/list/ListSectionCard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import {
  buildTimelineSegmentDetails,
  EndpointTimelineBar,
  formatChartDay,
  formatChartTime,
  formatCheckMode,
  formatDurationShort,
  formatLatency,
  formatPercent,
  formatStatusLabel,
  formatTimestamp,
  statusTextClass,
  StatusPill,
  toTimestampMs,
} from "./endpointStatusShared";
import {
  buildLatencyChartPoints,
  buildLatencyStatusBands,
  downsampleLatencySeries,
  type LatencyChartPoint,
} from "./endpointStatusLatencyChart";
import { useEndpointStatusText } from "./endpointStatusMessages";

type WindowOption = { label: string; value: "day" | "week" | "month" | "quarter" | "half_year"; helper: string };

const RAW_CHECKS_PAGE_SIZE = 25;

type RawCheckRow = EndpointHealthRawCheck & { rowKey: string };
type IncidentRow = EndpointHealthIncident & { rowKey: string };

export default function EndpointStatusDetailPage() {
  const { text, locale } = useEndpointStatusText();
  const params = useParams();
  const endpointId = Number(params.endpointId ?? "");
  const hasValidEndpointId = Number.isFinite(endpointId) && endpointId > 0;
  const windowOptions = useMemo<WindowOption[]>(
    () => [
      { label: text("windowLabel_day"), value: "day", helper: text("windowHelp_day") },
      { label: text("windowLabel_week"), value: "week", helper: text("windowHelp_week") },
      { label: text("windowLabel_month"), value: "month", helper: text("windowHelp_month") },
      { label: text("windowLabel_quarter"), value: "quarter", helper: text("windowHelp_quarter") },
      { label: text("windowLabel_half_year"), value: "half_year", helper: text("windowHelp_half_year") },
    ],
    [text]
  );
  const breadcrumbs = useMemo(
    () => adminPageBreadcrumbs("endpoint-status", { label: text("detailsBreadcrumb") }).map((breadcrumb, index) => ({
      ...breadcrumb,
      label: index === 0 ? text("admin") : index === 1 ? text("title") : breadcrumb.label,
    })),
    [text]
  );

  const [summary, setSummary] = useState<EndpointHealthSummary[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [windowValue, setWindowValue] = useState<WindowOption["value"]>("week");

  const [series, setSeries] = useState<EndpointHealthSeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState<boolean>(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const [incidents, setIncidents] = useState<EndpointHealthIncident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState<boolean>(false);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const [rawChecks, setRawChecks] = useState<EndpointHealthRawCheck[]>([]);
  const [rawChecksTotal, setRawChecksTotal] = useState<number>(0);
  const [rawChecksPage, setRawChecksPage] = useState<number>(1);
  const [rawChecksLoading, setRawChecksLoading] = useState<boolean>(false);
  const [rawChecksError, setRawChecksError] = useState<string | null>(null);
  const [selectedTimelineSegmentKey, setSelectedTimelineSegmentKey] = useState<string | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState<boolean>(false);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const payload = await fetchHealthSummary();
      setSummary(payload.endpoints);
    } catch (err) {
      setSummary([]);
      setSummaryError(extractApiError(err, text("summaryLoadError")));
    } finally {
      setSummaryLoading(false);
    }
  }, [text]);

  const loadDetails = useCallback(async (selectedEndpointId: number, window: WindowOption["value"]) => {
    setSeriesLoading(true);
    setSeriesError(null);
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const [seriesData, incidentsData] = await Promise.all([
        fetchHealthSeries(selectedEndpointId, window),
        fetchHealthIncidents(selectedEndpointId, window),
      ]);
      setSeries(seriesData);
      setIncidents(incidentsData.incidents);
    } catch (err) {
      setSeries(null);
      setIncidents([]);
      setSeriesError(extractApiError(err, text("seriesLoadError")));
      setIncidentsError(extractApiError(err, text("endpointIncidentsLoadError")));
    } finally {
      setSeriesLoading(false);
      setIncidentsLoading(false);
    }
  }, [text]);

  const loadRawChecks = useCallback(
    async (selectedEndpointId: number, window: WindowOption["value"], page: number) => {
      setRawChecksLoading(true);
      setRawChecksError(null);
      try {
        const payload = await fetchHealthRawChecks(selectedEndpointId, window, page, RAW_CHECKS_PAGE_SIZE);
        setRawChecks(payload.checks);
        setRawChecksTotal(payload.total);
      } catch (err) {
        setRawChecks([]);
        setRawChecksTotal(0);
        setRawChecksError(extractApiError(err, text("rawChecksLoadError")));
      } finally {
        setRawChecksLoading(false);
      }
    },
    [text]
  );

  const loadAll = useCallback(async () => {
    if (!hasValidEndpointId) return;
    await Promise.all([loadSummary(), loadDetails(endpointId, windowValue), loadRawChecks(endpointId, windowValue, rawChecksPage)]);
  }, [endpointId, hasValidEndpointId, loadDetails, loadRawChecks, loadSummary, rawChecksPage, windowValue]);

  const handleRunNow = useCallback(async () => {
    if (runLoading || !hasValidEndpointId) return;
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
  }, [hasValidEndpointId, loadAll, runLoading, text]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!hasValidEndpointId) {
      setSeries(null);
      setIncidents([]);
      setRawChecks([]);
      setRawChecksTotal(0);
      return;
    }
    loadDetails(endpointId, windowValue);
  }, [endpointId, hasValidEndpointId, loadDetails, windowValue]);

  useEffect(() => {
    if (!hasValidEndpointId) return;
    loadRawChecks(endpointId, windowValue, rawChecksPage);
  }, [endpointId, hasValidEndpointId, loadRawChecks, rawChecksPage, windowValue]);

  useEffect(() => {
    setRawChecksPage(1);
  }, [endpointId]);

  const selectedEndpoint = useMemo(() => {
    return summary?.find((entry) => entry.endpoint_id === endpointId) ?? null;
  }, [endpointId, summary]);

  const latencyChartData = useMemo(() => buildLatencyChartPoints(series, windowValue), [series, windowValue]);
  const latencyDisplayMode = latencyChartData.mode;
  const latencyPoints = latencyChartData.points;

  const latencySeries = useMemo(
    () => downsampleLatencySeries(latencyPoints, windowValue === "day" ? 900 : 1200),
    [latencyPoints, windowValue]
  );

  const latencyRangeStartMs = useMemo(() => toTimestampMs(series?.start ?? ""), [series?.start]);
  const latencyRangeEndMs = useMemo(() => toTimestampMs(series?.end ?? ""), [series?.end]);

  const latencyStatusBands = useMemo(
    () =>
      buildLatencyStatusBands(latencyPoints, {
        rangeStartMs: latencyRangeStartMs,
        rangeEndMs: latencyRangeEndMs,
      }),
    [latencyPoints, latencyRangeEndMs, latencyRangeStartMs]
  );

  const windowAvailability = useMemo(() => {
    if (!series) return null;
    if (latencyDisplayMode === "rollup") {
      const knownStatuses = series.series.filter((point) => point.status !== "unknown");
      if (knownStatuses.length === 0) return null;
      const upChecks = knownStatuses.filter((point) => point.status === "up").length;
      return (upChecks / knownStatuses.length) * 100;
    }
    const totals = series.daily.reduce(
      (acc, point) => {
        acc.ok += point.ok_count;
        acc.total += point.ok_count + point.degraded_count + point.down_count;
        return acc;
      },
      { ok: 0, total: 0 }
    );
    if (totals.total === 0) return null;
    return (totals.ok / totals.total) * 100;
  }, [latencyDisplayMode, series]);

  const windowAverageLatency = useMemo(() => {
    const values = latencyPoints.map((point) => point.latency_ms).filter((value): value is number => value != null);
    if (values.length === 0) return null;
    return Math.round(values.reduce((acc, value) => acc + value, 0) / values.length);
  }, [latencyPoints]);

  const windowP95Latency = useMemo(() => {
    if (!series) return null;
    const p95Values = series.daily.map((point) => point.p95_latency_ms).filter((value): value is number => value != null);
    if (p95Values.length === 0) return null;
    return Math.round(p95Values.reduce((acc, value) => acc + value, 0) / p95Values.length);
  }, [series]);

  const latencyXAxisDomain = useMemo<[number, number]>(() => {
    if (latencyRangeStartMs != null && latencyRangeEndMs != null && latencyRangeEndMs > latencyRangeStartMs) {
      return [latencyRangeStartMs, latencyRangeEndMs];
    }
    if (latencyPoints.length === 0) return [0, 1];
    const timestamps = latencyPoints.map((point) => point.timestampMs);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    if (minTs === maxTs) {
      const padMs = windowValue === "day" ? 30 * 60 * 1000 : 12 * 60 * 60 * 1000;
      return [minTs - padMs, maxTs + padMs];
    }
    return [minTs, maxTs];
  }, [latencyPoints, latencyRangeEndMs, latencyRangeStartMs, windowValue]);

  const latencySamplesCount = useMemo(
    () => latencyPoints.filter((point) => point.latency_ms != null).length,
    [latencyPoints]
  );

  const latencyXAxisTickCount = useMemo(() => {
    if (windowValue === "day") return 8;
    if (windowValue === "week") return 8;
    return 6;
  }, [windowValue]);

  const latencyXAxisMinTickGap = useMemo(() => {
    if (windowValue === "day") return 28;
    if (windowValue === "week") return 36;
    return 44;
  }, [windowValue]);

  const formatLatencyTick = useCallback(
    (value: number) => (latencyDisplayMode === "rollup" ? formatChartTime(value, locale) : formatChartDay(value, locale)),
    [latencyDisplayMode, locale]
  );

  const renderLatencyTooltip = useCallback(
    ({
      active,
      payload,
      label,
    }: {
      active?: boolean;
      payload?: readonly { payload?: LatencyChartPoint }[];
      label?: unknown;
    }) => {
      if (!active || !payload || payload.length === 0) return null;
      const point = payload[0]?.payload;
      if (!point) return null;
      const statusLabel = formatStatusLabel(point.status, locale);
      const missingLatencyMessage =
        point.latency_ms == null && (point.status === "down" || point.status === "degraded")
          ? text("noOutageLatencySample")
          : null;

      return (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
            {typeof label === "number" ? formatLatencyTick(label) : "-"}
          </p>
          <p className="ui-caption text-slate-600 dark:text-slate-300">
            {text("statusPrefix")} <span className={`font-semibold ${statusTextClass(point.status)}`}>{statusLabel}</span>
          </p>
          <p className="ui-caption text-slate-600 dark:text-slate-300">
            {text(latencyDisplayMode === "rollup" ? "rollupLatencyPrefix" : "averageLatencyPrefix")}{" "}
            <span className="font-semibold">{formatLatency(point.latency_ms)}</span>
          </p>
          {latencyDisplayMode === "daily" && (
            <p className="ui-caption text-slate-600 dark:text-slate-300">
              {text("p95LatencyPrefix")} <span className="font-semibold">{formatLatency(point.p95_latency_ms)}</span>
            </p>
          )}
          {missingLatencyMessage && <p className="ui-caption text-slate-500 dark:text-slate-400">{missingLatencyMessage}</p>}
        </div>
      );
    },
    [formatLatencyTick, latencyDisplayMode, locale, text]
  );

  const rawChecksTotalPages = useMemo(() => {
    if (rawChecksTotal <= 0) return 1;
    return Math.max(1, Math.ceil(rawChecksTotal / RAW_CHECKS_PAGE_SIZE));
  }, [rawChecksTotal]);
  const rawChecksTableStatus = resolveListTableStatus({
    loading: rawChecksLoading,
    error: rawChecksError,
    rowCount: rawChecks.length,
  });
  const incidentsTableStatus = resolveListTableStatus({
    loading: incidentsLoading,
    error: incidentsError,
    rowCount: incidents.length,
  });

  const rawCheckRows = useMemo<RawCheckRow[]>(
    () => rawChecks.map((check, index) => ({ ...check, rowKey: `${check.checked_at}:${index}` })),
    [rawChecks]
  );
  const incidentRows = useMemo<IncidentRow[]>(
    () => incidents.map((incident, index) => ({ ...incident, rowKey: `${incident.start}:${index}` })),
    [incidents]
  );

  const rawCheckColumns = useMemo<DataTableColumn<RawCheckRow>[]>(
    () => [
      {
        id: "check",
        label: text("check"),
        primary: true,
        render: (check) => formatTimestamp(check.checked_at, locale),
      },
      {
        id: "status",
        label: text("status"),
        render: (check) => <StatusPill status={check.status} />,
      },
      {
        id: "latency",
        label: text("latency"),
        render: (check) => formatLatency(check.latency_ms ?? null),
      },
      {
        id: "http",
        label: "HTTP",
        render: (check) => check.http_status ?? "-",
      },
      {
        id: "mode",
        label: text("mode"),
        render: (check) => formatCheckMode(check.check_mode),
      },
      {
        id: "error",
        label: text("error"),
        render: (check) => check.error_message || "-",
      },
    ],
    [locale, text]
  );
  const incidentColumns = useMemo<DataTableColumn<IncidentRow>[]>(
    () => [
      {
        id: "status",
        label: text("status"),
        primary: true,
        render: (incident) => <StatusPill status={incident.status} />,
      },
      {
        id: "start",
        label: text("start"),
        render: (incident) => formatTimestamp(incident.start, locale),
      },
      {
        id: "end",
        label: text("end"),
        render: (incident) => (incident.end ? formatTimestamp(incident.end, locale) : text("ongoing")),
      },
      {
        id: "duration",
        label: text("duration"),
        render: (incident) => (incident.duration_minutes != null ? text("durationMinutes", { minutes: incident.duration_minutes }) : "-"),
      },
    ],
    [locale, text]
  );

  useEffect(() => {
    if (rawChecksPage > rawChecksTotalPages) {
      setRawChecksPage(rawChecksTotalPages);
    }
  }, [rawChecksPage, rawChecksTotalPages]);

  const timelineSegments = useMemo(
    () => buildTimelineSegmentDetails(series?.series ?? [], series?.start, series?.end, locale),
    [locale, series]
  );

  const selectedTimelineSegment = useMemo(
    () => timelineSegments.find((segment) => segment.key === selectedTimelineSegmentKey) ?? null,
    [selectedTimelineSegmentKey, timelineSegments]
  );

  useEffect(() => {
    if (timelineSegments.length === 0) {
      setSelectedTimelineSegmentKey(null);
      return;
    }
    if (!selectedTimelineSegmentKey) return;
    const stillExists = timelineSegments.some((segment) => segment.key === selectedTimelineSegmentKey);
    if (!stillExists) {
      setSelectedTimelineSegmentKey(timelineSegments[0].key);
    }
  }, [selectedTimelineSegmentKey, timelineSegments]);

  useEffect(() => {
    if (!selectedTimelineSegmentKey || timelineSegments.length === 0) return;
    const handleArrowNavigation = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      const currentIndex = timelineSegments.findIndex((segment) => segment.key === selectedTimelineSegmentKey);
      if (currentIndex < 0) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + timelineSegments.length) % timelineSegments.length;
      setSelectedTimelineSegmentKey(timelineSegments[nextIndex].key);
    };
    window.addEventListener("keydown", handleArrowNavigation);
    return () => {
      window.removeEventListener("keydown", handleArrowNavigation);
    };
  }, [selectedTimelineSegmentKey, timelineSegments]);

  if (!hasValidEndpointId) {
    return (
      <PageShell actionPresentation="listing"
        title={text("detailsTitle")}
        breadcrumbs={breadcrumbs}
        actions={[{ label: text("back"), to: "/admin/endpoint-status", variant: "ghost" }]}
      >
        <PageBanner tone="warning">{text("invalidEndpointId")}</PageBanner>
      </PageShell>
    );
  }

  return (
    <PageShell actionPresentation="listing"
      title={selectedEndpoint ? selectedEndpoint.name : text("detailsTitle")}
      description={selectedEndpoint?.endpoint_url || text("detailsDescription")}
      breadcrumbs={breadcrumbs}
      actions={[
        { label: text(runLoading ? "running" : "checkNow"), onClick: handleRunNow, disabled: import.meta.env.MODE === "demo" },
        { label: text("refresh"), onClick: loadAll, variant: "ghost" },
        { label: text("back"), to: "/admin/endpoint-status", variant: "ghost" },
      ]}
    >

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {summaryError && <PageBanner tone="error">{summaryError}</PageBanner>}
      {seriesError && <PageBanner tone="error">{seriesError}</PageBanner>}

      <div className="ui-surface-card">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{text("healthDetail")}</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {text("checkMode", { mode: formatCheckMode(series?.check_mode ?? selectedEndpoint?.check_mode) })}
              {series?.check_target_url ? text("checkTarget", { target: series.check_target_url }) : ""}
            </p>
          </div>
          <UiSegmentedControl
            ariaLabel={text("detailWindowLabel")}
            options={windowOptions}
            value={windowValue}
            onChange={(nextWindow) => {
              setWindowValue(nextWindow);
              setRawChecksPage(1);
            }}
          />
        </div>

        <div className="space-y-6 px-6 py-6">
          {summaryLoading && <p className="ui-body text-slate-500 dark:text-slate-400">{text("loadingEndpointMetadata")}</p>}
          {!summaryLoading && !selectedEndpoint && (
            <PageBanner tone="warning">{text("endpointMissingInSummary")}</PageBanner>
          )}

          {selectedEndpoint?.error_message && (
            <PageBanner tone={selectedEndpoint.status === "up" ? "info" : "warning"}>{text("lastCheck", { error: selectedEndpoint.error_message })}</PageBanner>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">{text("currentStatus")}</p>
              <div className="mt-2">
                <StatusPill status={selectedEndpoint?.status ?? "unknown"} />
              </div>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">{text("currentLatency")}</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">
                {formatLatency(selectedEndpoint?.status === "down" ? null : selectedEndpoint?.latency_ms)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">{text("availabilityWindow", { window: text(`windowMetric_${windowValue}`) })}</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">{formatPercent(windowAvailability)}</p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">{text("averageLatencyWindow", { window: text(`windowMetric_${windowValue}`) })}</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">{formatLatency(windowAverageLatency)}</p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">{text("p95LatencyWindow", { window: text(`windowMetric_${windowValue}`) })}</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">{formatLatency(windowP95Latency)}</p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">{text("checksInRange")}</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">{series?.data_points ?? 0}</p>
            </div>
          </div>

          {seriesLoading && <p className="ui-body text-slate-500 dark:text-slate-400">{text("loadingEndpointCharts")}</p>}

          {!seriesLoading && (
            <div className="space-y-6">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{text("endpointTimeline")}</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {text("detailTimelineDescription")}
                </p>
                <div className="mt-3">
                  {(series?.series.length ?? 0) === 0 ? (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">{text("noTimelineInRange")}</p>
                  ) : (
                    <div className="space-y-3">
                      <EndpointTimelineBar
                        points={series?.series ?? []}
                        rangeStart={series?.start}
                        rangeEnd={series?.end}
                        className="h-5"
                        selectedSegmentKey={selectedTimelineSegmentKey}
                        onSegmentSelect={(segment) => setSelectedTimelineSegmentKey(segment.key)}
                      />
                      {selectedTimelineSegment && (
                        <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
                          <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                            {text("selectedSegment", {
                              index: timelineSegments.findIndex((segment) => segment.key === selectedTimelineSegment.key) + 1,
                              total: timelineSegments.length,
                            })}
                          </p>
                          <div className="mt-1 grid gap-1">
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              {text("statusPrefix")}{" "}
                              <span className={`font-semibold ${statusTextClass(selectedTimelineSegment.status)}`}>
                                {formatStatusLabel(selectedTimelineSegment.status, locale)}
                              </span>
                            </p>
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              {text("startPrefix")} <span className="font-semibold">{formatTimestamp(selectedTimelineSegment.startTimestamp, locale)}</span>
                            </p>
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              {text("endPrefix")} <span className="font-semibold">{formatTimestamp(selectedTimelineSegment.endTimestamp, locale)}</span>
                            </p>
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              {text("durationPrefix")} <span className="font-semibold">{formatDurationShort(selectedTimelineSegment.durationMs, locale)}</span>
                            </p>
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              {text("latencyPrefix")} <span className="font-semibold">{formatLatency(selectedTimelineSegment.latencyMs ?? null)}</span>
                            </p>
                            {selectedTimelineSegment.cause && (
                              <p className="ui-caption text-slate-600 dark:text-slate-300">
                                {text("causePrefix")} <span className="font-semibold">{selectedTimelineSegment.cause}</span>
                              </p>
                            )}
                          </div>
                          <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{text("segmentKeyboardHint")}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{text("latencyChartTitle")}</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {text(latencyDisplayMode === "rollup" ? "rollupLatencyDescription" : "dailyLatencyDescription", {
                    mode: formatCheckMode(series?.check_mode ?? selectedEndpoint?.check_mode),
                  })}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 ui-caption text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded bg-blue-500" />
                    {text(latencyDisplayMode === "rollup" ? "rollupLatency" : "averageLatency")}
                  </span>
                  {latencyDisplayMode === "daily" && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 border-t border-dashed border-orange-500" />
                      {text("p95Latency")}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-4 rounded-sm border border-amber-500/60 bg-amber-400/30" />
                    {text("degradedWindow")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-4 rounded-sm border border-rose-500/60 bg-rose-400/30" />
                    {text("downWindow")}
                  </span>
                </div>
                <div className="mt-3 h-64">
                  {latencyPoints.length === 0 ? (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">{text("noLatencyInRange")}</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={latencySeries}>
                          {latencyStatusBands.map((band, index) => (
                            <ReferenceArea
                              key={`${band.status}-${band.startMs}-${band.endMs}-${index}`}
                              x1={band.startMs}
                              x2={band.endMs}
                              fill={band.status === "down" ? "rgba(244, 63, 94, 0.20)" : "rgba(245, 158, 11, 0.18)"}
                              strokeOpacity={0}
                              ifOverflow="extendDomain"
                            />
                          ))}
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                          <XAxis
                            dataKey="timestampMs"
                            type="number"
                            scale="time"
                            domain={latencyXAxisDomain}
                            tickFormatter={formatLatencyTick}
                            tickCount={latencyXAxisTickCount}
                            minTickGap={latencyXAxisMinTickGap}
                            interval="preserveStartEnd"
                            stroke="#94A3B8"
                          />
                          <YAxis
                            tickFormatter={(value) => `${value} ms`}
                            stroke="#94A3B8"
                            allowDecimals={false}
                            domain={[
                              0,
                              (dataMax: number) => (Number.isFinite(dataMax) && dataMax > 0 ? Math.ceil(dataMax * 1.1) : 100),
                            ]}
                          />
                          <Tooltip content={renderLatencyTooltip} />
                          <Line
                            type="monotone"
                            dataKey="latency_ms"
                            name={text(latencyDisplayMode === "rollup" ? "rollupLatency" : "averageLatency")}
                            stroke="#3B82F6"
                            strokeWidth={2}
                            dot={latencySeries.length === 1 ? { r: 3 } : false}
                            connectNulls={false}
                          />
                          {latencyDisplayMode === "daily" && (
                            <Line
                              type="monotone"
                              dataKey="p95_latency_ms"
                              name={text("p95Latency")}
                              stroke="#F97316"
                              strokeWidth={2}
                              strokeDasharray="5 5"
                              dot={false}
                              connectNulls={false}
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                      {latencySamplesCount === 0 && latencyStatusBands.length > 0 && (
                        <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                          {text("noMeasurableLatency")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{text("rawHealthchecks")}</p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">{text("rawChecksDescription")}</p>
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">{text("rawChecksCount", { count: rawChecksTotal })}</p>
                </div>
                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700">
                  <DataTableShell
                    columns={rawCheckColumns}
                    rows={rawCheckRows}
                    rowKey={(check) => check.rowKey}
                    status={rawChecksTableStatus}
                    loadingMessage={text("loadingRawChecks")}
                    errorMessage={text("rawChecksLoadError")}
                    emptyMessage={text("noRawChecksInRange")}
                    pagination={{
                      page: rawChecksPage,
                      pageSize: RAW_CHECKS_PAGE_SIZE,
                      total: rawChecksTotal,
                      onPageChange: setRawChecksPage,
                      disabled: rawChecksLoading,
                    }}
                    responsiveCards
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ListSectionCard
        title={text("incidents")}
        subtitle={text("detailIncidentsDescription")}
      >
        <DataTableShell
          columns={incidentColumns}
          rows={incidentRows}
          rowKey={(incident) => incident.rowKey}
          status={incidentsTableStatus}
          loadingMessage={text("incidentsLoading")}
          errorMessage={text("incidentsFailed")}
          emptyMessage={text("noEndpointIncidentsInRange")}
          responsiveCards
        />
      </ListSectionCard>
    </PageShell>
  );
}
