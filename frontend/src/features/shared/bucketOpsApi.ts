/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  deleteCephAdminBucketCors,
  deleteCephAdminBucketLifecycle,
  deleteCephAdminBucketLogging,
  deleteCephAdminBucketNotifications,
  deleteCephAdminBucketPolicy,
  getCephAdminBucketCors,
  getCephAdminBucketEncryption,
  getCephAdminBucketLifecycle,
  getCephAdminBucketLogging,
  getCephAdminBucketNotifications,
  getCephAdminBucketPolicy,
  getCephAdminBucketProperties,
  getCephAdminBucketPublicAccessBlock,
  getCephAdminBucketWebsite,
  putCephAdminBucketCors,
  putCephAdminBucketLifecycle,
  putCephAdminBucketLogging,
  putCephAdminBucketNotifications,
  putCephAdminBucketPolicy,
  setCephAdminBucketVersioning,
  updateCephAdminBucketObjectLock,
  updateCephAdminBucketPublicAccessBlock,
  updateCephAdminBucketQuota,
} from "../../api/cephAdminBucketDetails";
import {
  listCephAdminBuckets,
  refreshCephAdminBucketListingCache,
  streamCephAdminBuckets,
} from "../../api/cephAdminBuckets";
import {
  deleteStorageOpsBucketCors,
  deleteStorageOpsBucketLifecycle,
  deleteStorageOpsBucketLogging,
  deleteStorageOpsBucketNotifications,
  deleteStorageOpsBucketPolicy,
  getStorageOpsBucketCors,
  getStorageOpsBucketEncryption,
  getStorageOpsBucketLifecycle,
  getStorageOpsBucketLogging,
  getStorageOpsBucketNotifications,
  getStorageOpsBucketPolicy,
  getStorageOpsBucketProperties,
  getStorageOpsBucketPublicAccessBlock,
  getStorageOpsBucketWebsite,
  listStorageOpsBuckets,
  putStorageOpsBucketCors,
  putStorageOpsBucketLifecycle,
  putStorageOpsBucketLogging,
  putStorageOpsBucketNotifications,
  putStorageOpsBucketPolicy,
  refreshStorageOpsBucketListingCache,
  setStorageOpsBucketVersioning,
  streamStorageOpsBuckets,
  updateStorageOpsBucketObjectLock,
  updateStorageOpsBucketPublicAccessBlock,
} from "../../api/storageOps";
import { decodeCephAdminBucketRef } from "./bucketOpsPresentation";
import type { BucketOpsMode } from "./bucketOpsSurface";

function cephAdminBucketRef(bucketRef: string) {
  return decodeCephAdminBucketRef(bucketRef);
}

