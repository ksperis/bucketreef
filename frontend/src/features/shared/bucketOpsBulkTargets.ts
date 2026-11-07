/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  deleteNotificationConfigurations,
  isNotificationConfigurationEmpty,
  mergeNotificationConfigurations,
  type NotificationConfigurationTypeKey,
} from "../cephAdmin/bucketJsonParsers";
import {
  getCorsRuleTypes,
  getLifecycleRuleId,
  getLifecycleRuleTypes,
  getPolicyStatementSid,
  getPolicyStatementTypes,
  mergeCorsRules,
  mergeLifecycleRules,
  mergePolicyStatements,
  type CorsRuleTypeKey,
  type LifecycleRuleTypeKey,
  type PolicyRuleTypeKey,
} from "./bucketConfigMerge";
import {
  applyPublicAccessBlockTargets,
  hasConfiguredQuota,
  isPublicAccessBlockEquivalent,
  normalizePublicAccessBlockState,
  type BulkQuotaSnapshot,
  type ParsedQuotaInput,
  type PublicAccessBlockOptionKey,
} from "./bucketBulkOperationsModel";
import { normalizeVersioningStatus } from "./bucketOpsPresentation";

export function resolveBulkVersioningTarget(
  status: string | null | undefined,
  desiredEnabled: boolean,
) {
  const currentEnabled = normalizeVersioningStatus(status);
  return {
    currentEnabled,
    targetEnabled: desiredEnabled,
    changed: currentEnabled === null || currentEnabled !== desiredEnabled,
  };
}

export function resolveBulkQuotaTarget(
  current: BulkQuotaSnapshot,
  parsed: ParsedQuotaInput,
  skipConfigured: boolean,
) {
  const preserved = skipConfigured && hasConfiguredQuota(current);
  const maxSizeBytes =
    preserved || !parsed.applySize ? current.maxSizeBytes : parsed.maxSizeBytes;
  const maxObjects =
    preserved || !parsed.applyObjects ? current.maxObjects : parsed.maxObjects;

  return {
    maxSizeBytes,
    maxObjects,
    preserved,
    changed:
      !preserved &&
      (current.maxSizeBytes !== maxSizeBytes || current.maxObjects !== maxObjects),
  };
}

export function resolveBulkPublicAccessBlockTarget(
  value: Parameters<typeof normalizePublicAccessBlockState>[0],
  desiredEnabled: boolean,
  targets: PublicAccessBlockOptionKey[],
) {
  const current = normalizePublicAccessBlockState(value);
  const target = applyPublicAccessBlockTargets(current, desiredEnabled, targets);
  return {
    current,
    target,
    changed: !isPublicAccessBlockEquivalent(current, target),
  };
}

export function resolveBulkLifecycleMergeTarget(
  existingRules: Record<string, unknown>[],
  incomingRules: Record<string, unknown>[],
  onlyUpdateExisting: boolean,
) {
  const result = mergeLifecycleRules(existingRules, incomingRules, {
    onlyUpdateExisting,
  });
  return { ...result, changed: result.changes.length > 0 };
}

function resolveCollectionDeleteTarget<TType extends string>(
  existingItems: Record<string, unknown>[],
  deleteIds: ReadonlySet<string>,
  deleteTypes: ReadonlySet<TType>,
  getId: (item: Record<string, unknown>) => string | null,
  getTypes: (item: Record<string, unknown>) => TType[],
) {
  const removedIndices = new Set<number>();
  const nextItems = existingItems.filter((item, index) => {
    const itemId = getId(item);
    const removeById = Boolean(itemId && deleteIds.has(itemId));
    const removeByType = getTypes(item).some((type) => deleteTypes.has(type));
    if (removeById || removeByType) {
      removedIndices.add(index);
      return false;
    }
    return true;
  });

  return {
    nextItems,
    removedIndices,
    changed: removedIndices.size > 0,
  };
}

