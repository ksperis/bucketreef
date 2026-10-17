/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3ExecutionContextSelector } from "./accountParams";
import { withS3ContextParam } from "./accountParams";
import type {
  Bucket,
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

const MANAGER_BUCKETS_PATH = "/manager/buckets";
const BROWSER_BUCKET_CONFIG_PATH = "/browser/buckets/config";

function createBucketDetailsTransport(basePath: string) {
  const bucketPath = (bucketName: string) =>
    `${basePath}/${encodeURIComponent(bucketName)}`;
  const requestConfig = (contextId: S3ExecutionContextSelector) => ({
    params: withS3ContextParam(undefined, contextId),
  });
  const read = async <T>(
    contextId: S3ExecutionContextSelector,
    bucketName: string,
    resource: string,
  ): Promise<T> => {
    const { data } = await client.get<T>(
      `${bucketPath(bucketName)}/${resource}`,
      requestConfig(contextId),
    );
    return data;
  };
  const getBucketStats = async (
    contextId: S3ExecutionContextSelector,
    bucketName: string,
    options?: { with_stats?: boolean },
  ): Promise<Bucket> => {
    const { data } = await client.get<Bucket>(
      `${bucketPath(bucketName)}/stats`,
      {
        params: withS3ContextParam(
          { with_stats: options?.with_stats },
          contextId,
        ),
      },
    );
    return data;
  };

  return {
    bucketPath,
    getBucketStats,
    read,
    requestConfig,
  };
}

function createManagerBucketDetailsApi() {
  const {
    bucketPath,
    getBucketStats,
    read,
    requestConfig,
  } = createBucketDetailsTransport(MANAGER_BUCKETS_PATH);
  const write = async <T>(
    contextId: S3ExecutionContextSelector,
    bucketName: string,
    resource: string,
    payload: unknown,
  ): Promise<T> => {
    const { data } = await client.put<T>(
      `${bucketPath(bucketName)}/${resource}`,
      payload,
      requestConfig(contextId),
    );
    return data;
  };
  const writeWithoutResponse = async (
    contextId: S3ExecutionContextSelector,
    bucketName: string,
    resource: string,
    payload: unknown,
  ): Promise<void> => {
    await client.put(
      `${bucketPath(bucketName)}/${resource}`,
      payload,
      requestConfig(contextId),
    );
  };
  const remove = async (
    contextId: S3ExecutionContextSelector,
    bucketName: string,
    resource: string,
  ): Promise<void> => {
    await client.delete(
      `${bucketPath(bucketName)}/${resource}`,
      requestConfig(contextId),
    );
  };

  return {
    getBucketStats,
    getBucketProperties: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketProperties>(contextId, bucketName, "properties"),
    getBucketAcl: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketAcl>(contextId, bucketName, "acl"),
    updateBucketAcl: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      acl: string,
    ) => write<BucketAcl>(contextId, bucketName, "acl", { acl }),
    getBucketPublicAccessBlock: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
    ) =>
      read<BucketPublicAccessBlock>(
        contextId,
        bucketName,
        "public-access-block",
      ),
    updateBucketPublicAccessBlock: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      payload: BucketPublicAccessBlock,
    ) =>
      write<BucketPublicAccessBlock>(
        contextId,
        bucketName,
        "public-access-block",
        payload,
      ),
    updateBucketQuota: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      payload: BucketQuotaUpdate,
    ) => writeWithoutResponse(contextId, bucketName, "quota", payload),
    getBucketVersioning: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
    ) => read<BucketVersioningStatus>(contextId, bucketName, "versioning"),
    setBucketVersioning: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      enabled: boolean,
    ) =>
      writeWithoutResponse(contextId, bucketName, "versioning", { enabled }),
    getBucketPolicy: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketPolicy>(contextId, bucketName, "policy"),
    putBucketPolicy: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      policy: Record<string, unknown>,
    ) => write<BucketPolicy>(contextId, bucketName, "policy", { policy }),
    deleteBucketPolicy: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      remove(contextId, bucketName, "policy"),
    getBucketLifecycle: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketLifecycleConfig>(contextId, bucketName, "lifecycle"),
    putBucketLifecycle: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      rules: Record<string, unknown>[],
    ) =>
      write<BucketLifecycleConfig>(contextId, bucketName, "lifecycle", {
        rules,
      }),
    deleteBucketLifecycle: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
    ) => remove(contextId, bucketName, "lifecycle"),
    getBucketCors: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketCors>(contextId, bucketName, "cors"),
    putBucketCors: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      rules: Record<string, unknown>[],
    ) => write<BucketCors>(contextId, bucketName, "cors", { rules }),
    deleteBucketCors: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      remove(contextId, bucketName, "cors"),
    getBucketEncryption: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketEncryptionConfiguration>(contextId, bucketName, "encryption"),
    putBucketEncryption: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      rules: Record<string, unknown>[],
    ) =>
      write<BucketEncryptionConfiguration>(
        contextId,
        bucketName,
        "encryption",
        { rules },
      ),
    deleteBucketEncryption: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
    ) => remove(contextId, bucketName, "encryption"),
    getBucketTags: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<{ tags: BucketTag[] }>(contextId, bucketName, "tags"),
    putBucketTags: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      tags: BucketTag[],
    ) => writeWithoutResponse(contextId, bucketName, "tags", { tags }),
    deleteBucketTags: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      remove(contextId, bucketName, "tags"),
    getBucketLogging: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketLoggingConfiguration>(contextId, bucketName, "logging"),
    putBucketLogging: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      payload: BucketLoggingConfiguration,
    ) =>
      write<BucketLoggingConfiguration>(
        contextId,
        bucketName,
        "logging",
        payload,
      ),
    deleteBucketLogging: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      remove(contextId, bucketName, "logging"),
    getBucketNotifications: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
    ) =>
      read<BucketNotificationConfiguration>(
        contextId,
        bucketName,
        "notifications",
      ),
    putBucketNotifications: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      configuration: Record<string, unknown>,
    ) =>
      write<BucketNotificationConfiguration>(
        contextId,
        bucketName,
        "notifications",
        { configuration },
      ),
    deleteBucketNotifications: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
    ) => remove(contextId, bucketName, "notifications"),
    getBucketReplication: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
    ) =>
      read<BucketReplicationConfiguration>(contextId, bucketName, "replication"),
    putBucketReplication: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      configuration: Record<string, unknown>,
    ) =>
      write<BucketReplicationConfiguration>(
        contextId,
        bucketName,
        "replication",
        { configuration },
      ),
    deleteBucketReplication: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
    ) => remove(contextId, bucketName, "replication"),
    getBucketWebsite: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketWebsiteConfiguration>(contextId, bucketName, "website"),
    putBucketWebsite: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      payload: BucketWebsiteConfiguration,
    ) =>
      write<BucketWebsiteConfiguration>(
        contextId,
        bucketName,
        "website",
        payload,
      ),
    deleteBucketWebsite: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      remove(contextId, bucketName, "website"),
    getBucketObjectLock: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketObjectLockConfiguration>(contextId, bucketName, "object-lock"),
    updateBucketObjectLock: (
      contextId: S3ExecutionContextSelector,
      bucketName: string,
      payload: BucketObjectLockConfiguration,
    ) =>
      write<BucketObjectLockConfiguration>(
        contextId,
        bucketName,
        "object-lock",
        payload,
      ),
  };
}

