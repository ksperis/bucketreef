/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BucketUsageStatsAggregate,
  BucketUsageStatsDistributionEntry,
  BucketUsageStatsSnapshot,
} from "../../api/bucketUsageStats";
import { MetricsEmptyState, MetricsTile } from "../../components/MetricsCard";
import "../../components/compactDashboard.css";
import PageBanner from "../../components/PageBanner";
import { cx, uiCardClass, uiMutedTextClass } from "../../components/ui/styles";
import { formatLocalDateTime } from "../../utils/dateTime";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import {
  nonEmptyUsageStatsEntries,
  UsageStatsChartShell,
  UsageStatsDataTypeDonut,
  UsageStatsDistributionBars,
  UsageStatsEmptyChart,
  usageStatsChartColor,
} from "./BucketUsageStatsCharts";
import { useBucketUsageStatsI18n, type BucketUsageStatsTextOverride } from "./bucketUsageStatsMessage";

type BucketUsageStatsVisualSource = Pick<
  BucketUsageStatsSnapshot,
  | "object_version_count"
  | "total_bytes"
  | "current_bytes"
  | "noncurrent_bytes"
  | "data_type_distribution"
  | "storage_class_distribution"
  | "size_distribution"
  | "age_distribution"
  | "current_vs_noncurrent"
>;

type SummaryMetric = {
  label: string;
  value: string;
  hint?: string;
};

export type BucketUsageStatsCompositionLabels = {
  logicalBytes?: string;
  currentBytes?: string;
  noncurrentBytes?: string;
  versionsUnit?: string;
  unavailable?: string;
  versionListingWarning?: string;
  dataTypesTitle?: string;
  dataTypesSubtitle?: string;
  currentVsNoncurrentTitle?: string;
  currentVsNoncurrentSubtitle?: string;
  storageClassesTitle?: string;
  storageClassesSubtitle?: string;
  objectSizesTitle?: string;
  objectSizesSubtitle?: string;
  objectAgeTitle?: string;
  objectAgeSubtitle?: string;
};

type BucketUsageStatsCompositionVisualsProps = {
  stats: BucketUsageStatsVisualSource;
  finalMetric: SummaryMetric;
  currentVsNoncurrentEmptyMessage?: string;
  showVersionListingWarning?: boolean;
  labels?: BucketUsageStatsCompositionLabels;
  text?: BucketUsageStatsTextOverride;
};

type BucketUsageStatsDataTypesCardProps = {
  presentation?: "compact";
  aggregate?: BucketUsageStatsAggregate | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
  text?: (message: string, values?: Record<string, string | number>) => string;
  locale?: string;
  "data-testid"?: string;
};

function SummaryMetricCard({ label, value, hint }: SummaryMetric) {
  return <MetricsTile label={label} value={value} hint={hint} />;
}

function usageStatsRatio(bytes: number, totalBytes: number, unavailable: string): string {
  return totalBytes > 0 ? formatPercentage((bytes / totalBytes) * 100) : unavailable;
}

function topEntries(entries: BucketUsageStatsDistributionEntry[], limit = 5): BucketUsageStatsDistributionEntry[] {
  return [...entries].sort((left, right) => right.bytes - left.bytes).slice(0, limit);
}

