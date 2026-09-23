/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, useMemo, type ComponentProps, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HealthCheckStatus } from "../api/healthchecks";
import type { ManagerUsageTrendBaseline } from "../api/stats";
import { formatBytes } from "../utils/format";
import UiBadge from "./ui/UiBadge";
import UiButton, { UiButtonLink } from "./ui/UiButton";
import "./compactDashboard.css";
import UiMeterBar from "./ui/UiMeterBar";
import { cx, uiCardClass, uiMutedTextClass } from "./ui/styles";

export type WorkspaceDashboardFeature = {
  id: string;
  label: string;
  enabled: boolean;
  massManagement?: boolean;
};

export type WorkspaceDashboardFeatureGroup = {
  title: string;
  features: WorkspaceDashboardFeature[];
};

export type WorkspaceDashboardTone = "amber" | "blue" | "indigo" | "emerald" | "violet";

export type WorkspaceDashboardSummaryItem = {
  id: string;
  label: string;
  value: string | number;
  hint: string;
  to: string;
};

export type WorkspacePlatformMetric = {
  label: string;
  value: string;
  delta?: string;
  series?: number[];
  tone: "blue" | "violet" | "emerald";
  unavailableReason?: string;
  description?: string;
};

export type WorkspaceDashboardMetricTrend = {
  label: string;
  valueLabel?: string;
  qualifierLabel?: string;
  tone: "positive" | "negative" | "neutral";
};

export type WorkspaceDashboardMetric = {
  label: string;
  value: string;
  detail?: string;
  trend?: WorkspaceDashboardMetricTrend;
  progress?: number | null;
  progressLabel?: string;
  compactValue?: boolean;
  tone: WorkspaceDashboardTone;
  icon: ReactNode;
  to?: string;
  unavailableReason?: string | null;
};

type WorkspaceDashboardStorageEvolutionPoint = {
  timestampMs: number;
  usedBytes: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function workspaceTrendWindowDays(baseline?: ManagerUsageTrendBaseline | null): number {
  if (baseline?.window === "day") return 1;
  if (baseline?.window === "week") return 7;
  return 30;
}

function workspaceTimestampMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function buildWorkspaceStorageEvolutionPoints(
  currentValue: number | null | undefined,
  baseline: ManagerUsageTrendBaseline | null | undefined,
  referenceDate: string | Date | null | undefined
): WorkspaceDashboardStorageEvolutionPoint[] {
  if (currentValue == null) return [];
  const endMs = workspaceTimestampMs(referenceDate) ?? workspaceTimestampMs(baseline?.collected_at) ?? Date.now();
  const days = workspaceTrendWindowDays(baseline);
  const startMs = endMs - days * DAY_MS;
  const startValue = baseline?.used_bytes ?? currentValue;
  const interpolationProfile = [0, 0.07, 0.16, 0.27, 0.4, 0.56, 0.7, 0.84, 0.93, 1];
  return interpolationProfile.map((step) => ({
    timestampMs: startMs + (endMs - startMs) * step,
    usedBytes: Math.max(0, startValue + (currentValue - startValue) * step),
  }));
}

function workspaceStatusLabel(status: HealthCheckStatus): string {
  if (status === "up") return "Up";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Unknown";
}

function workspaceStatusDotClass(status: HealthCheckStatus): string {
  if (status === "up") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "down") return "bg-rose-500";
  return "bg-slate-400";
}

function workspaceStatusPillClass(status: HealthCheckStatus): string {
  if (status === "up") {
    return "border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  if (status === "degraded") {
    return "border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300";
  }
  if (status === "down") {
    return "border-rose-200/80 bg-rose-50/80 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300";
  }
  return "border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)] dark:border-slate-700 dark:bg-slate-800/40";
}

export function WorkspaceStatusDot({ status, className }: { status: HealthCheckStatus; className?: string }) {
  return <span className={cx("h-2 w-2 rounded-full", workspaceStatusDotClass(status), className)} />;
}

