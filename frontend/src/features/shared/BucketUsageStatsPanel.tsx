/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketUsageStatsSnapshot } from "../../api/bucketUsageStats";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import { formatCompactNumber } from "../../utils/format";
import { formatLocalDateTime } from "../../utils/dateTime";
import { BucketUsageStatsCompositionVisuals } from "./BucketUsageStatsVisuals";
import { useBucketUsageStatsI18n } from "./bucketUsageStatsMessage";

type BucketUsageStatsPanelProps = {
  title?: string;
  snapshot?: BucketUsageStatsSnapshot | null;
  loading?: boolean;
  error?: string | null;
  recalculating?: boolean;
  onCancel?: () => void;
  onRefresh?: () => void;
  onRecalculate?: () => void;
  text?: (message: string, values?: Record<string, string | number>) => string;
};

export default function BucketUsageStatsPanel({
  title,
  snapshot,
  loading,
  error,
  recalculating,
  onCancel,
  onRefresh,
  onRecalculate,
  text: translateText,
}: BucketUsageStatsPanelProps) {
  const { text } = useBucketUsageStatsI18n(translateText);
  return (
    <MetricsCard
      title={title ?? text("usageStats")}
      description={text("snapshotDescription")}
      actions={
        <>
          {onRefresh && (
            <UiButton
              size="xs"
              variant="secondary"
              onClick={onRefresh}
              disabled={loading || recalculating}
            >
              {text(loading ? "loading" : "refresh")}
            </UiButton>
          )}
          {recalculating && onCancel ? (
            <UiButton
              size="xs"
              variant="danger"
              onClick={onCancel}
            >
              {text("cancelCalculation")}
            </UiButton>
          ) : onRecalculate && import.meta.env.MODE !== "demo" ? (
            <UiButton
              size="xs"
              variant="primary"
              onClick={onRecalculate}
            >
              {text("recalculate")}
            </UiButton>
          ) : null}
        </>
      }
    >

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {snapshot?.warnings?.map((warning) => (
        <PageBanner key={warning} tone="warning">{warning}</PageBanner>
      ))}

      {loading && !snapshot ? (
        <div className="grid gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="h-20 animate-pulse rounded-lg bg-[var(--ui-surface-muted)]" />
          ))}
        </div>
      ) : !snapshot ? (
        <MetricsEmptyState>
          <span className="block font-semibold text-[var(--ui-text)]">{text("noCalculation")}</span>
          <span className="block ui-caption">{text("persistSnapshotDescription")}</span>
        </MetricsEmptyState>
      ) : (
        <BucketUsageStatsCompositionVisuals
          stats={snapshot}
          text={translateText}
          finalMetric={{
            label: text("deleteMarkers"),
            value: formatCompactNumber(snapshot.delete_marker_count),
            hint: text("calculatedDate", { date: formatLocalDateTime(snapshot.calculated_at) }),
          }}
          showVersionListingWarning={!snapshot.version_listing_available}
          currentVsNoncurrentEmptyMessage={text("fallbackScanUnavailable")}
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
          }}
        />
      )}
    </MetricsCard>
  );
}
