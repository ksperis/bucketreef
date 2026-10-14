/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useCallback, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageHistoryTrendResponse, UsageHistoryTrendWindow } from "../api/usageHistory";
import { formatBytes, formatBytesAxis, formatCompactNumber, formatPercentage } from "../utils/format";
import { MetricsCard, MetricsChartPanel } from "./MetricsCard";
import MetricsUnavailableCard from "./MetricsUnavailableCard";
import { MetricsSnapshotCard } from "./MetricsTrafficOverview";
import UiSegmentedControl from "./ui/UiSegmentedControl";
import type { ChartTooltipProps } from "./chartTooltip";
import type { UiLanguage } from "./language";
import { usageHistoryMessage, useUsageHistoryI18n, type UsageHistoryMessageKey, type UsageHistoryText } from "./usageHistoryMessage";
import {
  cx,
  uiMenuClass,
} from "./ui/styles";

const WINDOW_OPTIONS: { label: UsageHistoryMessageKey; value: UsageHistoryTrendWindow; helper: UsageHistoryMessageKey }[] = [
  { label: "dayWindow", value: "day", helper: "hourlySnapshots" },
  { label: "weekWindow", value: "week", helper: "dailySnapshots" },
  { label: "monthWindow", value: "month", helper: "dailySnapshots" },
];

type TrendPoint = UsageHistoryTrendResponse["points"][number] & {
  timestampMs: number;
};

type UsageHistoryTrendsSectionProps = {
  trends: UsageHistoryTrendResponse | null;
  window: UsageHistoryTrendWindow;
  onWindowChange: (value: UsageHistoryTrendWindow) => void;
  loading?: boolean;
  error?: string | null;
  title?: string;
  description?: string;
  text?: (message: string, values?: Record<string, string | number>) => string;
  labels?: {
    unavailableDescription?: string;
    latestStorage?: string;
    latestStorageHint?: string;
    latestObjects?: string;
    latestObjectsHint?: string;
    maxQuotaRatio?: string;
    maxQuotaHint?: string;
    snapshots?: string;
    snapshotsHint?: string;
    storageChartTitle?: string;
    storageChartSubtitle?: string;
    inventoryChartTitle?: string;
    inventoryChartSubtitle?: string;
    storageLineName?: string;
    objectLineName?: string;
    bucketLineName?: string;
    emptyMessage?: string;
  };
};