export function WorkspaceStatusPill({ status, className, presentation }: { status: HealthCheckStatus; className?: string; presentation?: "compact" }) {
  if (presentation === "compact") {
    return <UiBadge tone={status === "up" ? "success" : status === "degraded" ? "warning" : status === "down" ? "danger" : "neutral"} className={cx("ui-dashboard-badge", className)}>{workspaceStatusLabel(status)}</UiBadge>;
  }
  return (
    <span className={cx("rounded-md border px-2 py-0.5 font-semibold leading-4", workspaceStatusPillClass(status), className)}>
      {workspaceStatusLabel(status)}
    </span>
  );
}

function workspaceDashboardToneClasses(tone: WorkspaceDashboardTone) {
  if (tone === "emerald") {
    return {
      icon: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
      soft: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
      bar: "bg-emerald-500",
    };
  }
  if (tone === "violet") {
    return {
      icon: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
      soft: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
      bar: "bg-violet-500",
    };
  }
  if (tone === "amber") {
    return {
      icon: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
      soft: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
      bar: "bg-amber-500",
    };
  }
  if (tone === "indigo") {
    return {
      icon: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300",
      soft: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300",
      bar: "bg-indigo-500",
    };
  }
  return {
    icon: "bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-200",
    soft: "bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-200",
    bar: "bg-primary",
  };
}

function dashboardTrendToneClasses(tone: WorkspaceDashboardMetricTrend["tone"]): string {
  if (tone === "negative") return "text-rose-600 dark:text-rose-300";
  if (tone === "neutral") return "text-[var(--ui-text-muted)]";
  return "text-emerald-600 dark:text-emerald-300";
}

function metricToneClass(tone: WorkspacePlatformMetric["tone"]): string {
  if (tone === "violet") return "stroke-violet-500";
  if (tone === "emerald") return "stroke-emerald-500";
  return "stroke-primary";
}

function statusCounterPanelClass(status: HealthCheckStatus, value: number): string {
  if (value <= 0) {
    return "border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)]";
  }
  if (status === "up") {
    return "border-emerald-200/80 bg-emerald-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:shadow-none";
  }
  if (status === "degraded") {
    return "border-amber-200/80 bg-amber-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-amber-500/25 dark:bg-amber-500/10 dark:shadow-none";
  }
  if (status === "down") {
    return "border-rose-200/80 bg-rose-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-rose-500/25 dark:bg-rose-500/10 dark:shadow-none";
  }
  return "border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)]";
}

function statusCounterLabelClass(status: HealthCheckStatus, value: number): string {
  if (value <= 0) return "text-[var(--ui-text-muted)]";
  if (status === "up") return "text-emerald-700 dark:text-emerald-300";
  if (status === "degraded") return "text-amber-700 dark:text-amber-300";
  if (status === "down") return "text-rose-700 dark:text-rose-300";
  return "text-[var(--ui-text-muted)]";
}

function normalizeSeries(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 48 : (index / (values.length - 1)) * 96;
      const y = 34 - ((value - min) / span) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatStorageEvolutionShortDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function DashboardTrendArrowIcon({ tone }: { tone: Exclude<WorkspaceDashboardMetricTrend["tone"], "neutral"> }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cx("h-3.5 w-3.5", tone === "negative" && "rotate-180")}
      fill="none"
      aria-hidden="true"
    >
      <path d="M8 13V3.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4.75 7 8 3.75 11.25 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function splitDashboardTrendLabel(label: string): { value: string; qualifier: string } {
  const marker = " vs ";
  const markerIndex = label.indexOf(marker);
  if (markerIndex === -1) return { value: label, qualifier: "" };
  return {
    value: label.slice(0, markerIndex),
    qualifier: label.slice(markerIndex),
  };
}

export function WorkspaceDashboardProgressBar({
  value,
  tone = "blue",
  className,
  ariaLabel,
}: {
  value?: number | null;
  tone?: WorkspaceDashboardTone;
  className?: string;
  ariaLabel?: string;
}) {
  const boundedValue = Math.max(0, Math.min(100, value ?? 0));
  return (
    <UiMeterBar
      value={boundedValue}
      label={ariaLabel ?? "Quota usage"}
      className={cx("h-2 bg-slate-200/70 dark:bg-slate-700/60", className)}
      barClassName={workspaceDashboardToneClasses(tone).bar}
    />
  );
}

