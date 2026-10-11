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

function fallbackText(message: string, values?: Record<string, string | number>): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

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
  const text = translateText ?? fallbackText;
  const resolvedCoverageItemLabel = coverageItemLabel ?? text("buckets");
  const hasSnapshot = Boolean(aggregate && aggregate.buckets_with_snapshot > 0);
  const coverageLabel = aggregate
    ? text("{covered} / {total} {items} covered", {
        covered: aggregate.buckets_with_snapshot,
        total: aggregate.bucket_count,
        items: resolvedCoverageItemLabel,
      })
    : "";
  const lastCalculated = aggregate?.newest_snapshot_at
    ? text("Latest {date}", { date: formatLocalDateTime(aggregate.newest_snapshot_at) })
    : undefined;
  const accountCoverage =
    aggregate?.managed_account_count != null
      ? text("{listed} / {total} managed accounts listed", {
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
            {text("Cancel calculation")}
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
            {emptyTitle ?? text("No usage stats calculated yet.")}
          </span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>
            {emptyDescription ??
              (aggregate?.bucket_count
                ? text("0 / {total} {items} covered.", {
                    total: aggregate.bucket_count,
                    items: resolvedCoverageItemLabel,
                  })
                : text("Run a calculation to create the first snapshot."))}
          </span>
        </MetricsEmptyState>
      ) : (
        <>
          {aggregate.warnings.map((warning) => (
            <PageBanner key={warning} tone="warning">{warning}</PageBanner>
          ))}

          <BucketUsageStatsCompositionVisuals
            stats={aggregate}
            finalMetric={{ label: text("Coverage"), value: coverageLabel, hint: coverageHint }}
            currentVsNoncurrentEmptyMessage={text("Current/non-current unavailable.")}
            labels={{
              logicalBytes: text("Logical bytes"),
              currentBytes: text("Current bytes"),
              noncurrentBytes: text("Non-current bytes"),
              versionsUnit: text("version(s)"),
              unavailable: text("Unavailable"),
              versionListingWarning: text("Version listing was unavailable. Current/non-current space distribution cannot be calculated from the fallback listing."),
              dataTypesTitle: text("Data types"),
              dataTypesSubtitle: text("Logical bytes by inferred object type"),
              currentVsNoncurrentTitle: text("Current vs non-current"),
              currentVsNoncurrentSubtitle: text("Stored object-version bytes"),
              storageClassesTitle: text("Storage classes"),
              storageClassesSubtitle: text("Logical bytes by storage class"),
              objectSizesTitle: text("Object sizes"),
              objectSizesSubtitle: text("Version count by object size"),
              objectAgeTitle: text("Object age"),
              objectAgeSubtitle: text("Version count by last modified date"),
              ...compositionLabels,
            }}
          />
        </>
      )}
    </MetricsCard>
  );
}
