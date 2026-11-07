/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  bytesToGiB,
  type BulkOperation,
  type BulkQuotaSnapshot,
} from "./bucketBulkOperationsModel";
import type { BucketOpsApi } from "./bucketOpsApi";
import type { PreparedBucketOpsBulkInput } from "./bucketOpsBulkInput";
import {
  runBucketMutationBatch,
  type BucketMutationBatchResult,
} from "./bucketOpsBulkExecution";
import {
  resolveBulkCorsDeleteTarget,
  resolveBulkCorsMergeTarget,
  resolveBulkLifecycleDeleteTarget,
  resolveBulkLifecycleMergeTarget,
  resolveBulkNotificationDeleteTarget,
  resolveBulkNotificationMergeTarget,
  resolveBulkPolicyDeleteTarget,
  resolveBulkPolicyMergeTarget,
  resolveBulkPublicAccessBlockTarget,
  resolveBulkQuotaTarget,
  resolveBulkVersioningTarget,
} from "./bucketOpsBulkTargets";

type BucketOpsBulkApplyApi = Pick<
  BucketOpsApi,
  | "deleteBucketCors"
  | "deleteBucketLifecycle"
  | "deleteBucketNotifications"
  | "deleteBucketPolicy"
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketNotifications"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
  | "putBucketCors"
  | "putBucketLifecycle"
  | "putBucketNotifications"
  | "putBucketPolicy"
  | "setBucketVersioning"
  | "updateBucketPublicAccessBlock"
  | "updateBucketQuota"
>;

type BucketOpsBulkApplyInput = BucketOpsBulkApplyApi & {
  bucketNames: readonly string[];
  corsUpdateOnlyExisting: boolean;
  endpointId: number;
  fetchBucketQuota: (bucketName: string) => Promise<BulkQuotaSnapshot>;
  lifecycleUpdateOnlyExisting: boolean;
  onProgress?: (progress: { completed: number; total: number; failed: number }) => void;
  operation: BulkOperation;
  policyUpdateOnlyExisting: boolean;
  prepared: PreparedBucketOpsBulkInput;
  quotaSkipConfigured: boolean;
};

