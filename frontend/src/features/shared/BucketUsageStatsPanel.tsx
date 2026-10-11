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

function fallbackText(message: string, values?: Record<string, string | number>): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

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
  const text = translateText ?? fallbackText;
  return (
    <MetricsCard
      title={title ?? text("Usage stats")}
      description={text("Latest persisted calculation from object listings. Space ratios use logical object-version bytes.")}
      actions={
        <>
          {onRefresh && (
            <UiButton
              size="xs"
              variant="secondary"
              onClick={onRefresh}
              disabled={loading || recalculating}
            >
              {text(loading ? "Loading..." : "Refresh")}
            </UiButton>
          )}
          {recalculating && onCancel ? (
            <UiButton
              size="xs"
              variant="danger"
              onClick={onCancel}
            >
              {text("Cancel calculation")}
            </UiButton>
          ) : onRecalculate && import.meta.env.MODE !== "demo" ? (
            <UiButton
              size="xs"
              variant="primary"
              onClick={onRecalculate}
            >
              {text("Recalculate")}
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
          <span className="block font-semibold text-[var(--ui-text)]">{text("No usage stats calculated yet.")}</span>
          <span className="block ui-caption">{text("Run a calculation to persist the latest bucket snapshot.")}</span>
        </MetricsEmptyState>
      ) : (
        <BucketUsageStatsCompositionVisuals
          stats={snapshot}
          finalMetric={{
            label: text("Delete markers"),
            value: formatCompactNumber(snapshot.delete_marker_count),
            hint: text("Calculated {date}", { date: formatLocalDateTime(snapshot.calculated_at) }),
          }}
          showVersionListingWarning={!snapshot.version_listing_available}
          currentVsNoncurrentEmptyMessage={text("Unavailable for fallback current-only scans.")}
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
          }}
        />
      )}
    </MetricsCard>
  );
}
