/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import {
  resolveBulkCorsDeleteTarget,
  resolveBulkLifecycleDeleteTarget,
  resolveBulkNotificationDeleteTarget,
  resolveBulkPolicyDeleteTarget,
  resolveBulkPolicyMergeTarget,
  resolveBulkPublicAccessBlockTarget,
  resolveBulkQuotaTarget,
  resolveBulkVersioningTarget,
} from "./bucketOpsBulkTargets";

describe("bulk operation targets", () => {
  it("resolves versioning changes from the normalized current status", () => {
    expect(resolveBulkVersioningTarget("Enabled", true)).toEqual({
      currentEnabled: true,
      targetEnabled: true,
      changed: false,
    });
    expect(resolveBulkVersioningTarget("unknown", false)).toEqual({
      currentEnabled: null,
      targetEnabled: false,
      changed: true,
    });
  });

  it("preserves untouched quota dimensions and configured quotas", () => {
    const parsed = {
      applySize: true,
      applyObjects: false,
      maxSizeValue: 2,
      maxSizeUnit: "GiB" as const,
      maxSizeBytes: 2 * 1024 ** 3,
      maxObjects: null,
    };

    expect(
      resolveBulkQuotaTarget(
        { maxSizeBytes: null, maxObjects: 10 },
        parsed,
        false,
      ),
    ).toEqual({
      maxSizeBytes: 2 * 1024 ** 3,
      maxObjects: 10,
      preserved: false,
      changed: true,
    });
    expect(
      resolveBulkQuotaTarget(
        { maxSizeBytes: 1024 ** 3, maxObjects: 10 },
        parsed,
        true,
      ),
    ).toEqual({
      maxSizeBytes: 1024 ** 3,
      maxObjects: 10,
      preserved: true,
      changed: false,
    });
  });

  it("resolves only the selected public-access-block flags", () => {
    expect(
      resolveBulkPublicAccessBlockTarget(
        {
          block_public_acls: false,
          ignore_public_acls: true,
          block_public_policy: false,
          restrict_public_buckets: false,
        },
        true,
        ["block_public_acls", "restrict_public_buckets"],
      ),
    ).toEqual({
      current: {
        block_public_acls: false,
        ignore_public_acls: true,
        block_public_policy: false,
        restrict_public_buckets: false,
      },
      target: {
        block_public_acls: true,
        ignore_public_acls: true,
        block_public_policy: false,
        restrict_public_buckets: true,
      },
      changed: true,
    });
  });

  it("resolves lifecycle and CORS deletions from IDs and rule types", () => {
    const lifecycle = resolveBulkLifecycleDeleteTarget(
      [
        { ID: "keep", Status: "Enabled" },
        { ID: "remove-id", Status: "Enabled" },
        { ID: "remove-type", Expiration: { Days: 30 } },
      ],
      new Set(["remove-id"]),
      new Set(["expiration"]),
    );
    expect(lifecycle.nextRules).toEqual([{ ID: "keep", Status: "Enabled" }]);
    expect([...lifecycle.removedIndices]).toEqual([1, 2]);
    expect(lifecycle.changed).toBe(true);

    const cors = resolveBulkCorsDeleteTarget(
      [
        { ID: "keep", AllowedOrigins: ["https://example.com"], AllowedMethods: ["GET"] },
        { ID: "remove-type", AllowedOrigins: ["*"], AllowedMethods: ["GET"] },
      ],
      new Set(),
      new Set(["wildcard_origins"]),
    );
    expect(cors.nextRules).toEqual([
      { ID: "keep", AllowedOrigins: ["https://example.com"], AllowedMethods: ["GET"] },
    ]);
    expect(cors.changed).toBe(true);
  });

  it("resolves notification deletion and whether the remote resource can be removed", () => {
    const target = resolveBulkNotificationDeleteTarget(
      {
        TopicConfigurations: [{ Id: "topic-a" }],
        QueueConfigurations: [{ Id: "queue-a" }],
      },
      new Set(["topic-a"]),
      new Set(["queue"]),
    );

    expect(target.configuration).toEqual({});
    expect(target.changed).toBe(true);
    expect(target.deleteResource).toBe(true);
  });

  it("resolves policy merge and deletion while preserving policy metadata", () => {
    const merged = resolveBulkPolicyMergeTarget(
      {
        Version: "2012-10-17",
        Statement: [{ Sid: "Keep", Effect: "Allow" }],
      },
      {},
      [{ Sid: "New", Effect: "Deny" }],
      false,
    );
    expect(merged.targetPolicy).toEqual({
      Version: "2012-10-17",
      Statement: [
        { Sid: "Keep", Effect: "Allow" },
        { Sid: "New", Effect: "Deny" },
      ],
    });
    expect(merged.changed).toBe(true);

    const deleted = resolveBulkPolicyDeleteTarget(
      merged.targetPolicy,
      new Set(["Keep"]),
      new Set(["deny"]),
    );
    expect(deleted.nextStatements).toEqual([]);
    expect(deleted.targetPolicy).toBeNull();
    expect([...deleted.removedIndices]).toEqual([0, 1]);
    expect(deleted.changed).toBe(true);
  });
});