function createBrowserBucketDetailsApi() {
  const { getBucketStats, read } = createBucketDetailsTransport(
    BROWSER_BUCKET_CONFIG_PATH,
  );

  return {
    getBucketStats,
    getBucketProperties: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketProperties>(contextId, bucketName, "properties"),
    getBucketPolicy: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketPolicy>(contextId, bucketName, "policy"),
    getBucketLogging: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketLoggingConfiguration>(contextId, bucketName, "logging"),
    getBucketWebsite: (contextId: S3ExecutionContextSelector, bucketName: string) =>
      read<BucketWebsiteConfiguration>(contextId, bucketName, "website"),
  };
}

const managerBucketDetails = createManagerBucketDetailsApi();

export const {
  deleteBucketCors,
  deleteBucketEncryption,
  deleteBucketLifecycle,
  deleteBucketLogging,
  deleteBucketNotifications,
  deleteBucketPolicy,
  deleteBucketReplication,
  deleteBucketTags,
  deleteBucketWebsite,
  getBucketAcl,
  getBucketCors,
  getBucketEncryption,
  getBucketLifecycle,
  getBucketLogging,
  getBucketNotifications,
  getBucketObjectLock,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  getBucketReplication,
  getBucketStats,
  getBucketTags,
  getBucketVersioning,
  getBucketWebsite,
  putBucketCors,
  putBucketEncryption,
  putBucketLifecycle,
  putBucketLogging,
  putBucketNotifications,
  putBucketPolicy,
  putBucketReplication,
  putBucketTags,
  putBucketWebsite,
  setBucketVersioning,
  updateBucketAcl,
  updateBucketObjectLock,
  updateBucketPublicAccessBlock,
  updateBucketQuota,
} = managerBucketDetails;

export const browserBucketDetails = createBrowserBucketDetailsApi();