export async function applyBucketOpsBulkUpdate({
  bucketNames,
  corsUpdateOnlyExisting,
  deleteBucketCors,
  deleteBucketLifecycle,
  deleteBucketNotifications,
  deleteBucketPolicy,
  endpointId,
  fetchBucketQuota,
  getBucketCors,
  getBucketLifecycle,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  lifecycleUpdateOnlyExisting,
  onProgress,
  operation,
  policyUpdateOnlyExisting,
  prepared,
  putBucketCors,
  putBucketLifecycle,
  putBucketNotifications,
  putBucketPolicy,
  quotaSkipConfigured,
  setBucketVersioning,
  updateBucketPublicAccessBlock,
  updateBucketQuota,
}: BucketOpsBulkApplyInput): Promise<BucketMutationBatchResult> {
  const {
    deleteCorsIds,
    deleteCorsTypes,
    deleteIds,
    deleteNotificationIds,
    deleteNotificationTypes,
    deletePolicyIds,
    deletePolicyTypes,
    deleteTypes,
    parsedCorsRules,
    parsedNotificationConfiguration,
    parsedPolicy,
    parsedPolicyStatements,
    parsedQuota,
    parsedRules,
    publicAccessBlockTargets,
  } = prepared;
  const desiredEnabled = operation === "enable_versioning";
  const desiredPublicAccessBlockEnabled = operation === "add_public_access_block";

  return runBucketMutationBatch({
    items: bucketNames,
    onProgress,
    mutate: async (bucketName) => {
      if (operation === "set_quota" && parsedQuota && updateBucketQuota) {
        const currentQuota = await fetchBucketQuota(bucketName);
        const target = resolveBulkQuotaTarget(
          currentQuota,
          parsedQuota,
          quotaSkipConfigured,
        );
        if (target.preserved || !target.changed) {
          return { changed: false };
        }
        const nextSize = target.maxSizeBytes;
        const nextObjects = target.maxObjects;
        const payloadSize =
          nextSize != null
            ? parsedQuota.applySize && parsedQuota.maxSizeValue != null
              ? parsedQuota.maxSizeValue
              : bytesToGiB(nextSize)
            : null;
        const payloadUnit =
          nextSize != null
            ? parsedQuota.applySize && parsedQuota.maxSizeValue != null
              ? parsedQuota.maxSizeUnit
              : "GiB"
            : null;
        await updateBucketQuota(endpointId, bucketName, {
          enabled: nextSize != null || nextObjects != null,
          max_size_gb: payloadSize,
          max_size_unit: payloadUnit,
          max_objects: nextObjects,
        });
        return { changed: true };
      }

      if (
        (operation === "add_public_access_block" ||
          operation === "remove_public_access_block") &&
        publicAccessBlockTargets
      ) {
        const target = resolveBulkPublicAccessBlockTarget(
          await getBucketPublicAccessBlock(endpointId, bucketName),
          desiredPublicAccessBlockEnabled,
          publicAccessBlockTargets,
        );
        if (!target.changed) {
          return { changed: false };
        }
        await updateBucketPublicAccessBlock(endpointId, bucketName, target.target);
        return { changed: true };
      }

      if (operation === "enable_versioning" || operation === "disable_versioning") {
        const properties = await getBucketProperties(endpointId, bucketName);
        const target = resolveBulkVersioningTarget(
          properties.versioning_status,
          desiredEnabled,
        );
        if (!target.changed) {
          return { changed: false };
        }
        await setBucketVersioning(endpointId, bucketName, target.targetEnabled);
        return { changed: true };
      }

      if (operation === "add_lifecycle" && parsedRules) {
        const lifecycle = await getBucketLifecycle(endpointId, bucketName);
        const target = resolveBulkLifecycleMergeTarget(
          lifecycle.rules as Record<string, unknown>[],
          parsedRules,
          lifecycleUpdateOnlyExisting,
        );
        if (!target.changed) return { changed: false };
        await putBucketLifecycle(endpointId, bucketName, target.nextRules);
        return { changed: true };
      }

      if (operation === "delete_lifecycle" && deleteIds && deleteTypes) {
        const lifecycle = await getBucketLifecycle(endpointId, bucketName);
        const target = resolveBulkLifecycleDeleteTarget(
          lifecycle.rules as Record<string, unknown>[],
          deleteIds,
          deleteTypes,
        );
        if (!target.changed) return { changed: false };
        if (target.nextRules.length === 0) {
          await deleteBucketLifecycle(endpointId, bucketName);
        } else {
          await putBucketLifecycle(endpointId, bucketName, target.nextRules);
        }
        return { changed: true };
      }

      if (operation === "add_notifications" && parsedNotificationConfiguration) {
        const notifications = await getBucketNotifications(endpointId, bucketName);
        const target = resolveBulkNotificationMergeTarget(
          notifications.configuration,
          parsedNotificationConfiguration,
        );
        if (!target.changed) return { changed: false };
        await putBucketNotifications(endpointId, bucketName, target.configuration);
        return { changed: true };
      }

      if (
        operation === "delete_notifications" &&
        deleteNotificationIds &&
        deleteNotificationTypes
      ) {
        const notifications = await getBucketNotifications(endpointId, bucketName);
        const target = resolveBulkNotificationDeleteTarget(
          notifications.configuration,
          deleteNotificationIds,
          deleteNotificationTypes,
        );
        if (!target.changed) return { changed: false };
        if (target.deleteResource) {
          await deleteBucketNotifications(endpointId, bucketName);
        } else {
          await putBucketNotifications(endpointId, bucketName, target.configuration);
        }
        return { changed: true };
      }

      if (operation === "add_cors" && parsedCorsRules) {
        const cors = await getBucketCors(endpointId, bucketName);
        const target = resolveBulkCorsMergeTarget(
          cors.rules as Record<string, unknown>[],
          parsedCorsRules,
          corsUpdateOnlyExisting,
        );
        if (!target.changed) return { changed: false };
        await putBucketCors(endpointId, bucketName, target.nextRules);
        return { changed: true };
      }

      if (operation === "delete_cors" && deleteCorsIds && deleteCorsTypes) {
        const cors = await getBucketCors(endpointId, bucketName);
        const target = resolveBulkCorsDeleteTarget(
          cors.rules as Record<string, unknown>[],
          deleteCorsIds,
          deleteCorsTypes,
        );
        if (!target.changed) return { changed: false };
        if (target.nextRules.length === 0) {
          await deleteBucketCors(endpointId, bucketName);
        } else {
          await putBucketCors(endpointId, bucketName, target.nextRules);
        }
        return { changed: true };
      }

      if (operation === "add_policy" && parsedPolicyStatements) {
        const policy = await getBucketPolicy(endpointId, bucketName);
        const target = resolveBulkPolicyMergeTarget(
          (policy.policy ?? {}) as Record<string, unknown>,
          parsedPolicy ?? {},
          parsedPolicyStatements,
          policyUpdateOnlyExisting,
        );
        if (!target.changed) return { changed: false };
        await putBucketPolicy(endpointId, bucketName, target.targetPolicy);
        return { changed: true };
      }

      if (operation === "delete_policy" && deletePolicyIds && deletePolicyTypes) {
        const policy = await getBucketPolicy(endpointId, bucketName);
        const target = resolveBulkPolicyDeleteTarget(
          (policy.policy ?? {}) as Record<string, unknown>,
          deletePolicyIds,
          deletePolicyTypes,
        );
        if (!target.changed) return { changed: false };
        if (target.targetPolicy === null) {
          await deleteBucketPolicy(endpointId, bucketName);
        } else {
          await putBucketPolicy(endpointId, bucketName, target.targetPolicy);
        }
        return { changed: true };
      }

      return { changed: false };
    },
  });
}
