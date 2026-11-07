/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
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
