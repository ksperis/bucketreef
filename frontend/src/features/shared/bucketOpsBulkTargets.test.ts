/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import {
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
});
