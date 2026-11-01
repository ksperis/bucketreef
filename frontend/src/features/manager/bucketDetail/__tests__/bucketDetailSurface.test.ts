import { describe, expect, it } from "vitest";

import {
  buildBucketDetailBreadcrumbs,
  resolveBucketDetailFeatureAvailability,
  resolveBucketDetailSurface,
  resolveBucketDetailTabs,
} from "../bucketDetailSurface";

describe("bucketDetailSurface", () => {
  it("keeps bucket detail tabs ordered by user task", () => {
    expect(resolveBucketDetailTabs({ showObjectsTab: true })).toEqual([
      "overview",
      "objects",
      "properties",
      "permissions",
      "data-management",
      "usage-metrics",
    ]);
    expect(resolveBucketDetailTabs({ showObjectsTab: false })).toEqual([
      "overview",
      "properties",
      "permissions",
      "data-management",
      "usage-metrics",
    ]);
  });

  it("keeps Ceph Admin bucket detail endpoint-scoped", () => {
    expect(resolveBucketDetailSurface("ceph-admin")).toMatchObject({
      rootPath: "/ceph-admin",
      rootLabel: "Ceph Admin",
      bucketListPath: "/ceph-admin/buckets",
    });
  });

  it("resolves Manager feature availability with the existing fallback semantics", () => {
    expect(resolveBucketDetailFeatureAvailability({
      mode: "manager",
      isCephEndpoint: true,
      capabilities: undefined,
      managerStatsEnabled: true,
      managerBucketQuotaEnabled: true,
    })).toEqual({
      quota: true,
      replication: false,
      sns: true,
      sse: false,
      staticWebsite: false,
      usage: true,
      liveMetrics: true,
    });

    expect(resolveBucketDetailFeatureAvailability({
      mode: "manager",
      isCephEndpoint: true,
      capabilities: {
        metrics: false,
        replication: true,
        sns: false,
        sse: true,
        static_website: true,
      },
      managerStatsEnabled: true,
      managerBucketQuotaEnabled: false,
    })).toEqual({
      quota: false,
      replication: true,
      sns: false,
      sse: true,
      staticWebsite: true,
      usage: false,
      liveMetrics: false,
    });
  });

  it("resolves Ceph Admin feature availability with strict feature capabilities", () => {
    expect(resolveBucketDetailFeatureAvailability({
      mode: "ceph-admin",
      isCephEndpoint: true,
      capabilities: undefined,
    })).toEqual({
      quota: true,
      replication: false,
      sns: false,
      sse: false,
      staticWebsite: false,
      usage: true,
      liveMetrics: true,
    });

    expect(resolveBucketDetailFeatureAvailability({
      mode: "ceph-admin",
      isCephEndpoint: true,
      capabilities: {
        metrics: false,
        replication: true,
        sns: true,
        sse: true,
        static_website: true,
      },
    })).toEqual({
      quota: true,
      replication: true,
      sns: true,
      sse: true,
      staticWebsite: true,
      usage: false,
      liveMetrics: false,
    });
  });

  it("disables Ceph-only features outside Ceph endpoints", () => {
    expect(resolveBucketDetailFeatureAvailability({
      mode: "manager",
      isCephEndpoint: false,
      capabilities: {
        metrics: true,
        replication: true,
        sns: true,
        sse: true,
        static_website: true,
      },
      managerStatsEnabled: true,
      managerBucketQuotaEnabled: true,
    })).toMatchObject({
      quota: false,
      replication: false,
      liveMetrics: false,
      usage: true,
    });
  });

  it("builds breadcrumbs without mixing Manager and Ceph Admin routes", () => {
    expect(buildBucketDetailBreadcrumbs("manager", "photos")).toEqual([
      { label: "Manager", to: "/manager" },
      { label: "Buckets", to: "/manager/buckets" },
      { label: "photos" },
    ]);
    expect(buildBucketDetailBreadcrumbs("ceph-admin", "photos")).toEqual([
      { label: "Ceph Admin", to: "/ceph-admin" },
      { label: "Buckets", to: "/ceph-admin/buckets" },
      { label: "photos" },
    ]);
  });
});
