/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatBytes, formatNumber } from "../../utils/format";
import {
  PUBLIC_ACCESS_BLOCK_OPTIONS,
  formatPublicAccessBlockFlag,
  formatPublicAccessBlockState,
  type BulkOperation,
  type BulkPreviewItem,
  type BulkPreviewLine,
  type BulkQuotaSnapshot,
} from "./bucketBulkOperationsModel";
import {
  formatCorsRule,
  formatLifecycleRule,
  formatNotificationConfiguration,
  formatPolicyRule,
} from "./bucketConfigMerge";
import type { BucketOpsApi } from "./bucketOpsApi";
import type { PreparedBucketOpsBulkInput } from "./bucketOpsBulkInput";
import { runBucketPreviewBatch } from "./bucketOpsBulkPreviewExecution";
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
import { formatVersioningStatus } from "./bucketOpsPresentation";

type BucketOpsBulkPreviewApi = Pick<
  BucketOpsApi,
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketNotifications"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
>;

type BucketOpsBulkPreviewInput = BucketOpsBulkPreviewApi & {
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

export async function previewBucketOpsBulkUpdate({
  bucketNames,
  corsUpdateOnlyExisting,
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
  quotaSkipConfigured,
}: BucketOpsBulkPreviewInput): Promise<BulkPreviewItem[]> {
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

  const buildVersioningPreview = async (bucketName: string) => {
    const properties = await getBucketProperties(endpointId, bucketName);
    const currentStatus = formatVersioningStatus(properties.versioning_status);
    const { currentEnabled, changed } = resolveBulkVersioningTarget(
      properties.versioning_status,
      desiredEnabled,
    );
    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: currentStatus,
          tone: changed && currentEnabled !== null ? "removed" as const : undefined,
        },
      ],
      after: [
        {
          text: changed
            ? desiredEnabled
              ? "Enabled"
              : "Suspended"
            : currentStatus,
          tone: changed ? "added" as const : undefined,
        },
      ],
    };
  };

  const buildPublicAccessBlockPreview = async (bucketName: string) => {
    const { current, target, changed } = resolveBulkPublicAccessBlockTarget(
      await getBucketPublicAccessBlock(endpointId, bucketName),
      desiredPublicAccessBlockEnabled,
      publicAccessBlockTargets ?? [],
    );
    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: `State: ${formatPublicAccessBlockState(current)}`,
          tone: changed ? "removed" as const : undefined,
        },
        ...PUBLIC_ACCESS_BLOCK_OPTIONS.map((option): BulkPreviewLine => ({
          text: `${option.label}: ${formatPublicAccessBlockFlag(current[option.key])}`,
          tone:
            current[option.key] !== target[option.key] ? "removed" : undefined,
        })),
      ],
      after: [
        {
          text: `State: ${formatPublicAccessBlockState(target)}`,
          tone: changed ? "added" as const : undefined,
        },
        ...PUBLIC_ACCESS_BLOCK_OPTIONS.map((option): BulkPreviewLine => ({
          text: `${option.label}: ${formatPublicAccessBlockFlag(target[option.key])}`,
          tone: current[option.key] !== target[option.key] ? "added" : undefined,
        })),
      ],
    };
  };

  const buildQuotaPreview = async (bucketName: string): Promise<BulkPreviewItem> => {
    if (!parsedQuota) {
      return { bucket: bucketName, changed: false, before: [], after: [] };
    }
    const currentQuota = await fetchBucketQuota(bucketName);
    const target = resolveBulkQuotaTarget(
      currentQuota,
      parsedQuota,
      quotaSkipConfigured,
    );
    const sizeText = (value: number | null) =>
      value != null ? formatBytes(value) : "Not set";
    const objectsText = (value: number | null) =>
      value != null ? formatNumber(value) : "Not set";
    if (target.preserved) {
      return {
        bucket: bucketName,
        changed: false,
        before: [
          { text: `Size: ${sizeText(currentQuota.maxSizeBytes)}` },
          { text: `Objects: ${objectsText(currentQuota.maxObjects)}` },
        ],
        after: [
          { text: `Size: ${sizeText(currentQuota.maxSizeBytes)}` },
          { text: `Objects: ${objectsText(currentQuota.maxObjects)}` },
          { text: "(existing quota preserved)" },
        ],
      };
    }
    const afterSize = target.maxSizeBytes;
    const afterObjects = target.maxObjects;
    const sizeChanged = currentQuota.maxSizeBytes !== target.maxSizeBytes;
    const objectsChanged = currentQuota.maxObjects !== target.maxObjects;
    return {
      bucket: bucketName,
      changed: target.changed,
      before: [
        {
          text: `Size: ${sizeText(currentQuota.maxSizeBytes)}`,
          tone: sizeChanged ? "removed" : undefined,
        },
        {
          text: `Objects: ${objectsText(currentQuota.maxObjects)}`,
          tone: objectsChanged ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: `Size: ${sizeText(afterSize)}`,
          tone: sizeChanged ? "added" : undefined,
        },
        {
          text: `Objects: ${objectsText(afterObjects)}`,
          tone: objectsChanged ? "added" : undefined,
        },
      ],
    };
  };

  const buildRuleMergePreview = async (
    bucketName: string,
    kind: "lifecycle" | "cors",
  ): Promise<BulkPreviewItem> => {
    const existingRules = kind === "lifecycle"
      ? (await getBucketLifecycle(endpointId, bucketName)).rules
      : (await getBucketCors(endpointId, bucketName)).rules;
    const incomingRules = kind === "lifecycle" ? parsedRules : parsedCorsRules;
    const formatRule = kind === "lifecycle" ? formatLifecycleRule : formatCorsRule;
    const target = kind === "lifecycle"
      ? resolveBulkLifecycleMergeTarget(
          existingRules as Record<string, unknown>[],
          incomingRules ?? [],
          lifecycleUpdateOnlyExisting,
        )
      : resolveBulkCorsMergeTarget(
          existingRules as Record<string, unknown>[],
          incomingRules ?? [],
          corsUpdateOnlyExisting,
        );
    const { nextRules, changes } = target;
    const emptyText = "(no rules)";
    return {
      bucket: bucketName,
      changed: target.changed,
      before:
        existingRules.length === 0
          ? [{ text: emptyText }]
          : existingRules.map((rule, index) => ({
              text: formatRule(rule as Record<string, unknown>),
              tone: changes.some(
                (change) => change.action === "replace" && change.index === index,
              )
                ? "removed" as const
                : undefined,
            })),
      after:
        nextRules.length === 0
          ? [{ text: emptyText }]
          : nextRules.map((rule, index) => ({
              text: formatRule(rule as Record<string, unknown>),
              tone: changes.some(
                (change) =>
                  (change.action === "replace" || change.action === "add") &&
                  change.index === index,
              )
                ? "added" as const
                : undefined,
            })),
    };
  };

  const buildRuleDeletePreview = async (
    bucketName: string,
    kind: "lifecycle" | "cors",
  ): Promise<BulkPreviewItem> => {
    const existingRules = kind === "lifecycle"
      ? (await getBucketLifecycle(endpointId, bucketName)).rules
      : (await getBucketCors(endpointId, bucketName)).rules;
    const formatRule = kind === "lifecycle" ? formatLifecycleRule : formatCorsRule;
    const target = kind === "lifecycle"
      ? resolveBulkLifecycleDeleteTarget(
          existingRules as Record<string, unknown>[],
          deleteIds ?? new Set(),
          deleteTypes ?? new Set(),
        )
      : resolveBulkCorsDeleteTarget(
          existingRules as Record<string, unknown>[],
          deleteCorsIds ?? new Set(),
          deleteCorsTypes ?? new Set(),
        );
    const { nextRules, removedIndices } = target;
    return {
      bucket: bucketName,
      changed: target.changed,
      before:
        existingRules.length === 0
          ? [{ text: "(no rules)" }]
          : existingRules.map((rule, index) => ({
              text: formatRule(rule as Record<string, unknown>),
              tone: removedIndices.has(index) ? "removed" as const : undefined,
            })),
      after:
        nextRules.length === 0
          ? [{ text: "(no rules)" }]
          : nextRules.map((rule) => ({
              text: formatRule(rule as Record<string, unknown>),
            })),
    };
  };

  const buildNotificationsPreview = async (
    bucketName: string,
    deleting: boolean,
  ): Promise<BulkPreviewItem> => {
    const notifications = await getBucketNotifications(endpointId, bucketName);
    const currentConfiguration = notifications.configuration;
    const target = deleting
      ? resolveBulkNotificationDeleteTarget(
          currentConfiguration,
          deleteNotificationIds ?? new Set(),
          deleteNotificationTypes ?? new Set(),
        )
      : resolveBulkNotificationMergeTarget(
          currentConfiguration,
          parsedNotificationConfiguration ?? {},
        );
    return {
      bucket: bucketName,
      changed: target.changed,
      before: [
        {
          text: formatNotificationConfiguration(currentConfiguration),
          tone: target.changed ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: formatNotificationConfiguration(target.configuration),
          tone: target.changed ? "added" : undefined,
        },
      ],
    };
  };

  const buildPolicyMergePreview = async (
    bucketName: string,
  ): Promise<BulkPreviewItem> => {
    const policy = await getBucketPolicy(endpointId, bucketName);
    const existingPolicy = policy.policy ?? {};
    const target = resolveBulkPolicyMergeTarget(
      existingPolicy as Record<string, unknown>,
      parsedPolicy ?? {},
      parsedPolicyStatements ?? [],
      policyUpdateOnlyExisting,
    );
    const { existingStatements, nextStatements, changes } = target;
    return {
      bucket: bucketName,
      changed: target.changed,
      before:
        existingStatements.length === 0
          ? [{ text: "(no statements)" }]
          : existingStatements.map((statement, index) => ({
              text: formatPolicyRule(statement),
              tone: changes.some(
                (change) => change.action === "replace" && change.index === index,
              )
                ? "removed" as const
                : undefined,
            })),
      after:
        nextStatements.length === 0
          ? [{ text: "(no statements)" }]
          : nextStatements.map((statement, index) => ({
              text: formatPolicyRule(statement),
              tone: changes.some(
                (change) =>
                  (change.action === "replace" || change.action === "add") &&
                  change.index === index,
              )
                ? "added" as const
                : undefined,
            })),
    };
  };

  const buildPolicyDeletePreview = async (
    bucketName: string,
  ): Promise<BulkPreviewItem> => {
    const policy = await getBucketPolicy(endpointId, bucketName);
    const existingPolicy = policy.policy ?? {};
    const target = resolveBulkPolicyDeleteTarget(
      existingPolicy as Record<string, unknown>,
      deletePolicyIds ?? new Set(),
      deletePolicyTypes ?? new Set(),
    );
    const { existingStatements, nextStatements, removedIndices } = target;
    return {
      bucket: bucketName,
      changed: target.changed,
      before:
        existingStatements.length === 0
          ? [{ text: "(no statements)" }]
          : existingStatements.map((statement, index) => ({
              text: formatPolicyRule(statement),
              tone: removedIndices.has(index) ? "removed" as const : undefined,
            })),
      after:
        nextStatements.length === 0
          ? [{ text: "(no statements)" }]
          : nextStatements.map((statement) => ({
              text: formatPolicyRule(statement),
            })),
    };
  };

  return runBucketPreviewBatch({
    items: bucketNames,
    onProgress,
    preview: async (bucketName) => {
      switch (operation) {
        case "set_quota":
          return buildQuotaPreview(bucketName);
        case "add_public_access_block":
        case "remove_public_access_block":
          return buildPublicAccessBlockPreview(bucketName);
        case "enable_versioning":
        case "disable_versioning":
          return buildVersioningPreview(bucketName);
        case "add_lifecycle":
          return buildRuleMergePreview(bucketName, "lifecycle");
        case "delete_lifecycle":
          return buildRuleDeletePreview(bucketName, "lifecycle");
        case "add_notifications":
          return buildNotificationsPreview(bucketName, false);
        case "delete_notifications":
          return buildNotificationsPreview(bucketName, true);
        case "add_cors":
          return buildRuleMergePreview(bucketName, "cors");
        case "delete_cors":
          return buildRuleDeletePreview(bucketName, "cors");
        case "add_policy":
          return buildPolicyMergePreview(bucketName);
        case "delete_policy":
          return buildPolicyDeletePreview(bucketName);
        default:
          return {
            bucket: bucketName,
            before: [{ text: "-" }],
            after: [{ text: "-" }],
            changed: false,
          };
      }
    },
    buildFailure: (bucketName, error) => ({
      bucket: bucketName,
      before: [{ text: "Preview failed." }],
      after: [{ text: "Preview failed." }],
      changed: false,
      error,
    }),
  });
}
