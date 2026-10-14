/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketUsageStatsAggregate } from "../../api/bucketUsageStats";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { formatLocalDateTime } from "../../utils/dateTime";
import {
  BucketUsageStatsCompositionVisuals,
  type BucketUsageStatsCompositionLabels,
} from "./BucketUsageStatsVisuals";
import { useBucketUsageStatsI18n } from "./bucketUsageStatsMessage";

type BucketUsageStatsAggregateCardProps = {
  title: string;
  description: string;
  aggregate?: BucketUsageStatsAggregate | null;
  loading?: boolean;
  error?: string | null;
  recalculating?: boolean;
  recalculateLabel: string;
  onCancel?: () => void;
  onRecalculate?: () => void;
  className?: string;
  coverageItemLabel?: string;
  emptyDescription?: string;
  emptyTitle?: string;
  compositionLabels?: BucketUsageStatsCompositionLabels;
  text?: (message: string, values?: Record<string, string | number>) => string;
};

export default function BucketUsageStatsAggregateCard({
  title,
  description,
  aggregate,
  loading,
  error,
  recalculating,
  recalculateLabel,
  onCancel,
  onRecalculate,
  className,
  coverageItemLabel,
  emptyDescription,
  emptyTitle,
  compositionLabels,
  text: translateText,
}: BucketUsageStatsAggregateCardProps) {
  const { text } = useBucketUsageStatsI18n(translateText);
  const resolvedCoverageItemLabel = coverageItemLabel ?? text("buckets");
  const hasSnapshot = Boolean(aggregate && aggregate.buckets_with_snapshot > 0);
  const coverageLabel = aggregate
    ? text("coverageCount", {
        covered: aggregate.buckets_with_snapshot,
        total: aggregate.bucket_count,
        items: resolvedCoverageItemLabel,
      })
    : "";
  const lastCalculated = aggregate?.newest_snapshot_at
    ? text("latestDate", { date: formatLocalDateTime(aggregate.newest_snapshot_at) })
    : undefined;
  const accountCoverage =
    aggregate?.managed_account_count != null
      ? text("managedAccountCoverage", {
          listed: aggregate.accounts_with_listed_buckets ?? 0,
          total: aggregate.managed_account_count,
        })
      : undefined;
  const coverageHint = accountCoverage ? `${accountCoverage}${lastCalculated ? ` · ${lastCalculated}` : ""}` : lastCalculated;

  return (
    <MetricsCard
      title={title}
      description={description}
      className={className}
      actions={
        recalculating && onCancel ? (
          <UiButton
            size="xs"
            variant="danger"
            onClick={onCancel}
            className="shrink-0"
          >
            {text("cancelCalculation")}
          </UiButton>
        ) : onRecalculate && import.meta.env.MODE !== "demo" ? (
          <UiButton
            size="xs"
            variant="secondary"
            onClick={onRecalculate}
            disabled={loading}
            className="shrink-0"
          >
            {recalculateLabel}
          </UiButton>
        ) : null
      }
    >

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {loading && !aggregate ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="h-14 animate-pulse rounded-md bg-[var(--ui-surface-muted)]" />
          ))}
        </div>
      ) : !aggregate || !hasSnapshot ? (
        <MetricsEmptyState>
          <span className={cx("block font-semibold", uiTitleTextClass)}>
            {emptyTitle ?? text("noCalculation")}
          </span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>
            {emptyDescription ??
              (aggregate?.bucket_count
                ? text("emptyCoverageCount", {
                    total: aggregate.bucket_count,
                    items: resolvedCoverageItemLabel,
                  })
                : text("firstSnapshotDescription"))}
          </span>
        </MetricsEmptyState>
      ) : (
        <>
          {aggregate.warnings.map((warning) => (
            <PageBanner key={warning} tone="warning">{warning}</PageBanner>
          ))}

          <BucketUsageStatsCompositionVisuals
            stats={aggregate}
            text={translateText}
            finalMetric={{ label: text("coverage"), value: coverageLabel, hint: coverageHint }}
            currentVsNoncurrentEmptyMessage={text("currentVsNoncurrentUnavailable")}
            labels={{
              logicalBytes: text("logicalBytes"),
              currentBytes: text("currentBytes"),
              noncurrentBytes: text("noncurrentBytes"),
              versionsUnit: text("versionsUnit"),
              unavailable: text("unavailable"),
              versionListingWarning: text("versionListingWarning"),
              dataTypesTitle: text("dataTypesTitle"),
              dataTypesSubtitle: text("dataTypesSubtitle"),
              currentVsNoncurrentTitle: text("currentVsNoncurrentTitle"),
              currentVsNoncurrentSubtitle: text("currentVsNoncurrentSubtitle"),
              storageClassesTitle: text("storageClassesTitle"),
              storageClassesSubtitle: text("storageClassesSubtitle"),
              objectSizesTitle: text("objectSizesTitle"),
              objectSizesSubtitle: text("objectSizesSubtitle"),
              objectAgeTitle: text("objectAgeTitle"),
              objectAgeSubtitle: text("objectAgeSubtitle"),
              ...compositionLabels,
            }}
          />
        </>
      )}
    </MetricsCard>
  );
}
