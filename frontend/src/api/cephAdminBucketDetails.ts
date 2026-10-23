/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ListBrowserObjectsResponse } from "./browserContracts";
import type {
  BucketAcl,
  BucketCors,
  BucketEncryptionConfiguration,
  BucketLifecycleConfig,
  BucketLoggingConfiguration,
  BucketNotificationConfiguration,
  BucketObjectLockConfiguration,
  BucketPolicy,
  BucketProperties,
  BucketPublicAccessBlock,
  BucketPublicAccessBlockUpdate,
  BucketQuotaUpdate,
  BucketReplicationConfiguration,
  BucketTag,
  BucketVersioningStatus,
  BucketWebsiteConfiguration,
  BucketWebsiteUpdate,
} from "./bucketContracts";
import client from "./client";

function cephAdminBucketPath(endpointId: number, bucketName: string): string {
  return `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}`;
}

function cephAdminBucketRequestConfig(
  tenant?: string | null,
  params: Record<string, unknown> = {},
) {
  const normalizedTenant = tenant?.trim();
  return {
    params: {
      ...params,
      ...(normalizedTenant ? { tenant: normalizedTenant } : {}),
    },
  };
}

async function readCephAdminBucketResource<T>(
  endpointId: number,
  bucketName: string,
  resource: string,
  tenant?: string | null,
): Promise<T> {
  const { data } = await client.get<T>(
    `${cephAdminBucketPath(endpointId, bucketName)}/${resource}`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

async function writeCephAdminBucketResource<T>(
  endpointId: number,
  bucketName: string,
  resource: string,
  payload: unknown,
  tenant?: string | null,
): Promise<T> {
  const { data } = await client.put<T>(
    `${cephAdminBucketPath(endpointId, bucketName)}/${resource}`,
    payload,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

async function writeCephAdminBucketResourceWithoutResponse(
  endpointId: number,
  bucketName: string,
  resource: string,
  payload: unknown,
  tenant?: string | null,
): Promise<void> {
  await client.put(
    `${cephAdminBucketPath(endpointId, bucketName)}/${resource}`,
    payload,
    cephAdminBucketRequestConfig(tenant),
  );
}

async function deleteCephAdminBucketResource(
  endpointId: number,
  bucketName: string,
  resource: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/${resource}`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function listCephAdminBucketObjects(
  endpointId: number,
  bucketName: string,
  prefix = "",
  tenant?: string | null,
): Promise<ListBrowserObjectsResponse> {
  const { data } = await client.get<ListBrowserObjectsResponse>(
    `${cephAdminBucketPath(endpointId, bucketName)}/objects`,
    cephAdminBucketRequestConfig(tenant, { prefix }),
  );
  return data;
}

export async function getCephAdminBucketProperties(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketProperties> {
  return readCephAdminBucketResource<BucketProperties>(endpointId, bucketName, "properties", tenant);
}

export async function getCephAdminBucketVersioning(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketVersioningStatus> {
  return readCephAdminBucketResource<BucketVersioningStatus>(endpointId, bucketName, "versioning", tenant);
}

export async function setCephAdminBucketVersioning(
  endpointId: number,
  bucketName: string,
  enabled: boolean,
  tenant?: string | null,
): Promise<void> {
  return writeCephAdminBucketResourceWithoutResponse(endpointId, bucketName, "versioning", { enabled }, tenant);
}

export async function getCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketLifecycleConfig> {
  return readCephAdminBucketResource<BucketLifecycleConfig>(endpointId, bucketName, "lifecycle", tenant);
}

export async function putCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
  tenant?: string | null,
): Promise<BucketLifecycleConfig> {
  return writeCephAdminBucketResource<BucketLifecycleConfig>(endpointId, bucketName, "lifecycle", { rules }, tenant);
}

export async function deleteCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "lifecycle", tenant);
}

export async function getCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketCors> {
  return readCephAdminBucketResource<BucketCors>(endpointId, bucketName, "cors", tenant);
}

export async function putCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
  tenant?: string | null,
): Promise<BucketCors> {
  return writeCephAdminBucketResource<BucketCors>(endpointId, bucketName, "cors", { rules }, tenant);
}

export async function deleteCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "cors", tenant);
}

export async function getCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketEncryptionConfiguration> {
  return readCephAdminBucketResource<BucketEncryptionConfiguration>(endpointId, bucketName, "encryption", tenant);
}

export async function putCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
  tenant?: string | null,
): Promise<BucketEncryptionConfiguration> {
  return writeCephAdminBucketResource<BucketEncryptionConfiguration>(endpointId, bucketName, "encryption", { rules }, tenant);
}

export async function deleteCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "encryption", tenant);
}

export async function getCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketPolicy> {
  return readCephAdminBucketResource<BucketPolicy>(endpointId, bucketName, "policy", tenant);
}

export async function putCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
  policy: Record<string, unknown>,
  tenant?: string | null,
): Promise<BucketPolicy> {
  return writeCephAdminBucketResource<BucketPolicy>(endpointId, bucketName, "policy", { policy }, tenant);
}

export async function deleteCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "policy", tenant);
}

export async function getCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketNotificationConfiguration> {
  return readCephAdminBucketResource<BucketNotificationConfiguration>(endpointId, bucketName, "notifications", tenant);
}

export async function putCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>,
  tenant?: string | null,
): Promise<BucketNotificationConfiguration> {
  return writeCephAdminBucketResource<BucketNotificationConfiguration>(endpointId, bucketName, "notifications", { configuration }, tenant);
}

export async function deleteCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "notifications", tenant);
}

export async function getCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketReplicationConfiguration> {
  return readCephAdminBucketResource<BucketReplicationConfiguration>(endpointId, bucketName, "replication", tenant);
}

export async function putCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>,
  tenant?: string | null,
): Promise<BucketReplicationConfiguration> {
  return writeCephAdminBucketResource<BucketReplicationConfiguration>(endpointId, bucketName, "replication", { configuration }, tenant);
}

export async function deleteCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "replication", tenant);
}

export async function getCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketLoggingConfiguration> {
  return readCephAdminBucketResource<BucketLoggingConfiguration>(endpointId, bucketName, "logging", tenant);
}

export async function putCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  payload: BucketLoggingConfiguration,
  tenant?: string | null,
): Promise<BucketLoggingConfiguration> {
  return writeCephAdminBucketResource<BucketLoggingConfiguration>(endpointId, bucketName, "logging", payload, tenant);
}

export async function deleteCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "logging", tenant);
}

export async function getCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketWebsiteConfiguration> {
  return readCephAdminBucketResource<BucketWebsiteConfiguration>(endpointId, bucketName, "website", tenant);
}

export async function putCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  payload: BucketWebsiteUpdate,
  tenant?: string | null,
): Promise<BucketWebsiteConfiguration> {
  return writeCephAdminBucketResource<BucketWebsiteConfiguration>(endpointId, bucketName, "website", payload, tenant);
}

export async function deleteCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "website", tenant);
}

export async function getCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<{ tags: BucketTag[] }> {
  return readCephAdminBucketResource<{ tags: BucketTag[] }>(endpointId, bucketName, "tags", tenant);
}

export async function putCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
  tags: BucketTag[],
  tenant?: string | null,
): Promise<void> {
  return writeCephAdminBucketResourceWithoutResponse(endpointId, bucketName, "tags", { tags }, tenant);
}

export async function deleteCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  return deleteCephAdminBucketResource(endpointId, bucketName, "tags", tenant);
}

export async function getCephAdminBucketAcl(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketAcl> {
  return readCephAdminBucketResource<BucketAcl>(endpointId, bucketName, "acl", tenant);
}

export async function updateCephAdminBucketAcl(
  endpointId: number,
  bucketName: string,
  acl: string,
  tenant?: string | null,
): Promise<BucketAcl> {
  return writeCephAdminBucketResource<BucketAcl>(endpointId, bucketName, "acl", { acl }, tenant);
}

export async function getCephAdminBucketPublicAccessBlock(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketPublicAccessBlock> {
  return readCephAdminBucketResource<BucketPublicAccessBlock>(endpointId, bucketName, "public-access-block", tenant);
}

export async function updateCephAdminBucketPublicAccessBlock(
  endpointId: number,
  bucketName: string,
  payload: BucketPublicAccessBlockUpdate,
  tenant?: string | null,
): Promise<BucketPublicAccessBlock> {
  return writeCephAdminBucketResource<BucketPublicAccessBlock>(endpointId, bucketName, "public-access-block", payload, tenant);
}

export async function getCephAdminBucketObjectLock(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketObjectLockConfiguration> {
  return readCephAdminBucketResource<BucketObjectLockConfiguration>(endpointId, bucketName, "object-lock", tenant);
}

export async function updateCephAdminBucketObjectLock(
  endpointId: number,
  bucketName: string,
  payload: BucketObjectLockConfiguration,
  tenant?: string | null,
): Promise<BucketObjectLockConfiguration> {
  return writeCephAdminBucketResource<BucketObjectLockConfiguration>(endpointId, bucketName, "object-lock", payload, tenant);
}

export async function updateCephAdminBucketQuota(
  endpointId: number,
  bucketName: string,
  payload: BucketQuotaUpdate,
  tenant?: string | null,
): Promise<void> {
  return writeCephAdminBucketResourceWithoutResponse(endpointId, bucketName, "quota", payload, tenant);
}
