/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BucketProperties } from "../../api/bucketContracts";
import {
  buildBucketLoggingConfiguration,
  buildBucketObjectLockConfiguration,
  buildBucketProperties,
} from "../../test/bucketContracts";
import { buildCephAdminBucket } from "../../test/cephAdmin";
import { useBucketOpsTooltips } from "./useBucketOpsTooltips";

type TooltipOptions = Parameters<typeof useBucketOpsTooltips>[0];

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function createApi() {
  return {
    getBucketCors: vi.fn<TooltipOptions["getBucketCors"]>(async () => ({ rules: [] })),
    getBucketEncryption: vi.fn<TooltipOptions["getBucketEncryption"]>(async () => ({ rules: [] })),
    getBucketLogging: vi.fn<TooltipOptions["getBucketLogging"]>(async () => buildBucketLoggingConfiguration()),
    getBucketNotifications: vi.fn<TooltipOptions["getBucketNotifications"]>(async () => ({ configuration: {} })),
    getBucketPolicy: vi.fn<TooltipOptions["getBucketPolicy"]>(async () => ({ policy: null })),
    getBucketProperties: vi.fn<TooltipOptions["getBucketProperties"]>(async () => buildBucketProperties({
      object_lock: buildBucketObjectLockConfiguration({
        enabled: true,
        mode: "GOVERNANCE",
        days: 7,
      }),
      versioning_status: "Enabled",
    })),
    getBucketWebsite: vi.fn<TooltipOptions["getBucketWebsite"]>(async () => ({
      index_document: null,
      error_document: null,
      redirect_all_requests_to: null,
      routing_rules: [],
    })),
    listBuckets: vi.fn<TooltipOptions["listBuckets"]>(async () => ({
      items: [],
      total: 0,
      page: 1,
      page_size: 5,
      has_next: false,
      stats_available: true,
      stats_warning: null,
    })),
  };
}

const bucket = buildCephAdminBucket("reports", {
  owner: "owner-a",
  tenant: "tenant-a",
});

describe("useBucketOpsTooltips", () => {
  it("coalesces owner lookups and caches the resolved display name", async () => {
    const api = createApi();
    api.listBuckets.mockResolvedValue({
      items: [buildCephAdminBucket("reports", {
        ...bucket,
        owner_name: "Platform team",
      })],
      total: 1,
      page: 1,
      page_size: 5,
      has_next: false,
      stats_available: true,
      stats_warning: null,
    });
    const { result } = renderHook(() =>
      useBucketOpsTooltips({
        ...api,
        extractError: (error) => String(error),
        isStorageOps: false,
        missingScopeError: "Select an endpoint",
        selectedScopeId: 7,
      }),
    );

    act(() => {
      result.current.loadOwnerTooltip(bucket);
      result.current.loadOwnerTooltip(bucket);
    });

    const key = result.current.ownerTooltipCacheKey(bucket);
    await waitFor(() =>
      expect(result.current.ownerTooltipState[key]).toEqual({
        status: "ready",
        ownerName: "Platform team",
      }),
    );
    expect(key).toBe("7:tenant-a:reports:owner-a:owner");
    expect(api.listBuckets).toHaveBeenCalledOnce();
    expect(api.listBuckets).toHaveBeenCalledWith(7, {
      page: 1,
      page_size: 5,
      advanced_filter: JSON.stringify({
        match: "all",
        rules: [
          { field: "name", op: "eq", value: "reports" },
          { field: "tenant", op: "eq", value: "tenant-a" },
          { field: "owner", op: "eq", value: "owner-a" },
        ],
      }),
      include: ["owner_name"],
      with_stats: false,
    });
  });

  it("shares bucket properties across feature summaries", async () => {
    const api = createApi();
    const { result } = renderHook(() =>
      useBucketOpsTooltips({
        ...api,
        extractError: (error) => String(error),
        isStorageOps: false,
        missingScopeError: "Select an endpoint",
        selectedScopeId: 7,
      }),
    );

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
    expect(api.getBucketProperties).toHaveBeenCalledOnce();
    expect(api.getBucketProperties).toHaveBeenCalledWith(7, "tenant-a:reports");
  });

  it("ignores stale work after a cache reset without disrupting the replacement request", async () => {
    const api = createApi();
    const stale = createDeferred<BucketProperties>();
    const current = createDeferred<BucketProperties>();
    api.getBucketProperties
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const { result } = renderHook(() =>
      useBucketOpsTooltips({
        ...api,
        extractError: (error) => String(error),
        isStorageOps: false,
        missingScopeError: "Select an endpoint",
        selectedScopeId: 7,
      }),
    );
    const key = result.current.featureTooltipCacheKey(bucket, "versioning");

    act(() => result.current.loadFeatureTooltip(bucket, "versioning"));
    await waitFor(() =>
      expect(result.current.featureTooltipState[key]).toEqual({ status: "loading" }),
    );

    act(() => result.current.resetBucketTooltipState());
    await waitFor(() => expect(result.current.featureTooltipState[key]).toBeUndefined());
    act(() => result.current.loadFeatureTooltip(bucket, "versioning"));
    await waitFor(() => {
      expect(api.getBucketProperties).toHaveBeenCalledTimes(2);
      expect(result.current.featureTooltipState[key]).toEqual({ status: "loading" });
    });

    await act(async () => {
      stale.resolve({ lifecycle_rules: [], versioning_status: "Enabled" });
      await stale.promise;
    });
    expect(result.current.featureTooltipState[key]).toEqual({ status: "loading" });

    await act(async () => {
      current.resolve({ lifecycle_rules: [], versioning_status: "Suspended" });
      await current.promise;
    });
    expect(result.current.featureTooltipState[key]).toEqual({
      status: "ready",
      lines: ["Versioning: Suspended"],
    });
  });
});
