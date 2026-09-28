/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { extractApiError } from "../../../utils/apiError";
import type { BucketMigrationItemView } from "../../../api/managerMigrations";


export function extractError(error: unknown): string {
  return extractApiError(error, "Request failed");
}

export function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    create_bucket: "Create bucket",
    copy_bucket_settings: "Copy settings",
    pre_sync: "Pre-sync",
    awaiting_cutover: "Waiting cutover",
    apply_target_lock: "Protect target",
    apply_read_only: "Protect source",
    sync: "Sync",
    verify: "Final verify",
    delete_source: "Delete source",
    completed: "Completed",
    skipped: "Skipped",
    rolled_back: "Rolled back",
  };
  return labels[step] ?? step;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export function normalizeEndpointUrl(value?: string | null): string {
  return (value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function hasSampleContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasSampleContent);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(hasSampleContent);
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== null && value !== undefined;
}

export function migrationDifferenceSample(
  item: BucketMigrationItemView,
): Record<string, unknown> | null {
  if (!item.diff_sample) return null;
  const entries = Object.entries(item.diff_sample).filter(([, value]) =>
    hasSampleContent(value),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function hasMigrationDifferences(
  item: BucketMigrationItemView,
): boolean {
  return (
    (item.different_count ?? 0) > 0 ||
    (item.only_source_count ?? 0) > 0 ||
    (item.only_target_count ?? 0) > 0 ||
    migrationDifferenceSample(item) !== null
  );
}