export function WorkspaceDashboardIconBubble({
  tone,
  children,
  className,
}: {
  tone: WorkspaceDashboardTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-full", workspaceDashboardToneClasses(tone).icon, className)}>
      {children}
    </span>
  );
}

export function WorkspaceDashboardMetricTrendLine({ trend }: { trend: WorkspaceDashboardMetricTrend }) {
  const toneClass = dashboardTrendToneClasses(trend.tone);
  const fallbackParts = splitDashboardTrendLabel(trend.label);
  const value = trend.valueLabel ?? fallbackParts.value;
  const qualifier = trend.valueLabel ? trend.qualifierLabel ?? "" : fallbackParts.qualifier;
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-xs font-medium leading-4 text-[var(--ui-text-muted)]">
      {trend.tone === "neutral" ? (
        <span className={cx("mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center", toneClass)} aria-hidden="true">
          -
        </span>
      ) : (
        <span className={cx("mt-px shrink-0", toneClass)}>
          <DashboardTrendArrowIcon tone={trend.tone} />
        </span>
      )}
      <span className="min-w-0 flex-1 whitespace-normal break-words">
        <span className={cx(qualifier && "whitespace-nowrap", toneClass)}>{value}</span>
        {qualifier && <span>{qualifier}</span>}
      </span>
    </p>
  );
}