export default function UsageHistoryTrendsSection({
  trends,
  window,
  onWindowChange,
  loading,
  error,
  title,
  description,
  text: translateText,
  labels,
}: UsageHistoryTrendsSectionProps) {
  const { locale, text: defaultText } = useUsageHistoryI18n();
  const text: UsageHistoryText = useCallback(
    (key, values) => translateText ? translateText(usageHistoryMessage[key].en, values) : defaultText(key, values),
    [defaultText, translateText],
  );
  const resolvedTitle = title ?? text("title");
  const chartData = useMemo<TrendPoint[]>(
    () =>
      (trends?.points ?? [])
        .map((point) => ({
          ...point,
          timestampMs: new Date(point.period_start).getTime(),
        }))
        .filter((point) => Number.isFinite(point.timestampMs))
        .sort((a, b) => a.timestampMs - b.timestampMs),
    [trends?.points]
  );
  const domain = useMemo(() => {
    if (!chartData.length) return undefined;
    const minTs = chartData[0]?.timestampMs;
    const maxTs = chartData[chartData.length - 1]?.timestampMs;
    if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) return undefined;
    const dayMs = 24 * 60 * 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    const halfStep = window === "day" ? hourMs / 2 : dayMs / 2;
    return [minTs - halfStep, maxTs + halfStep] as [number, number];
  }, [chartData, window]);
  const summary = trends?.summary;
  const hasData = chartData.length > 0;
  const helper = text(WINDOW_OPTIONS.find((option) => option.value === window)?.helper ?? "storedSnapshots");
  const subtitle = description ?? text("trendsDescription", { helper });

  if (error) {
    return (
      <MetricsUnavailableCard
        title={resolvedTitle}
        description={labels?.unavailableDescription ?? text("unavailableDescription")}
        message={error}
        tone="error"
      />
    );
  }

  if (trends && !trends.available) {
    return (
      <MetricsUnavailableCard
        title={resolvedTitle}
        description={labels?.unavailableDescription ?? text("unavailableDescription")}
        message={trends.unavailable_reason || text("trendsUnavailable")}
      />
    );
  }

  return (
    <MetricsCard
      title={resolvedTitle}
      description={subtitle}
      actions={
        <UiSegmentedControl
          ariaLabel={text("windowLabel", { title: resolvedTitle })}
          options={WINDOW_OPTIONS.map((option) => ({ ...option, label: text(option.label), helper: text(option.helper) }))}
          value={window}
          onChange={onWindowChange}
        />
      }
    >

      <div className="grid gap-4 md:grid-cols-4">
        <MetricsSnapshotCard
          label={labels?.latestStorage ?? text("latestStorage")}
          value={formatBytes(summary?.latest_used_bytes ?? 0)}
          hint={labels?.latestStorageHint ?? text("subjectsCount", { count: formatCompactNumber(summary?.subjects_count ?? 0) })}
          loading={loading}
        />
        <MetricsSnapshotCard
          label={labels?.latestObjects ?? text("latestObjects")}
          value={formatCompactNumber(summary?.latest_used_objects ?? 0)}
          hint={labels?.latestObjectsHint ?? text("bucketsCount", { count: formatCompactNumber(summary?.latest_bucket_count ?? 0) })}
          loading={loading}
        />
        <MetricsSnapshotCard
          label={labels?.maxQuotaRatio ?? text("maxQuotaRatio")}
          value={formatPercentage(summary?.max_usage_ratio_pct)}
          hint={labels?.maxQuotaHint ?? text("highestPoint")}
          loading={loading}
        />
        <MetricsSnapshotCard
          label={labels?.snapshots ?? text("snapshots")}
          value={formatCompactNumber(summary?.total_records ?? 0)}
          hint={labels?.snapshotsHint ?? text("periodsCount", { count: formatCompactNumber(summary?.points_count ?? 0) })}
          loading={loading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          text={text}
          title={labels?.storageChartTitle ?? text("storageEvolution")}
          subtitle={labels?.storageChartSubtitle ?? text("usedBytesOverTime")}
          loading={loading}
          hasData={hasData}
          emptyMessage={labels?.emptyMessage ?? text("emptyTrends")}
        >
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="timestampMs"
                type="number"
                domain={domain ?? ["auto", "auto"]}
                scale="time"
                tickFormatter={(value) => formatAxisTimestamp(value, window, locale)}
                stroke="#94A3B8"
                minTickGap={32}
              />
              <YAxis tickFormatter={(value) => formatBytesAxis(Number(value) || 0)} stroke="#94A3B8" />
              <Tooltip content={<UsageHistoryTooltip window={window} metric="storage" locale={locale} />} />
              <Area type="monotone" dataKey="used_bytes" name={labels?.storageLineName ?? text("storage")} stroke="#4F46E5" fill="#4F46E5" fillOpacity={0.16} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          text={text}
          title={labels?.inventoryChartTitle ?? text("objectsAndBuckets")}
          subtitle={labels?.inventoryChartSubtitle ?? text("inventorySnapshots")}
          loading={loading}
          hasData={hasData}
          emptyMessage={labels?.emptyMessage ?? text("emptyTrends")}
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="timestampMs"
                type="number"
                domain={domain ?? ["auto", "auto"]}
                scale="time"
                tickFormatter={(value) => formatAxisTimestamp(value, window, locale)}
                stroke="#94A3B8"
                minTickGap={32}
              />
              <YAxis tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} stroke="#94A3B8" />
              <Tooltip content={<UsageHistoryTooltip window={window} metric="inventory" locale={locale} />} />
              <Legend />
              <Line type="monotone" dataKey="used_objects" name={labels?.objectLineName ?? text("objects")} stroke="#0EA5E9" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="bucket_count" name={labels?.bucketLineName ?? text("buckets")} stroke="#14B8A6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </MetricsCard>
  );
}

type ChartCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  loading?: boolean;
  hasData?: boolean;
  emptyMessage?: string;
  text: UsageHistoryText;
};

function ChartCard({ title, subtitle, children, loading, hasData, emptyMessage, text }: ChartCardProps) {
  return (
    <MetricsChartPanel
      title={title}
      description={subtitle}
      loading={loading}
      hasData={hasData}
      emptyMessage={emptyMessage ?? text("emptyTrends")}
    >
      {children}
    </MetricsChartPanel>
  );
}

function formatAxisTimestamp(value: string | number, window: UsageHistoryTrendWindow, locale: UiLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (window === "day") {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, { day: "2-digit", month: "short" }).format(date);
}

type UsageHistoryTooltipProps = ChartTooltipProps & {
  window: UsageHistoryTrendWindow;
  metric: "storage" | "inventory";
  locale: UiLanguage;
};

function UsageHistoryTooltip({ payload, label, window, metric, locale }: UsageHistoryTooltipProps) {
  if (!payload?.length) return null;
  const date = label === undefined ? null : new Date(label);
  const formatted = date == null ? "" : Number.isNaN(date.getTime()) ? String(label) : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    ...(window === "day" ? { hour: "2-digit", minute: "2-digit" } as const : {}),
  }).format(date);
  return (
    <div className={cx(uiMenuClass, "px-3 py-2 ui-body")}>
      <p className="font-semibold">{formatted}</p>
      {payload.map((entry, index) => (
        <p key={entry.dataKey ?? entry.name ?? index} className="ui-caption">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {String(entry.name ?? "")}: {formatTooltipValue(String(entry.name ?? ""), entry.value, metric)}
        </p>
      ))}
    </div>
  );
}

function formatTooltipValue(name: string, value: unknown, metric: "storage" | "inventory") {
  const numeric = Number(value) || 0;
  if (metric === "storage" || name === usageHistoryMessage.storage.en) return formatBytes(numeric);
  return formatCompactNumber(numeric);
}
