/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { describe, expect, it } from "vitest";

import type { MultisiteEndpointOption, MultisiteReplicationRoute } from "./multisiteUtils";
import { getBucketReplicationRoutes, recordsToCsv } from "./multisiteUtils";
import { initialBucketScopeForm, resolveBucketScope } from "./multisiteBucketScope";
import { advanceLogCursor, canAdvanceToNextLog, retreatLogCursor } from "./multisiteLogState";

const endpointOptions: MultisiteEndpointOption[] = [
  { endpointId: 11, endpointName: "Source", zoneId: "zone-a", zoneName: "A", zonegroupId: "zg", zonegroupName: "ZG" },
  { endpointId: 12, endpointName: "Destination", zoneId: "zone-b", zoneName: "B", zonegroupId: "zg", zonegroupName: "ZG" },
];

const routes: MultisiteReplicationRoute[] = [
  { source: endpointOptions[0], destination: endpointOptions[1] },
];

describe("multisite frontend state helpers", () => {
  it("keeps source and destination bucket identities distinct, including tenants", () => {
    expect(resolveBucketScope({
      sourceEndpointId: "11",
      destinationEndpointId: "12",
      sourceBucket: "source-bucket",
      sourceTenant: "source-tenant",
      destinationBucket: "destination-bucket",
      destinationTenant: "destination-tenant",
    }, routes)).toEqual({
      source_endpoint_id: 11,
      destination_endpoint_id: 12,
      source_zone_id: "zone-a",
      source_bucket: "source-bucket",
      source_tenant: "source-tenant",
      bucket: "destination-bucket",
      tenant: "destination-tenant",
    });
    expect(resolveBucketScope({
      sourceEndpointId: "11",
      destinationEndpointId: "11",
      sourceBucket: "same",
      sourceTenant: "",
      destinationBucket: "same",
      destinationTenant: "",
    }, routes)).toBeNull();
  });

  it("initializes the bucket form from the inventory deep link", () => {
    expect(initialBucketScopeForm(new URLSearchParams("ep=12&destination_endpoint_id=12&bucket=archive&tenant=team-a"), routes, 12)).toEqual({
      sourceEndpointId: "11",
      destinationEndpointId: "12",
      sourceBucket: "archive",
      sourceTenant: "team-a",
      destinationBucket: "archive",
      destinationTenant: "team-a",
    });
  });

  it("keeps the configured route when the workspace endpoint is the source", () => {
    expect(initialBucketScopeForm(new URLSearchParams("bucket=archive"), routes, 11)).toMatchObject({
      sourceEndpointId: "11",
      destinationEndpointId: "12",
    });
  });

  it("derives bucket source and destination roles from the multisite topology", () => {
    const topology = {
      period: {
        data: {
          zones: [
            {
              id: "zone-a", name: "A", zonegroup_id: "zg", zonegroup_name: "ZG", metadata_master: true,
              read_only: false, sync_from_all: true, sync_from: [], policy_requires_confirmation: false,
              endpoints: [{ id: 11, name: "Source", diagnostic: true }], diagnostic_endpoint_id: 11,
            },
            {
              id: "zone-b", name: "B", zonegroup_id: "zg", zonegroup_name: "ZG", metadata_master: false,
              read_only: true, sync_from_all: true, sync_from: [], policy_requires_confirmation: false,
              endpoints: [{ id: 12, name: "Destination", diagnostic: true }], diagnostic_endpoint_id: 12,
            },
          ],
        },
      },
    } as Parameters<typeof getBucketReplicationRoutes>[0];

    expect(getBucketReplicationRoutes(topology)).toEqual([
      { source: endpointOptions[0], destination: endpointOptions[1] },
    ]);
  });

  it("honors explicit sync-from restrictions when deriving bucket routes", () => {
    const topology = {
      period: {
        data: {
          zones: [
            {
              id: "zone-a", name: "A", zonegroup_id: "zg", zonegroup_name: "ZG", metadata_master: true,
              read_only: false, sync_from_all: false, sync_from: [], policy_requires_confirmation: false,
              endpoints: [{ id: 11, name: "Source", diagnostic: true }], diagnostic_endpoint_id: 11,
            },
            {
              id: "zone-b", name: "B", zonegroup_id: "zg", zonegroup_name: "ZG", metadata_master: false,
              read_only: false, sync_from_all: false, sync_from: ["zone-a"], policy_requires_confirmation: false,
              endpoints: [{ id: 12, name: "Destination", diagnostic: true }], diagnostic_endpoint_id: 12,
            },
          ],
        },
      },
    } as Parameters<typeof getBucketReplicationRoutes>[0];

    expect(getBucketReplicationRoutes(topology)).toEqual([
      { source: endpointOptions[0], destination: endpointOptions[1] },
    ]);
  });

  it("tracks previous log cursors and only exposes next_log after the page is complete", () => {
    const second = advanceLogCursor({ current: null, previous: [] }, "cursor-a");
    const third = advanceLogCursor(second, "cursor-b");
    expect(retreatLogCursor(third)).toEqual({ current: "cursor-a", previous: [null] });
    expect(canAdvanceToNextLog({
      family: "bucket-index", scope: {}, entries: [], next_cursor: "cursor-c", truncated: true,
      last_update: null, next_log: { generation: "18446744073709551615", num_shards: 4 },
    })).toBe(false);
    expect(canAdvanceToNextLog({
      family: "bucket-index", scope: {}, entries: [], next_cursor: null, truncated: false,
      last_update: null, next_log: { generation: "18446744073709551615", num_shards: 4 },
    })).toBe(true);
  });

  it("neutralizes spreadsheet formulas in CSV exports", () => {
    const csv = recordsToCsv([{ value: "=HYPERLINK(\"https://example.invalid\")", safe: "plain" }, { value: " +SUM(1,2)", safe: "@user" }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("' +SUM(1,2)");
    expect(csv).toContain("'@user");
  });
});
