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
  BucketQuotaUpdate,
  BucketReplicationConfiguration,
  BucketTag,
  BucketVersioningStatus,
  BucketWebsiteConfiguration,
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
  const { data } = await client.get<BucketProperties>(
    `${cephAdminBucketPath(endpointId, bucketName)}/properties`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function getCephAdminBucketVersioning(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketVersioningStatus> {
  const { data } = await client.get<BucketVersioningStatus>(
    `${cephAdminBucketPath(endpointId, bucketName)}/versioning`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function setCephAdminBucketVersioning(
  endpointId: number,
  bucketName: string,
  enabled: boolean,
  tenant?: string | null,
): Promise<void> {
  await client.put(
    `${cephAdminBucketPath(endpointId, bucketName)}/versioning`,
    { enabled },
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketLifecycleConfig> {
  const { data } = await client.get<BucketLifecycleConfig>(
    `${cephAdminBucketPath(endpointId, bucketName)}/lifecycle`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
  tenant?: string | null,
): Promise<BucketLifecycleConfig> {
  const { data } = await client.put<BucketLifecycleConfig>(
    `${cephAdminBucketPath(endpointId, bucketName)}/lifecycle`,
    { rules },
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function deleteCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/lifecycle`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketCors> {
  const { data } = await client.get<BucketCors>(
    `${cephAdminBucketPath(endpointId, bucketName)}/cors`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
  tenant?: string | null,
): Promise<BucketCors> {
  const { data } = await client.put<BucketCors>(
    `${cephAdminBucketPath(endpointId, bucketName)}/cors`,
    { rules },
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function deleteCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/cors`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.get<BucketEncryptionConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/encryption`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
  tenant?: string | null,
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.put<BucketEncryptionConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/encryption`,
    { rules },
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function deleteCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/encryption`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketPolicy> {
  const { data } = await client.get<BucketPolicy>(
    `${cephAdminBucketPath(endpointId, bucketName)}/policy`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
  policy: Record<string, unknown>,
  tenant?: string | null,
): Promise<BucketPolicy> {
  const { data } = await client.put<BucketPolicy>(
    `${cephAdminBucketPath(endpointId, bucketName)}/policy`,
    { policy },
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function deleteCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/policy`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.get<BucketNotificationConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/notifications`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>,
  tenant?: string | null,
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.put<BucketNotificationConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/notifications`,
    { configuration },
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function deleteCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/notifications`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketReplicationConfiguration> {
  const { data } = await client.get<BucketReplicationConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/replication`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>,
  tenant?: string | null,
): Promise<BucketReplicationConfiguration> {
  const { data } = await client.put<BucketReplicationConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/replication`,
    { configuration },
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function deleteCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/replication`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.get<BucketLoggingConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/logging`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  payload: BucketLoggingConfiguration,
  tenant?: string | null,
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.put<BucketLoggingConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/logging`,
    payload,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function deleteCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/logging`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.get<BucketWebsiteConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/website`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  payload: BucketWebsiteConfiguration,
  tenant?: string | null,
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.put<BucketWebsiteConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/website`,
    payload,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function deleteCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/website`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<{ tags: BucketTag[] }> {
  const { data } = await client.get<{ tags: BucketTag[] }>(
    `${cephAdminBucketPath(endpointId, bucketName)}/tags`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function putCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
  tags: BucketTag[],
  tenant?: string | null,
): Promise<void> {
  await client.put(
    `${cephAdminBucketPath(endpointId, bucketName)}/tags`,
    { tags },
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function deleteCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/tags`,
    cephAdminBucketRequestConfig(tenant),
  );
}

export async function getCephAdminBucketAcl(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketAcl> {
  const { data } = await client.get<BucketAcl>(
    `${cephAdminBucketPath(endpointId, bucketName)}/acl`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function updateCephAdminBucketAcl(
  endpointId: number,
  bucketName: string,
  acl: string,
  tenant?: string | null,
): Promise<BucketAcl> {
  const { data } = await client.put<BucketAcl>(
    `${cephAdminBucketPath(endpointId, bucketName)}/acl`,
    { acl },
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function getCephAdminBucketPublicAccessBlock(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketPublicAccessBlock> {
  const { data } = await client.get<BucketPublicAccessBlock>(
    `${cephAdminBucketPath(endpointId, bucketName)}/public-access-block`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function updateCephAdminBucketPublicAccessBlock(
  endpointId: number,
  bucketName: string,
  payload: BucketPublicAccessBlock,
  tenant?: string | null,
): Promise<BucketPublicAccessBlock> {
  const { data } = await client.put<BucketPublicAccessBlock>(
    `${cephAdminBucketPath(endpointId, bucketName)}/public-access-block`,
    payload,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function getCephAdminBucketObjectLock(
  endpointId: number,
  bucketName: string,
  tenant?: string | null,
): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.get<BucketObjectLockConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/object-lock`,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function updateCephAdminBucketObjectLock(
  endpointId: number,
  bucketName: string,
  payload: BucketObjectLockConfiguration,
  tenant?: string | null,
): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.put<BucketObjectLockConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/object-lock`,
    payload,
    cephAdminBucketRequestConfig(tenant),
  );
  return data;
}

export async function updateCephAdminBucketQuota(
  endpointId: number,
  bucketName: string,
  payload: BucketQuotaUpdate,
  tenant?: string | null,
): Promise<void> {
  await client.put(
    `${cephAdminBucketPath(endpointId, bucketName)}/quota`,
    payload,
    cephAdminBucketRequestConfig(tenant),
  );
}