export function resolveBulkLifecycleDeleteTarget(
  existingRules: Record<string, unknown>[],
  deleteIds: ReadonlySet<string>,
  deleteTypes: ReadonlySet<LifecycleRuleTypeKey>,
) {
  const result = resolveCollectionDeleteTarget(
    existingRules,
    deleteIds,
    deleteTypes,
    getLifecycleRuleId,
    getLifecycleRuleTypes,
  );

  return {
    nextRules: result.nextItems,
    removedIndices: result.removedIndices,
    changed: result.changed,
  };
}

export function resolveBulkCorsMergeTarget(
  existingRules: Record<string, unknown>[],
  incomingRules: Record<string, unknown>[],
  onlyUpdateExisting: boolean,
) {
  const result = mergeCorsRules(existingRules, incomingRules, {
    onlyUpdateExisting,
  });
  return { ...result, changed: result.changes.length > 0 };
}

export function resolveBulkCorsDeleteTarget(
  existingRules: Record<string, unknown>[],
  deleteIds: ReadonlySet<string>,
  deleteTypes: ReadonlySet<CorsRuleTypeKey>,
) {
  const result = resolveCollectionDeleteTarget(
    existingRules,
    deleteIds,
    deleteTypes,
    getLifecycleRuleId,
    getCorsRuleTypes,
  );

  return {
    nextRules: result.nextItems,
    removedIndices: result.removedIndices,
    changed: result.changed,
  };
}

export function resolveBulkNotificationMergeTarget(
  existingConfiguration: Record<string, unknown>,
  incomingConfiguration: Record<string, unknown>,
) {
  const result = mergeNotificationConfigurations(
    existingConfiguration,
    incomingConfiguration,
  );
  return { ...result, changed: result.changes.length > 0 };
}

export function resolveBulkNotificationDeleteTarget(
  existingConfiguration: Record<string, unknown>,
  deleteIds: ReadonlySet<string>,
  deleteTypes: ReadonlySet<NotificationConfigurationTypeKey>,
) {
  const result = deleteNotificationConfigurations(
    existingConfiguration,
    deleteIds,
    deleteTypes,
  );
  return {
    ...result,
    changed: result.changes.length > 0,
    deleteResource: isNotificationConfigurationEmpty(result.configuration),
  };
}

function policyStatements(policy: Record<string, unknown>) {
  return Array.isArray(policy.Statement)
    ? (policy.Statement as Record<string, unknown>[])
    : [];
}

export function resolveBulkPolicyMergeTarget(
  existingPolicy: Record<string, unknown>,
  incomingPolicy: Record<string, unknown>,
  incomingStatements: Record<string, unknown>[],
  onlyUpdateExisting: boolean,
) {
  const existingStatements = policyStatements(existingPolicy);
  const result = mergePolicyStatements(existingStatements, incomingStatements, {
    onlyUpdateExisting,
  });
  const basePolicy =
    Object.keys(existingPolicy).length > 0 ? existingPolicy : incomingPolicy;

  return {
    ...result,
    existingStatements,
    targetPolicy: { ...basePolicy, Statement: result.nextStatements },
    changed: result.changes.length > 0,
  };
}

export function resolveBulkPolicyDeleteTarget(
  existingPolicy: Record<string, unknown>,
  deleteIds: ReadonlySet<string>,
  deleteTypes: ReadonlySet<PolicyRuleTypeKey>,
) {
  const existingStatements = policyStatements(existingPolicy);
  const result = resolveCollectionDeleteTarget(
    existingStatements,
    deleteIds,
    deleteTypes,
    getPolicyStatementSid,
    getPolicyStatementTypes,
  );

  return {
    existingStatements,
    nextStatements: result.nextItems,
    removedIndices: result.removedIndices,
    targetPolicy:
      result.nextItems.length > 0
        ? { ...existingPolicy, Statement: result.nextItems }
        : null,
    changed: result.changed,
  };
}
