/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import client from "./client";

export type MultisiteFamily = "metadata" | "data" | "bucket-index";
export type MultisiteAvailability = "available" | "not_observed" | "not_applicable" | "not_found" | "denied" | "unsupported" | "unavailable" | "misconfigured";
export type MultisiteObservation<T> = {
  availability: MultisiteAvailability;
  data: T | null;
  collected_at: string;
  last_success_at: string | null;
  stale: boolean;
  reason_code: string | null;
  provenance: {
    endpoint_id: number;
    realm_id: string | null;
    local_zone_id: string | null;
    source_zone_id: string | null;
    operation: string;
    http_status: number | null;
    duration_ms: number;
    collection_id: string;
  };
};
export type MultisiteZone = {
  id: string; name: string; zonegroup_id: string; zonegroup_name: string;
  metadata_master: boolean; read_only: boolean | null;
  sync_from_all: boolean | null; sync_from: string[]; policy_requires_confirmation: boolean;
  endpoints: { id: number; name: string; diagnostic: boolean }[];
  diagnostic_endpoint_id: number | null;
};
export type MultisiteTopology = {
  period: MultisiteObservation<{
    id: string; realm_id: string; epoch: string | null; realm_epoch: string | null;
    master_zone: string | null; zones: MultisiteZone[]; details: Record<string, unknown>;
  }>;
  realm: MultisiteObservation<Record<string, unknown>> | null;
  association_valid: boolean;
  association_reason: string | null;
};
export type MultisiteShard = {
  shard_id: number; phase: string; raw_status: string | number | null;
  marker: string | null; timestamp: string | null; details: Record<string, unknown>;
};
export type MultisiteSyncStatus = {
  family: MultisiteFamily; phase: string; raw_status: string | null;
  expected_shards: number | null; period: string | null; realm_epoch: string | null;
  instance_id: string | null; generation: string | null;
  shards: MultisiteShard[]; details: Record<string, unknown>;
};
export type MultisiteFlow = {
  destination_endpoint_id: number; destination_zone_id: string; source_zone_id: string;
  status: MultisiteObservation<MultisiteSyncStatus>; scope_requires_confirmation: boolean;
};
export type MultisiteOverview = {
  topology: MultisiteTopology; metadata: MultisiteFlow[]; data: MultisiteFlow[];
  uncollected: string[]; next_offset: number | null;
};
export type MultisiteBucketIdentity = { name: string; tenant: string | null; instance_id: string };
export type MultisiteBilogInfo = {
  latest_gen: string | null; oldest_gen: string | null;
  generations: { gen: string; num_shards: number }[]; details: Record<string, unknown>;
};
export type MultisiteBucketDiagnostic = {
  source: MultisiteObservation<MultisiteBucketIdentity>;
  destination: MultisiteObservation<MultisiteBucketIdentity>;
  status: MultisiteObservation<MultisiteSyncStatus>;
  bilog: MultisiteObservation<MultisiteBilogInfo>;
};
export type MultisiteLogPage = {
  family: MultisiteFamily; scope: Record<string, unknown>; entries: Record<string, unknown>[];
  next_cursor: string | null; truncated: boolean; last_update: string | null;
  next_log: { generation: string; num_shards: number } | null;
};
export type MultisiteBucketScope = {
  source_endpoint_id: number; destination_endpoint_id: number; source_zone_id: string;
  bucket: string; tenant?: string; source_bucket: string; source_tenant?: string;
};
export type MultisiteLogScope = {
  target_endpoint_id: number; shard?: number; period?: string;
  bucket?: string; tenant?: string; instance_id?: string; generation?: string;
  cursor?: string; limit?: number;
};

async function get<T>(endpointId: number, path: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const { data } = await client.get<T>(`/ceph-admin/endpoints/${endpointId}/multisite/${path}`, {
    params, signal, timeout: 25000,
  });
  return data;
}
export function getMultisiteTopology(endpointId: number, signal?: AbortSignal) {
  return get<MultisiteTopology>(endpointId, "topology", {}, signal);
}
export function getMultisiteOverview(endpointId: number, offset = 0, signal?: AbortSignal) {
  return get<MultisiteOverview>(endpointId, "overview", { offset }, signal);
}
export function getMultisiteFlow(endpointId: number, destination_endpoint_id: number, source_zone_id: string, family: "metadata" | "data", signal?: AbortSignal) {
  return get<MultisiteFlow>(endpointId, "flows/status", { destination_endpoint_id, source_zone_id, family }, signal);
}
export function getMultisiteBucketStatus(endpointId: number, scope: MultisiteBucketScope, signal?: AbortSignal) {
  return get<MultisiteBucketDiagnostic>(endpointId, "bucket/status", scope, signal);
}
export function getMultisiteLogs(endpointId: number, family: MultisiteFamily, scope: MultisiteLogScope, signal?: AbortSignal) {
  return get<MultisiteObservation<MultisiteLogPage>>(endpointId, `logs/${family}`, scope, signal);
}
