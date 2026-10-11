import { describe, expect, it } from "vitest";

import {
  buildBucketDetailBreadcrumbs,
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