function WorkspaceDashboardMetricCard({ metric, presentation }: { metric: WorkspaceDashboardMetric; presentation?: "compact" }) {
  const content = (
    <div
      className={cx(uiCardClass, presentation === "compact" ? "ui-dashboard-kpi" : "flex h-full min-h-[164px] items-center gap-3 overflow-hidden px-4 py-3.5 sm:gap-4 sm:px-5")}
      data-kpi-card={metric.label}
    >
      <WorkspaceDashboardIconBubble tone={metric.tone} className={presentation === "compact" ? "ui-dashboard-kpi-icon" : "h-12 w-12 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55)] sm:h-14 sm:w-14"}>
        {metric.icon}
      </WorkspaceDashboardIconBubble>
      <div className={presentation === "compact" ? "ui-dashboard-kpi-content" : "grid min-h-[120px] min-w-0 flex-1 content-center grid-rows-[auto_2rem_minmax(1rem,auto)_0.375rem_minmax(1rem,auto)] gap-y-1"}>
        <div className="flex min-w-0 items-center gap-1.5">
          <p className={presentation === "compact" ? "ui-dashboard-note" : "min-w-0 whitespace-normal break-words text-[11px] font-bold uppercase leading-4 text-[var(--ui-text-muted)]"}>
            {metric.label}
          </p>
        </div>
        <p
          className={presentation === "compact" ? "ui-dashboard-value" : cx(
            "min-w-0 font-semibold text-[var(--ui-text)]",
            metric.compactValue ? "whitespace-nowrap text-[22px] leading-6" : "text-2xl leading-7"
          )}
          data-kpi-value={metric.label}
        >
          {metric.value}
        </p>
        <div className="min-w-0">
          {metric.detail ? (
            <p className={presentation === "compact" ? "ui-dashboard-note" : cx("min-w-0 whitespace-normal break-words text-[13px] leading-4", uiMutedTextClass)}>
              {metric.detail}
            </p>
          ) : (
            <span className="block h-4" aria-hidden="true" />
          )}
        </div>
        <div className="flex items-center">
          {metric.progress != null ? (
            <WorkspaceDashboardProgressBar
              value={metric.progress}
              tone={metric.tone}
              className="h-1.5 w-full max-w-[220px]"
              ariaLabel={metric.progressLabel ?? `${metric.label} quota usage`}
            />
          ) : (
            <span className="h-1.5 w-full max-w-[220px]" aria-hidden="true" />
          )}
        </div>
        <div className="flex min-w-0 items-start">
          {metric.trend ? (
            <WorkspaceDashboardMetricTrendLine trend={metric.trend} />
          ) : (
            <span className="h-4" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );

  const framed = (
    <WorkspaceDashboardUnavailableFrame reason={metric.unavailableReason ?? ""} className="h-full">
      {content}
    </WorkspaceDashboardUnavailableFrame>
  );
  if (!metric.to || metric.unavailableReason) return framed;
  return (
    <Link
      to={metric.to}
      className="block h-full rounded-lg transition hover:-translate-y-[1px] hover:shadow-[var(--shell-menu-shadow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {content}
    </Link>
  );
}

export function WorkspaceDashboardKpiRow({
  metrics,
  columns = 4,
  className,
  presentation,
}: {
  metrics: WorkspaceDashboardMetric[];
  columns?: 4 | 5;
  className?: string;
  presentation?: "compact";
}) {
  const gridColumnsClass = columns === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4";

  return (
    <div
      className={cx("grid gap-3 md:grid-cols-2", gridColumnsClass, className)}
      data-workspace-dashboard-kpi-row="true"
    >
      {metrics.map((metric) => (
        <WorkspaceDashboardMetricCard key={metric.label} metric={metric} presentation={presentation} />
      ))}
    </div>
  );
}

export function WorkspaceDashboardStorageEvolutionChart({
  points,
  gradientId,
  emptyLabel = "No storage history yet.",
  chartLabel = "Storage evolution chart",
  yLabelFormatter = formatBytes,
  xLabelFormatter = formatStorageEvolutionShortDate,
  presentation,
}: {
  points: WorkspaceDashboardStorageEvolutionPoint[];
  gradientId?: string;
  emptyLabel?: string;
  chartLabel?: string;
  yLabelFormatter?: (value: number) => string;
  xLabelFormatter?: (value: number) => string;
  presentation?: "compact";
}) {
  const fallbackId = useId();
  const chartColor = presentation === "compact" ? "var(--ui-primary)" : "rgb(37 99 235)";
  const fillId = gradientId ?? `workspace-storage-evolution-fill-${fallbackId.replace(/:/g, "")}`;
  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const width = 320;
    const top = 8;
    const bottom = 82;
    const maxValue = Math.max(...points.map((point) => point.usedBytes), 1);
    const axisMax = maxValue * 1.15;
    const startMs = points[0]?.timestampMs ?? 0;
    const endMs = points[points.length - 1]?.timestampMs ?? startMs + 1;
    const rangeMs = Math.max(1, endMs - startMs);
    const coordinates = points.map((point) => {
      const x = ((point.timestampMs - startMs) / rangeMs) * width;
      const y = bottom - (point.usedBytes / axisMax) * (bottom - top);
      return { x, y };
    });
    const linePath = coordinates
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
    return {
      width,
      top,
      bottom,
      axisMax,
      linePath,
      areaPath: `${linePath} L ${width} ${bottom} L 0 ${bottom} Z`,
      xLabels: [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].map((point) =>
        point ? xLabelFormatter(point.timestampMs) : ""
      ),
      yLabels: [axisMax, axisMax / 2, 0].map((value) => yLabelFormatter(value)),
    };
  }, [points, xLabelFormatter, yLabelFormatter]);

  if (!chart) {
    return (
      <div className="mt-4 flex h-[116px] items-center justify-center rounded-md border border-dashed border-[color:var(--ui-border-soft)] ui-caption text-[var(--ui-text-muted)]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="mt-4" aria-label={chartLabel}>
      <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3">
        <div className="flex h-[92px] flex-col items-end justify-between py-1 pr-1 text-right text-[10px] font-medium leading-3 text-[var(--ui-text-muted)]">
          {chart.yLabels.map((label, index) => (
            <span key={`${label}-${index}`} className="whitespace-nowrap tabular-nums">
              {label}
            </span>
          ))}
        </div>
        <svg className="h-[92px] w-full overflow-visible" viewBox="0 0 320 92" preserveAspectRatio="none" role="img">
          <defs>
            <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={chartColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={chartColor} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[chart.top, (chart.top + chart.bottom) / 2, chart.bottom].map((y) => (
            <line
              key={y}
              x1="0"
              x2={chart.width}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeDasharray="3 4"
              className="text-[var(--ui-border-soft)]"
            />
          ))}
          <path d={chart.areaPath} fill={`url(#${fillId})`} />
          <path d={chart.linePath} fill="none" stroke={chartColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div />
        <div className="mt-1 flex justify-between text-[10px] font-medium leading-3 text-[var(--ui-text-muted)]">
          {chart.xLabels.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceDashboardEmptyState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("rounded-md border border-dashed border-[color:var(--ui-border-soft)] px-3 py-6 text-center ui-caption text-[var(--ui-text-muted)]", className)}>
      {children}
    </div>
  );
}

/** Presentation only: callers own calculations, formatting and unavailable states. */
export function WorkspaceDashboardStorageOverview({
  title, action, usedLabel, usedValue, quotaValue, percentage, percentageLabel,
  progressLabel, quotaFallback, chart, growth, projection,
}: {
  title: ReactNode;
  action: ReactNode;
  usedLabel: string;
  usedValue: string;
  quotaValue?: string;
  percentage: number | null;
  percentageLabel: string;
  progressLabel?: string;
  quotaFallback?: ReactNode;
  chart: ComponentProps<typeof WorkspaceDashboardStorageEvolutionChart>;
  growth: { label: string; value: string; className: string };
  projection: { label: string; value: string; adornment?: ReactNode };
}) {
  return (
    <WorkspaceDashboardCard title={title} action={action} presentation="compact" wrapHeading>
      <div className="ui-dashboard-storage-values">
        <div className="min-w-0">
          <p className="ui-dashboard-note">{usedLabel}</p>
          <p className="ui-dashboard-value">{usedValue}{quotaValue && <span className="ui-dashboard-storage-quota"> / {quotaValue}</span>}</p>
        </div>
        <p className="ui-dashboard-value text-primary">{percentageLabel}</p>
      </div>
      {percentage != null ? <WorkspaceDashboardProgressBar value={percentage} className="mt-3 h-2.5" ariaLabel={progressLabel} /> : quotaFallback}
      <WorkspaceDashboardStorageEvolutionChart {...chart} presentation="compact" />
      <div className="ui-dashboard-storage-outlook">
        <div className="ui-dashboard-inset">
          <p className="ui-dashboard-note">{growth.label}</p>
          <p className={cx("ui-dashboard-outlook-value", growth.className)}>{growth.value}</p>
        </div>
        <div className="ui-dashboard-inset">
          <div className="flex items-center justify-between gap-2">
            <p className="ui-dashboard-note">{projection.label}</p>{projection.adornment}
          </div>
          <p className="ui-dashboard-outlook-value">{projection.value}</p>
        </div>
      </div>
    </WorkspaceDashboardCard>
  );
}

export function WorkspaceDashboardCard({
  title,
  action,
  children,
  className,
  bodyClassName,
  presentation,
  wrapHeading = false,
  ...props
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  presentation?: "compact";
  wrapHeading?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className={cx(uiCardClass, presentation === "compact" ? "ui-dashboard-panel" : "h-full p-4", className)} {...props}>
      {title || action ? (
        <div className={wrapHeading ? "ui-dashboard-panel-heading" : "flex items-center justify-between gap-3"}>
          {title ? <h2 id={titleId} className={presentation === "compact" ? "ui-dashboard-title" : "ui-subtitle font-semibold text-[var(--ui-text)]"}>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className={cx(title || action ? (presentation === "compact" ? "ui-dashboard-panel-body" : "mt-3") : "", bodyClassName)}>{children}</div>
    </section>
  );
}

export function WorkspaceDashboardUnavailableFrame({
  children,
  className,
}: {
  reason?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

function WorkspaceDashboardSparkline({
  values,
  tone,
}: {
  values: number[];
  tone: WorkspacePlatformMetric["tone"];
}) {
  const points = normalizeSeries(values);
  const chart = (
    <svg viewBox="0 0 96 34" className="h-[30px] w-full" role="img" aria-label="Trend line">
      <polyline points={points} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={metricToneClass(tone)} />
    </svg>
  );

  return chart;
}

/** Compact dashboard actions opt in without changing forms or other workspaces. */
export function WorkspaceDashboardAction({ className, ...props }: ComponentProps<typeof UiButton>) {
  return <UiButton size="xs" {...props} className={cx("ui-dashboard-action", className)} />;
}

export function WorkspaceDashboardActionLink({ className, variant = "secondary", ...props }: ComponentProps<typeof Link> & { variant?: "primary" | "secondary" }) {
  return <UiButtonLink {...props} size="xs" variant={variant} className={cx("ui-dashboard-action", className)} />;
}

export function WorkspaceDashboardLinkRow({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={cx("ui-dashboard-link-row", className)} />;
}

export function WorkspaceDashboardSummary({ items, loading, unavailableReason, title = "Administration" }: {
  title?: string;
  items: WorkspaceDashboardSummaryItem[];
  loading: boolean;
  unavailableReason?: string | null;
}) {
  return (
    <WorkspaceDashboardCard title={title} presentation="compact">
      {unavailableReason && <p role="status" className="ui-dashboard-note">{unavailableReason}</p>}
      <div className="ui-dashboard-summary">
        {items.map((item) => (
          <Link key={item.id} to={item.to} className="ui-dashboard-summary-link">
            <span className="ui-dashboard-label">{item.label}</span>
            <span className="ui-dashboard-value">{loading ? "…" : unavailableReason ? "—" : item.value}</span>
            <span className="ui-dashboard-note">{loading || unavailableReason ? "" : item.hint}</span>
          </Link>
        ))}
      </div>
    </WorkspaceDashboardCard>
  );
}

/** A compact feature group, placed inside an owning dashboard panel. */
export function WorkspaceFeatureSummary({ group }: { group: WorkspaceDashboardFeatureGroup }) {
  const enabledFeatures = group.features.filter((feature) => feature.enabled);
  return (
    <section aria-label={`${group.title} summary`} className="ui-dashboard-feature-group">
      <div className="ui-dashboard-feature-heading">
        <h3 className="ui-dashboard-label">{group.title}</h3>
        <span className="ui-dashboard-note">{enabledFeatures.length} enabled</span>
      </div>
      <div className="ui-dashboard-badges">
        {enabledFeatures.length === 0 ? <span className="ui-dashboard-note">None enabled</span> : enabledFeatures.map((feature) => (
          <UiBadge key={feature.id} tone="primary" className="ui-dashboard-badge">
            {feature.label}
            {feature.massManagement && <span title="Mass management" className="ui-dashboard-note">MM</span>}
          </UiBadge>
        ))}
      </div>
    </section>
  );
}

export function WorkspaceStatusCounter({
  label,
  value,
  status,
  presentation,
}: {
  label: string;
  value?: number | null;
  status: HealthCheckStatus;
  presentation?: "compact";
}) {
  if (presentation === "compact") {
    return <UiBadge className="ui-dashboard-badge" tone={!value ? "neutral" : status === "up" ? "success" : status === "degraded" ? "warning" : status === "down" ? "danger" : "neutral"}>{label} <strong>{value ?? "—"}</strong></UiBadge>;
  }
  return (
    <div
      className={cx(
        "min-h-[48px] rounded-md border px-3 py-2",
        statusCounterPanelClass(status, value ?? 0)
      )}
    >
      <p className={cx("ui-caption font-semibold", statusCounterLabelClass(status, value ?? 0))}>{label}</p>
      <p className="mt-1 text-[18px] font-semibold leading-5 text-[var(--ui-text)]">{value == null ? "" : value}</p>
    </div>
  );
}

export function WorkspacePlatformMetricCard({ metric }: { metric: WorkspacePlatformMetric }) {
  return (
    <div className="ui-dashboard-metric">
      <p className="ui-dashboard-label">{metric.label}</p>
      <div className="ui-dashboard-metric-value">
        <p className="ui-dashboard-value">{metric.value || "—"}</p>
        {metric.delta && <p className="ui-dashboard-note">{metric.delta}</p>}
      </div>
      {metric.series && metric.series.length > 0 && <WorkspaceDashboardSparkline values={metric.series} tone={metric.tone} />}
      {(metric.description || metric.unavailableReason) && <p className="ui-dashboard-note">{metric.unavailableReason || metric.description}</p>}
    </div>
  );
}

export function WorkspaceAvailabilityMetric({ score, loading, unavailableReason }: {
  score: number | null;
  loading: boolean;
  unavailableReason?: string | null;
}) {
  return <WorkspacePlatformMetricCard metric={{
    label: "Availability (7 days)",
    value: loading ? "…" : score == null || unavailableReason ? "—" : `${score}%`,
    tone: "emerald",
    description: "Mean availability across endpoints with measurements.",
    unavailableReason: unavailableReason || undefined,
  }} />;
}
