/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
// Synthetic API fixtures for rendered route tests; no live Ceph evidence.
import type { MultisiteBucketDiagnostic, MultisiteObservation, MultisiteOverview, MultisiteSyncStatus, MultisiteTopology } from "../../../src/api/cephMultisite";
import type { MockRule } from "../types";

function multisiteObservation<T>(data: T, endpointId = 12): MultisiteObservation<T> {
  return { availability: "available", data, collected_at: "2026-10-27T10:00:00.123456Z", last_success_at: "2026-10-27T10:00:00.123456Z", stale: false,
    provenance: { endpoint_id: endpointId, realm_id: "realm-a", local_zone_id: endpointId === 11 ? "zone-a" : "zone-b", source_zone_id: "zone-a", operation: "data_status", http_status: 200, duration_ms: 10, collection_id: "synthetic-collection" }, reason_code: null };
}

const MULTISITE_TOPOLOGY: MultisiteTopology = {
  configured: true, configuration_reason: null,
  local_zone: multisiteObservation({ id: "zone-a", name: "Paris", realm_id: "realm-a", placements: [{ name: "default-placement", storage_classes: ["STANDARD"] }], storage_classes: ["STANDARD"] }, 11),
  period: multisiteObservation({ id: "period-a", realm_id: "realm-a", epoch: "9", realm_epoch: "11", master_zone: "zone-a", details: {},
    zones: [
      { id: "zone-a", name: "Paris", zonegroup_id: "zg-a", zonegroup_name: "Europe", metadata_master: true, read_only: false, sync_from_all: true, sync_from: [], policy_requires_confirmation: false,
        endpoints: [{ id: 11, name: "Ceph Paris", diagnostic: true }], diagnostic_endpoint_id: 11 },
      { id: "zone-b", name: "Lyon", zonegroup_id: "zg-a", zonegroup_name: "Europe", metadata_master: false, read_only: false, sync_from_all: true, sync_from: [], policy_requires_confirmation: false,
        endpoints: [{ id: 12, name: "Ceph Lyon", diagnostic: true }], diagnostic_endpoint_id: 12 },
      { id: "zone-c", name: "Unavailable remote zone with a long operational display name", zonegroup_id: "zg-a", zonegroup_name: "Europe", metadata_master: false, read_only: true, sync_from_all: true, sync_from: [], policy_requires_confirmation: true,
        endpoints: [], diagnostic_endpoint_id: null },
    ] }, 11),
  realm: multisiteObservation({ id: "realm-a", name: "European realm" }, 11),
};
const MULTISITE_STATE = {
  status: "active" as const,
  realm_id: "realm-a",
  local_zone_id: "zone-a",
  checked_at: "2026-10-27T10:00:00.123456Z",
  availability: "available" as const,
  reason_code: null,
};

const MULTISITE_STATUS: MultisiteSyncStatus = {
  family: "data", phase: "sync", raw_status: "sync", expected_shards: 2, period: "period-a", realm_epoch: "11", instance_id: "9007199254740993", generation: null, details: {},
  shards: [0, 1].map((shard_id) => ({ shard_id, phase: "incremental-sync", raw_status: "incremental-sync", marker: `${shard_id}.${"opaque-marker".repeat(12)}`, timestamp: "2026-10-27T09:59:59.123456Z", details: {} })),
};
const MULTISITE_OVERVIEW: MultisiteOverview = {
  topology: MULTISITE_TOPOLOGY,
  metadata: [{ destination_endpoint_id: 12, destination_zone_id: "zone-b", source_zone_id: "zone-a", scope_requires_confirmation: false, status: multisiteObservation({ ...MULTISITE_STATUS, family: "metadata" }) }],
  data: [{ destination_endpoint_id: 12, destination_zone_id: "zone-b", source_zone_id: "zone-a", scope_requires_confirmation: false, status: multisiteObservation(MULTISITE_STATUS) }],
  uncollected: ["zone-c"], next_offset: null,
};
const MULTISITE_BUCKET: MultisiteBucketDiagnostic = {
  source: multisiteObservation({ name: "archive-source", tenant: "team-a", instance_id: "source-instance" }, 11),
  destination: multisiteObservation({ name: "archive", tenant: "team-a", instance_id: "destination-instance" }),
  status: multisiteObservation({ ...MULTISITE_STATUS, family: "bucket-index", phase: "incremental-sync", generation: "9007199254740993" }),
  bilog: multisiteObservation({ latest_gen: "9007199254740994", oldest_gen: "9007199254740993", generations: [{ gen: "9007199254740993", num_shards: 2 }, { gen: "9007199254740994", num_shards: 4 }], details: {} }, 11),
};

export function multisiteRules(): MockRule[] {
  const base = "\\/ceph-admin\\/endpoints\\/\\d+\\/multisite\\/";
  return [
    { id: "multisite-state", path: new RegExp(`^${base}state$`), body: MULTISITE_STATE },
    { id: "multisite-topology", path: new RegExp(`^${base}topology$`), body: MULTISITE_TOPOLOGY },
    { id: "multisite-overview", path: new RegExp(`^${base}overview$`), body: MULTISITE_OVERVIEW },
    { id: "multisite-bucket", path: new RegExp(`^${base}bucket/status$`), body: MULTISITE_BUCKET },
    { id: "multisite-logs", path: new RegExp(`^${base}logs/(metadata|data|bucket-index)$`), body: ({ url }) => multisiteObservation({
      family: url.pathname.split("/").at(-1), scope: Object.fromEntries(url.searchParams),
      entries: url.searchParams.get("cursor") ? [{ op_id: "op-2", object: "second-entry", op: "del", state: "complete", timestamp: "2026-10-27T09:58:02Z" }]
        : [{ op_id: "op-1", object: "=HYPERLINK(\"untrusted\")", op: "write", state: "complete", id: "md-1", section: "bucket.instance", name: "archive", log_id: "data-1", entry: { key: "archive:instance", gen: "9007199254740993" }, timestamp: "2026-10-27T09:58:01Z" }],
      next_cursor: url.searchParams.get("cursor") ? null : "op-1", truncated: !url.searchParams.get("cursor"), last_update: "2026-10-27T09:58:03Z", next_log: null,
    }, 11) },
  ];
}
