import { describe, expect, it } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { buildBucketOpsNavigationTarget } from "./bucketOpsTableNavigation";

const cephBucket: CephAdminBucket = { name: "logs/archive" };
const storageBucket: CephAdminBucket = {
  name: "account-1::archive",
  bucket_name: "logs/archive",
  context_id: "account 1",
};

describe("bucketOpsTableNavigation", () => {
  it("builds the Ceph Admin browser destination", () => {
    expect(
      buildBucketOpsNavigationTarget({
        action: "browser",
        bucket: cephBucket,
        mode: "ceph-admin",
        selectedEndpointId: 7,
      }),
    ).toEqual({
      pathname: "/ceph-admin/browser",
      search: "?ep=7&bucket=logs%2Farchive",
    });
  });

  it("builds the Storage Ops Manager destination", () => {
    expect(
      buildBucketOpsNavigationTarget({
        action: "manager",
        bucket: storageBucket,
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    ).toEqual({
      pathname: "/manager/buckets/logs%2Farchive",
      search: "?ctx=account+1",
    });
  });

  it("rejects incompatible surfaces and incomplete identities", () => {
    expect(
      buildBucketOpsNavigationTarget({
        action: "manager",
        bucket: cephBucket,
        mode: "ceph-admin",
        selectedEndpointId: 7,
      }),
    ).toBeNull();
    expect(
      buildBucketOpsNavigationTarget({
        action: "browser",
        bucket: storageBucket,
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    ).toBeNull();
    expect(
      buildBucketOpsNavigationTarget({
        action: "manager",
        bucket: { name: "missing-context" },
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    ).toBeNull();
  });
});