export function BucketUsageStatsCompositionVisuals({
  stats,
  finalMetric,
  currentVsNoncurrentEmptyMessage,
  showVersionListingWarning,
  labels,
  text: translateText,
}: BucketUsageStatsCompositionVisualsProps) {
  const { text } = useBucketUsageStatsI18n(translateText);
  const dataTypes = nonEmptyUsageStatsEntries(stats.data_type_distribution);
  const storageClasses = nonEmptyUsageStatsEntries(stats.storage_class_distribution);
  const sizeDistribution = stats.size_distribution ?? [];
  const ageDistribution = stats.age_distribution ?? [];
  const currentVsNoncurrent = stats.current_vs_noncurrent ?? [];
  const versionBytes = (stats.current_bytes ?? 0) + (stats.noncurrent_bytes ?? 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryMetricCard
          label={labels?.logicalBytes ?? text("logicalBytes")}
          value={formatBytes(stats.total_bytes)}
          hint={`${formatCompactNumber(stats.object_version_count)} ${labels?.versionsUnit ?? text("versionsUnit")}`}
        />
        <SummaryMetricCard
          label={labels?.currentBytes ?? text("currentBytes")}
          value={formatBytes(stats.current_bytes)}
          hint={usageStatsRatio(stats.current_bytes, versionBytes, labels?.unavailable ?? text("unavailable"))}
        />
        <SummaryMetricCard
          label={labels?.noncurrentBytes ?? text("noncurrentBytes")}
          value={formatBytes(stats.noncurrent_bytes)}
          hint={usageStatsRatio(stats.noncurrent_bytes, versionBytes, labels?.unavailable ?? text("unavailable"))}
        />
        <SummaryMetricCard {...finalMetric} />
      </div>

      {showVersionListingWarning && (
        <PageBanner tone="warning">
          {labels?.versionListingWarning ?? text("versionListingWarning")}
        </PageBanner>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <UsageStatsChartShell title={labels?.dataTypesTitle ?? text("dataTypesTitle")} subtitle={labels?.dataTypesSubtitle ?? text("dataTypesSubtitle")}>
          <UsageStatsDataTypeDonut entries={dataTypes} distributionKind="dataType" text={translateText} />
        </UsageStatsChartShell>
        <UsageStatsChartShell title={labels?.currentVsNoncurrentTitle ?? text("currentVsNoncurrentTitle")} subtitle={labels?.currentVsNoncurrentSubtitle ?? text("currentVsNoncurrentSubtitle")}>
          {currentVsNoncurrent.length > 0 ? (
            <UsageStatsDataTypeDonut entries={currentVsNoncurrent} distributionKind="currentVersion" text={translateText} />
          ) : (
            <UsageStatsEmptyChart message={currentVsNoncurrentEmptyMessage ?? text("fallbackScanUnavailable")} />
          )}
        </UsageStatsChartShell>
        <UsageStatsChartShell title={labels?.storageClassesTitle ?? text("storageClassesTitle")} subtitle={labels?.storageClassesSubtitle ?? text("storageClassesSubtitle")}>
          <UsageStatsDistributionBars entries={storageClasses} distributionKind="storageClass" text={translateText} />
        </UsageStatsChartShell>
        <UsageStatsChartShell title={labels?.objectSizesTitle ?? text("objectSizesTitle")} subtitle={labels?.objectSizesSubtitle ?? text("objectSizesSubtitle")}>
          <UsageStatsDistributionBars entries={sizeDistribution} distributionKind="size" bytesAxis={false} text={translateText} />
        </UsageStatsChartShell>
        <UsageStatsChartShell title={labels?.objectAgeTitle ?? text("objectAgeTitle")} subtitle={labels?.objectAgeSubtitle ?? text("objectAgeSubtitle")}>
          <UsageStatsDistributionBars entries={ageDistribution} distributionKind="age" bytesAxis={false} text={translateText} />
        </UsageStatsChartShell>
      </div>
    </div>
  );
}

export function BucketUsageStatsDataTypesCard({
  presentation,
  aggregate,
  loading,
  error,
  className,
  text: translateText,
  locale,
  "data-testid": dataTestId,
}: BucketUsageStatsDataTypesCardProps) {
  const { text, distributionLabel } = useBucketUsageStatsI18n(translateText);
  const rawEntries = nonEmptyUsageStatsEntries(aggregate?.data_type_distribution);
  const entries = topEntries(rawEntries, rawEntries.length);
  const topDataTypes = entries.slice(0, 4);
  const hasSnapshot = Boolean(aggregate && aggregate.buckets_with_snapshot > 0);
  const coverage = aggregate
    ? text("bucketCoverageCount", {
        covered: aggregate.buckets_with_snapshot,
        total: aggregate.bucket_count,
      })
    : "";
  const latest = aggregate?.newest_snapshot_at ? formatLocalDateTime(aggregate.newest_snapshot_at, locale) : null;

  return (
    <section className={cx(uiCardClass, presentation === "compact" ? "ui-dashboard-panel ui-dashboard-data-types" : "h-full p-4", className)} data-testid={dataTestId}>
      <div>
        <div className="min-w-0">
          <h2 className={presentation === "compact" ? "ui-dashboard-title" : "ui-subtitle font-semibold text-[var(--ui-text)]"}>{text("dataTypesTitle")}</h2>
          <div className={cx("mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 ui-caption", uiMutedTextClass)}>
            <span>{latest ? text("latestDate", { date: latest }) : text("latestBucketSnapshots")}</span>
            {aggregate && <span>{coverage}</span>}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-3">
          <PageBanner tone="warning">{error}</PageBanner>
        </div>
      ) : loading && !aggregate ? (
        <div className="mt-3 h-36 animate-pulse rounded-md bg-[var(--ui-surface-muted)]" />
      ) : !hasSnapshot ? (
        <MetricsEmptyState className="mt-3 py-6 ui-caption">{text("noSnapshot")}</MetricsEmptyState>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[128px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[128px_minmax(0,1fr)]">
          <div className="h-32 min-w-0">
            <UsageStatsDataTypeDonut entries={entries} height={128} legendWidth={0} text={translateText} />
          </div>
          <div className="min-w-0 divide-y divide-[color:var(--ui-border-soft)]">
            {topDataTypes.map((entry, index) => (
              <div key={entry.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    data-testid={`manager-dashboard-data-type-color-${entry.key}`}
                    style={{ backgroundColor: usageStatsChartColor(index) }}
                  />
                  <span className={presentation === "compact" ? "ui-dashboard-label ui-dashboard-data-type-label" : "truncate ui-caption font-semibold text-[var(--ui-text)]"} title={distributionLabel(entry, "dataType")}>
                    {distributionLabel(entry, "dataType")}
                  </span>
                </span>
                <span className={cx("shrink-0 ui-caption font-semibold", uiMutedTextClass)}>
                  {formatPercentage(entry.ratio_bytes * 100)}
                </span>
                <span className={cx(presentation === "compact" ? "col-span-2 ui-dashboard-note" : "col-span-2 truncate ui-caption", uiMutedTextClass)}>{formatBytes(entry.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
