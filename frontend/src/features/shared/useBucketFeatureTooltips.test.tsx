/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BucketCors, BucketProperties } from "../../api/bucketContracts";
import {
  buildBucketObjectLockConfiguration,
  buildBucketProperties,
} from "../../test/bucketContracts";
import { useBucketFeatureTooltips } from "./useBucketFeatureTooltips";

type TestBucket = {
  name: string;
};

const bucket: TestBucket = { name: "reports" };

function createLoaders(properties?: BucketProperties) {
  return {
    getBucketCors: vi.fn(async (_bucket: TestBucket): Promise<BucketCors> => ({ rules: [] })),
    getBucketLogging: vi.fn(async (_bucket: TestBucket) => ({
      enabled: false,
      target_bucket: null,
      target_prefix: null,
    })),
    getBucketNotifications: vi.fn(async (_bucket: TestBucket) => ({ configuration: {} })),
    getBucketPolicy: vi.fn(async (_bucket: TestBucket) => ({ policy: null })),
    getBucketProperties: vi.fn(async (_bucket: TestBucket) => properties ?? buildBucketProperties({
      object_lock: buildBucketObjectLockConfiguration({
        enabled: true,
        mode: "GOVERNANCE",
        days: 7,
      }),
      versioning_status: "Enabled",
    })),
    getBucketWebsite: vi.fn(async (_bucket: TestBucket) => ({
      index_document: null,
      error_document: null,
      redirect_all_requests_to: null,
      routing_rules: [],
    })),
  };
}

function renderTooltips(loaders = createLoaders()) {
  return renderHook(() =>
    useBucketFeatureTooltips<TestBucket>({
      ...loaders,
      bucketCacheKey: (target) => target.name,
      enabled: true,
      extractError: (error) => String(error),
    }),
  );
}

describe("useBucketFeatureTooltips", () => {
  it("shares bucket properties across feature summaries", async () => {
    const loaders = createLoaders();
    const { result } = renderTooltips(loaders);

    act(() => result.current.loadFeatureTooltip(bucket, "versioning"));
    const versioningKey = result.current.featureTooltipCacheKey(bucket, "versioning");
    await waitFor(() =>
      expect(result.current.featureTooltipState[versioningKey]).toEqual({
        status: "ready",
        lines: ["Versioning: Enabled"],
      }),
    );

    act(() => result.current.loadFeatureTooltip(bucket, "object_lock"));
    const objectLockKey = result.current.featureTooltipCacheKey(bucket, "object_lock");
    await waitFor(() =>
      expect(result.current.featureTooltipState[objectLockKey]).toEqual({
        status: "ready",
        lines: ["Enabled: Yes", "Mode: GOVERNANCE", "Default retention: 7 day(s)"],
      }),
    );

    expect(loaders.getBucketProperties).toHaveBeenCalledOnce();
  });

  it("loads CORS details when properties do not contain inline rules", async () => {
    const loaders = createLoaders(buildBucketProperties({ cors_rules: undefined }));
    loaders.getBucketCors.mockResolvedValue({
      rules: [
        {
          AllowedMethods: ["GET"],
          AllowedOrigins: ["*"],
        },
      ],
    });
    const { result } = renderTooltips(loaders);

    act(() => result.current.loadFeatureTooltip(bucket, "cors"));
    const key = result.current.featureTooltipCacheKey(bucket, "cors");
    await waitFor(() =>
      expect(result.current.featureTooltipState[key]).toEqual({
        status: "ready",
        lines: ["Rules: 1", "Rule 1 - Methods: GET - Origins: *"],
      }),
    );

    expect(loaders.getBucketProperties).toHaveBeenCalledOnce();
    expect(loaders.getBucketCors).toHaveBeenCalledOnce();
    expect(loaders.getBucketCors).toHaveBeenCalledWith(bucket);
  });
});
