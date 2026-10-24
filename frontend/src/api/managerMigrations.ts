/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { sanitizeErrorMessage } from "../utils/apiError";
import { openSseStream, resolveApiBaseUrl } from "./sseBucketsStream";
import { consumeSseStream } from "./sseStream";

export type BucketMigrationMode = "one_shot" | "pre_sync";
export type BucketMigrationStatus =
  | "draft"
  | "queued"
  | "running"
  | "pause_requested"
  | "paused"
  | "awaiting_cutover"
  | "cancel_requested"
  | "canceled"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "rolled_back";
export type BucketMigrationPrecheckStatus = "pending" | "passed" | "failed";
export type BucketMigrationPrecheckEntry = {
  code: string;
  severity: "info" | "warning" | "error";
  blocking: boolean;
  scope: string;
  message: string;
  details: Record<string, unknown> | null;
  remediation: string | null;
  impact: string | null;
  permission: string | null;
  context_id: string | null;
  bucket: string | null;
};

type BucketMigrationPrecheckItemReport = {
  item_id: number;
  state: "ready" | "blocked" | "unverified" | "warning";
  blocking: boolean;
  warnings: number;
  settings_copied: string[];
  settings_omitted: string[];
  source_bucket: string;
  strategy: string;
  source_object_count: number | null;
  checks: BucketMigrationPrecheckEntry[];
};

export type BucketMigrationPrecheckReport = {
  checks: BucketMigrationPrecheckEntry[];
  items: BucketMigrationPrecheckItemReport[];
  errors: number;
  warnings: number;
};

type BucketMigrationItemStatus =
  | "pending"
  | "running"
  | "awaiting_cutover"
  | "paused"
  | "skipped"
  | "completed"
  | "rolled_back"
  | "failed"
  | "canceled";

type BucketMigrationBucketMapping = {
  source_bucket: string;
  target_bucket: string;
};

type BucketMigrationDraftRequest = {
  source_context_id: string;
  target_context_id: string;
  buckets: BucketMigrationBucketMapping[];
  mode?: BucketMigrationMode;
  copy_bucket_settings?: boolean;
  strong_integrity_check?: boolean;
  lock_target_writes?: boolean;
  use_same_endpoint_copy?: boolean;
  auto_grant_source_read_for_copy?: boolean;
  parallelism_max?: number;
};

export type BucketMigrationCreateRequest = BucketMigrationDraftRequest;

type BucketMigrationUpdateRequest = BucketMigrationDraftRequest & {
  configuration_revision: number;
};

export type BucketMigrationItemView = {
  id: number;
  source_bucket: string;
  target_bucket: string;
  status: BucketMigrationItemStatus;
  step: string;
  read_only_applied: boolean;
  target_lock_applied: boolean;
  target_created_by_migration: boolean;
  recovery_required: boolean;
  source_deleted: boolean;
  cleanup_error: string | null;
  objects_copied: number;
  different_count: number | null;
  only_source_count: number | null;
  only_target_count: number | null;
  diff_sample: Record<string, unknown> | null;
  error_message: string | null;
};

export type BucketMigrationEventView = {
  id: number;
  message: string;
  created_at: string;
};

export type BucketMigrationView = {
  id: number;
  source_context_id: string;
  target_context_id: string;
  mode: BucketMigrationMode;
  copy_bucket_settings: boolean;
  lock_target_writes: boolean;
  use_same_endpoint_copy: boolean;
  auto_grant_source_read_for_copy: boolean;
  status: BucketMigrationStatus;
  precheck_status: BucketMigrationPrecheckStatus;
  precheck_report: BucketMigrationPrecheckReport | null;
  precheck_checked_at: string | null;
  configuration_revision: number;
  preparation_status: "unverified" | "checking" | "blocked" | "ready" | "stale";
  preparation_active_checks: boolean;
  preparation_completed_items: number;
  maintenance_operation: "restore_access" | "cleanup_source" | "cleanup_target" | null;
  maintenance_status: string;
  maintenance_error: string | null;
  available_actions: Record<string, { enabled: boolean; reason: string | null }>;
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items: number;
  awaiting_items: number;
  error_message: string | null;
  updated_at: string;
};

export type BucketMigrationDetail = BucketMigrationView & {
  items: BucketMigrationItemView[];
  recent_events: BucketMigrationEventView[];
};

