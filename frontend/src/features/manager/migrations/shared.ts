/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { extractApiError } from "../../../utils/apiError";


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
