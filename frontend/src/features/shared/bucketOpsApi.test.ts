import { describe, expect, it } from "vitest";
import { listCephAdminBuckets } from "../../api/cephAdminBuckets";
import {
  getStorageOpsBucketProperties,
  listStorageOpsBuckets,
} from "../../api/storageOps";
import { resolveBucketOpsApi } from "./bucketOpsApi";

describe("bucket operations API adapter", () => {
  it("resolves the canonical API implementation for each surface", () => {
    const cephAdmin = resolveBucketOpsApi("ceph-admin");
    expect(cephAdmin.listBuckets).toBe(listCephAdminBuckets);
    expect(cephAdmin.getBucketProperties).toEqual(expect.any(Function));
    expect(cephAdmin.updateBucketQuota).toEqual(expect.any(Function));
    expect(resolveBucketOpsApi("storage-ops")).toMatchObject({
      listBuckets: listStorageOpsBuckets,
      getBucketProperties: getStorageOpsBucketProperties,
    });
    expect(resolveBucketOpsApi("storage-ops")).not.toHaveProperty("updateBucketQuota");
  });
});