type BucketMigrationListResponse = {
  items: BucketMigrationView[];
};

type BucketMigrationActionResponse = {
  id: number;
  status: BucketMigrationStatus;
  message: string;
};

type ManagerMigrationStreamDone = {
  migration_id: number;
  status: BucketMigrationStatus;
  reason: string;
};

type ManagerMigrationStreamOptions = {
  eventsLimit?: number;
  signal?: AbortSignal;
  onSnapshot?: (detail: BucketMigrationDetail) => void;
  onDone?: (event: ManagerMigrationStreamDone) => void;
};

export async function listManagerMigrations(limit = 100, contextId?: string | null): Promise<BucketMigrationView[]> {
  const params: { limit: number; context_id?: string } = { limit };
  if (contextId && contextId.trim()) {
    params.context_id = contextId.trim();
  }
  const { data } = await client.get<BucketMigrationListResponse>("/manager/migrations", { params });
  return data.items;
}

export async function getManagerMigration(migrationId: number, eventsLimit = 200): Promise<BucketMigrationDetail> {
  const { data } = await client.get<BucketMigrationDetail>(`/manager/migrations/${migrationId}`, {
    params: { events_limit: eventsLimit },
  });
  return data;
}

export async function streamManagerMigration(
  migrationId: number,
  options?: ManagerMigrationStreamOptions
): Promise<BucketMigrationDetail> {
  const baseUrl = resolveApiBaseUrl();
  const query = new URLSearchParams();
  query.set("events_limit", String(Math.max(1, Math.min(1000, Math.floor(options?.eventsLimit ?? 200)))));
  const url = `${baseUrl}/manager/migrations/${migrationId}/stream?${query.toString()}`;
  const body = await openSseStream({
    url,
    signal: options?.signal,
    streamFailedLabel: "Migration stream failed",
  });

  let latestSnapshot: BucketMigrationDetail | null = null;

  await consumeSseStream(body, ({ event, data }) => {
    const payload = data ? (JSON.parse(data) as Record<string, unknown>) : {};
    if (event === "snapshot") {
      const detail = payload as unknown as BucketMigrationDetail;
      latestSnapshot = detail;
      options?.onSnapshot?.(detail);
    } else if (event === "done") {
      options?.onDone?.(payload as unknown as ManagerMigrationStreamDone);
    } else if (event === "error") {
      const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
      throw new Error(sanitizeErrorMessage(detail || "Migration stream failed", "Migration stream failed"));
    }
  });

  if (!latestSnapshot) {
    throw new Error("Migration stream ended without a snapshot payload");
  }
  return latestSnapshot;
}

export async function deleteManagerMigration(migrationId: number): Promise<void> {
  await client.delete(`/manager/migrations/${migrationId}`);
}

export async function createManagerMigration(payload: BucketMigrationCreateRequest): Promise<BucketMigrationDetail> {
  const { data } = await client.post<BucketMigrationDetail>("/manager/migrations", payload);
  return data;
}

export async function updateManagerMigration(
  migrationId: number,
  payload: BucketMigrationUpdateRequest
): Promise<BucketMigrationDetail> {
  const { data } = await client.patch<BucketMigrationDetail>(`/manager/migrations/${migrationId}`, payload);
  return data;
}

export async function runManagerMigrationPrecheck(migrationId: number, activeChecks = false): Promise<BucketMigrationDetail> {
  const { data } = await client.post<BucketMigrationDetail>(`/manager/migrations/${migrationId}/precheck`, { active_checks: activeChecks });
  return data;
}

export async function startManagerMigration(migrationId: number, configurationRevision: number, confirmWriteInterruption = false): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/start`, { configuration_revision: configurationRevision, confirm_write_interruption: confirmWriteInterruption });
  return data;
}

export async function pauseManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/pause`);
  return data;
}

export async function resumeManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/resume`);
  return data;
}

export async function stopManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/stop`);
  return data;
}

export async function continueManagerMigration(migrationId: number, confirmed: boolean): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/continue`, { confirmed });
  return data;
}

export async function retryFailedManagerMigrationItems(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/items/retry-failed`);
  return data;
}

export async function runManagerMigrationMaintenance(migrationId: number, operation: "restore_access" | "cleanup_source" | "cleanup_target"): Promise<BucketMigrationActionResponse> {
  const path = operation.replaceAll("_", "-");
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/${path}`, { confirmed: true });
  return data;
}