const CEPH_ADMIN_BUCKET_OPS_API = {
  listBuckets: listCephAdminBuckets,
  streamBuckets: streamCephAdminBuckets,
  refreshBucketListingCache: refreshCephAdminBucketListingCache,
  getBucketProperties: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketProperties(endpointId, bucketName, tenant);
  },
  getBucketPublicAccessBlock: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketPublicAccessBlock(endpointId, bucketName, tenant);
  },
  updateBucketPublicAccessBlock: (
    endpointId: number,
    bucketRef: string,
    payload: Parameters<typeof updateCephAdminBucketPublicAccessBlock>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return updateCephAdminBucketPublicAccessBlock(endpointId, bucketName, payload, tenant);
  },
  getBucketLifecycle: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketLifecycle(endpointId, bucketName, tenant);
  },
  putBucketLifecycle: (
    endpointId: number,
    bucketRef: string,
    rules: Parameters<typeof putCephAdminBucketLifecycle>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return putCephAdminBucketLifecycle(endpointId, bucketName, rules, tenant);
  },
  deleteBucketLifecycle: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return deleteCephAdminBucketLifecycle(endpointId, bucketName, tenant);
  },
  getBucketCors: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketCors(endpointId, bucketName, tenant);
  },
  putBucketCors: (
    endpointId: number,
    bucketRef: string,
    rules: Parameters<typeof putCephAdminBucketCors>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return putCephAdminBucketCors(endpointId, bucketName, rules, tenant);
  },
  deleteBucketCors: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return deleteCephAdminBucketCors(endpointId, bucketName, tenant);
  },
  getBucketPolicy: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketPolicy(endpointId, bucketName, tenant);
  },
  putBucketPolicy: (
    endpointId: number,
    bucketRef: string,
    policy: Parameters<typeof putCephAdminBucketPolicy>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return putCephAdminBucketPolicy(endpointId, bucketName, policy, tenant);
  },
  deleteBucketPolicy: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return deleteCephAdminBucketPolicy(endpointId, bucketName, tenant);
  },
  getBucketLogging: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketLogging(endpointId, bucketName, tenant);
  },
  putBucketLogging: (
    endpointId: number,
    bucketRef: string,
    payload: Parameters<typeof putCephAdminBucketLogging>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return putCephAdminBucketLogging(endpointId, bucketName, payload, tenant);
  },
  deleteBucketLogging: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return deleteCephAdminBucketLogging(endpointId, bucketName, tenant);
  },
  getBucketNotifications: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketNotifications(endpointId, bucketName, tenant);
  },
  putBucketNotifications: (
    endpointId: number,
    bucketRef: string,
    configuration: Parameters<typeof putCephAdminBucketNotifications>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return putCephAdminBucketNotifications(endpointId, bucketName, configuration, tenant);
  },
  deleteBucketNotifications: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return deleteCephAdminBucketNotifications(endpointId, bucketName, tenant);
  },
  getBucketWebsite: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketWebsite(endpointId, bucketName, tenant);
  },
  getBucketEncryption: (endpointId: number, bucketRef: string) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return getCephAdminBucketEncryption(endpointId, bucketName, tenant);
  },
  setBucketVersioning: (
    endpointId: number,
    bucketRef: string,
    enabled: Parameters<typeof setCephAdminBucketVersioning>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return setCephAdminBucketVersioning(endpointId, bucketName, enabled, tenant);
  },
  updateBucketObjectLock: (
    endpointId: number,
    bucketRef: string,
    payload: Parameters<typeof updateCephAdminBucketObjectLock>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return updateCephAdminBucketObjectLock(endpointId, bucketName, payload, tenant);
  },
  updateBucketQuota: (
    endpointId: number,
    bucketRef: string,
    payload: Parameters<typeof updateCephAdminBucketQuota>[2],
  ) => {
    const { bucketName, tenant } = cephAdminBucketRef(bucketRef);
    return updateCephAdminBucketQuota(endpointId, bucketName, payload, tenant);
  },
} as const;

export type BucketOpsApi = Omit<
  typeof CEPH_ADMIN_BUCKET_OPS_API,
  "refreshBucketListingCache" | "updateBucketQuota"
> & {
  refreshBucketListingCache: (scopeId: number) => Promise<unknown>;
  updateBucketQuota?: typeof updateCephAdminBucketQuota;
};

const STORAGE_OPS_BUCKET_OPS_API: BucketOpsApi = {
  listBuckets: listStorageOpsBuckets,
  streamBuckets: streamStorageOpsBuckets,
  refreshBucketListingCache: refreshStorageOpsBucketListingCache,
  getBucketProperties: getStorageOpsBucketProperties,
  getBucketPublicAccessBlock: getStorageOpsBucketPublicAccessBlock,
  updateBucketPublicAccessBlock: updateStorageOpsBucketPublicAccessBlock,
  getBucketLifecycle: getStorageOpsBucketLifecycle,
  putBucketLifecycle: putStorageOpsBucketLifecycle,
  deleteBucketLifecycle: deleteStorageOpsBucketLifecycle,
  getBucketCors: getStorageOpsBucketCors,
  putBucketCors: putStorageOpsBucketCors,
  deleteBucketCors: deleteStorageOpsBucketCors,
  getBucketPolicy: getStorageOpsBucketPolicy,
  putBucketPolicy: putStorageOpsBucketPolicy,
  deleteBucketPolicy: deleteStorageOpsBucketPolicy,
  getBucketLogging: getStorageOpsBucketLogging,
  putBucketLogging: putStorageOpsBucketLogging,
  deleteBucketLogging: deleteStorageOpsBucketLogging,
  getBucketNotifications: getStorageOpsBucketNotifications,
  putBucketNotifications: putStorageOpsBucketNotifications,
  deleteBucketNotifications: deleteStorageOpsBucketNotifications,
  getBucketWebsite: getStorageOpsBucketWebsite,
  getBucketEncryption: getStorageOpsBucketEncryption,
  setBucketVersioning: setStorageOpsBucketVersioning,
  updateBucketObjectLock: updateStorageOpsBucketObjectLock,
};

export function resolveBucketOpsApi(mode: BucketOpsMode): BucketOpsApi {
  return mode === "storage-ops"
    ? STORAGE_OPS_BUCKET_OPS_API
    : CEPH_ADMIN_BUCKET_OPS_API;
}
