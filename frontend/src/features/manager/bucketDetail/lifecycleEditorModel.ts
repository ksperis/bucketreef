/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { LifecycleRuleRecord } from "../bucketLifecycle";

export type LifecycleVisualRuleDraft = {
  id: string;
  status: "Enabled" | "Disabled";
  prefix: string;
  expirationDays: string;
  expiredObjectDeleteMarker: boolean;
  noncurrentExpirationDays: string;
  abortMultipartDays: string;
  transitionDays: string;
  transitionStorageClass: string;
  noncurrentTransitionDays: string;
  noncurrentTransitionStorageClass: string;
};

export type LifecycleVisualRulePatch = Partial<LifecycleVisualRuleDraft>;

const topLevelKeys = new Set([
  "ID",
  "Status",
  "Filter",
  "Expiration",
  "NoncurrentVersionExpiration",
  "AbortIncompleteMultipartUpload",
  "Transitions",
  "NoncurrentVersionTransitions",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isSupportedObject(
  value: unknown,
  keys: readonly string[],
  validators: Record<string, (entry: unknown) => boolean>,
): boolean {
  if (value === undefined) return true;
  if (!isPlainRecord(value) || !hasOnlyKeys(value, keys)) return false;
  return Object.entries(value).every(([key, entry]) => validators[key]?.(entry) ?? false);
}

function isSupportedTransitionArray(
  value: unknown,
  daysKey: "Days" | "NoncurrentDays",
): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 1) return false;
  return value.every(
    (entry) =>
      isPlainRecord(entry) &&
      hasOnlyKeys(entry, [daysKey, "StorageClass"]) &&
      isOptionalFiniteNumber(entry[daysKey]) &&
      isOptionalString(entry.StorageClass),
  );
}

export function isLifecycleRuleVisuallyEditable(rule: LifecycleRuleRecord): boolean {
  if (!Object.keys(rule).every((key) => topLevelKeys.has(key))) return false;
  if (!isOptionalString(rule.ID)) return false;
  if (rule.Status !== undefined && rule.Status !== "Enabled" && rule.Status !== "Disabled") return false;
  if (
    !isSupportedObject(rule.Filter, ["Prefix"], {
      Prefix: (value) => isOptionalString(value),
    })
  ) {
    return false;
  }
  if (
    !isSupportedObject(rule.Expiration, ["Days", "ExpiredObjectDeleteMarker"], {
      Days: (value) => isOptionalFiniteNumber(value),
      ExpiredObjectDeleteMarker: (value) => isOptionalBoolean(value),
    })
  ) {
    return false;
  }
  if (
    !isSupportedObject(rule.NoncurrentVersionExpiration, ["NoncurrentDays"], {
      NoncurrentDays: (value) => isOptionalFiniteNumber(value),
    })
  ) {
    return false;
  }
  if (
    !isSupportedObject(rule.AbortIncompleteMultipartUpload, ["DaysAfterInitiation"], {
      DaysAfterInitiation: (value) => isOptionalFiniteNumber(value),
    })
  ) {
    return false;
  }
  return (
    isSupportedTransitionArray(rule.Transitions, "Days") &&
    isSupportedTransitionArray(rule.NoncurrentVersionTransitions, "NoncurrentDays")
  );
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) && isPlainRecord(value[0]) ? value[0] : undefined;
}

function numberText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function readLifecycleVisualRule(rule: LifecycleRuleRecord): LifecycleVisualRuleDraft {
  const filter = recordValue(rule.Filter);
  const expiration = recordValue(rule.Expiration);
  const noncurrentExpiration = recordValue(rule.NoncurrentVersionExpiration);
  const multipart = recordValue(rule.AbortIncompleteMultipartUpload);
  const transition = firstRecord(rule.Transitions);
  const noncurrentTransition = firstRecord(rule.NoncurrentVersionTransitions);
  return {
    id: typeof rule.ID === "string" ? rule.ID : "",
    status: rule.Status === "Disabled" ? "Disabled" : "Enabled",
    prefix: typeof filter?.Prefix === "string" ? filter.Prefix : "",
    expirationDays: numberText(expiration?.Days),
    expiredObjectDeleteMarker: expiration?.ExpiredObjectDeleteMarker === true,
    noncurrentExpirationDays: numberText(noncurrentExpiration?.NoncurrentDays),
    abortMultipartDays: numberText(multipart?.DaysAfterInitiation),
    transitionDays: numberText(transition?.Days),
    transitionStorageClass:
      typeof transition?.StorageClass === "string" ? transition.StorageClass : "",
    noncurrentTransitionDays: numberText(noncurrentTransition?.NoncurrentDays),
    noncurrentTransitionStorageClass:
      typeof noncurrentTransition?.StorageClass === "string"
        ? noncurrentTransition.StorageClass
        : "",
  };
}

function lifecycleRuleHasAction(rule: LifecycleRuleRecord): boolean {
  const expiration = recordValue(rule.Expiration);
  const noncurrentExpiration = recordValue(rule.NoncurrentVersionExpiration);
  const multipart = recordValue(rule.AbortIncompleteMultipartUpload);
  const transition = firstRecord(rule.Transitions);
  const noncurrentTransition = firstRecord(rule.NoncurrentVersionTransitions);
  return Boolean(
    (typeof expiration?.Days === "number" && Number.isFinite(expiration.Days)) ||
      expiration?.ExpiredObjectDeleteMarker === true ||
      (typeof noncurrentExpiration?.NoncurrentDays === "number" &&
        Number.isFinite(noncurrentExpiration.NoncurrentDays)) ||
      (typeof multipart?.DaysAfterInitiation === "number" &&
        Number.isFinite(multipart.DaysAfterInitiation)) ||
      (typeof transition?.Days === "number" &&
        Number.isFinite(transition.Days) &&
        typeof transition.StorageClass === "string" &&
        transition.StorageClass.length > 0) ||
      (typeof noncurrentTransition?.NoncurrentDays === "number" &&
        Number.isFinite(noncurrentTransition.NoncurrentDays) &&
        typeof noncurrentTransition.StorageClass === "string" &&
        noncurrentTransition.StorageClass.length > 0),
  );
}

export function lifecycleVisualRuleValidationError(rule: LifecycleRuleRecord): string | null {
  if (!isLifecycleRuleVisuallyEditable(rule)) return null;

  const expiration = recordValue(rule.Expiration);
  if (
    typeof expiration?.Days === "number" &&
    Number.isFinite(expiration.Days) &&
    expiration.ExpiredObjectDeleteMarker === true
  ) {
    return "Expiration days and expired object delete marker cannot be enabled together.";
  }

  const transition = firstRecord(rule.Transitions);
  if (transition) {
    const hasDays = typeof transition.Days === "number" && Number.isFinite(transition.Days);
    const hasStorageClass =
      typeof transition.StorageClass === "string" && transition.StorageClass.length > 0;
    if (hasDays !== hasStorageClass) {
      return "Current version transition requires both Days and Storage class.";
    }
  }

  const noncurrentTransition = firstRecord(rule.NoncurrentVersionTransitions);
  if (noncurrentTransition) {
    const hasDays =
      typeof noncurrentTransition.NoncurrentDays === "number" &&
      Number.isFinite(noncurrentTransition.NoncurrentDays);
    const hasStorageClass =
      typeof noncurrentTransition.StorageClass === "string" &&
      noncurrentTransition.StorageClass.length > 0;
    if (hasDays !== hasStorageClass) {
      return "Noncurrent version transition requires both Noncurrent days and Storage class.";
    }
  }

  return lifecycleRuleHasAction(rule)
    ? null
    : "Add at least one lifecycle action before saving this rule.";
}

export function validateLifecycleVisualRules(rules: LifecycleRuleRecord[]): string | null {
  for (let index = 0; index < rules.length; index += 1) {
    const validationError = lifecycleVisualRuleValidationError(rules[index]);
    if (validationError) return `Rule ${index + 1}: ${validationError}`;
  }
  return null;
}

function parseOptionalNumber(value: string): number | undefined {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function setNestedValue(
  rule: LifecycleRuleRecord,
  key: string,
  nestedKey: string,
  value: unknown,
): LifecycleRuleRecord {
  const next = { ...rule };
  const nested = { ...(recordValue(next[key]) ?? {}) };
  if (value === undefined || value === false) {
    delete nested[nestedKey];
  } else {
    nested[nestedKey] = value;
  }
  if (Object.keys(nested).length === 0) {
    delete next[key];
  } else {
    next[key] = nested;
  }
  return next;
}

export function updateLifecycleVisualRule(
  rule: LifecycleRuleRecord,
  patch: LifecycleVisualRulePatch,
): LifecycleRuleRecord {
  if (!isLifecycleRuleVisuallyEditable(rule)) return rule;
  let next: LifecycleRuleRecord = { ...rule };
  if (patch.id !== undefined) next.ID = patch.id;
  if (patch.status !== undefined) next.Status = patch.status;
  if (patch.prefix !== undefined) {
    next = setNestedValue(next, "Filter", "Prefix", patch.prefix);
  }
  if (patch.expirationDays !== undefined) {
    next = setNestedValue(
      next,
      "Expiration",
      "Days",
      parseOptionalNumber(patch.expirationDays),
    );
    if (parseOptionalNumber(patch.expirationDays) !== undefined) {
      next = setNestedValue(next, "Expiration", "ExpiredObjectDeleteMarker", undefined);
    }
  }
  if (patch.expiredObjectDeleteMarker !== undefined) {
    next = setNestedValue(
      next,
      "Expiration",
      "ExpiredObjectDeleteMarker",
      patch.expiredObjectDeleteMarker || undefined,
    );
    if (patch.expiredObjectDeleteMarker) {
      next = setNestedValue(next, "Expiration", "Days", undefined);
    }
  }
  if (patch.noncurrentExpirationDays !== undefined) {
    next = setNestedValue(
      next,
      "NoncurrentVersionExpiration",
      "NoncurrentDays",
      parseOptionalNumber(patch.noncurrentExpirationDays),
    );
  }
  if (patch.abortMultipartDays !== undefined) {
    next = setNestedValue(
      next,
      "AbortIncompleteMultipartUpload",
      "DaysAfterInitiation",
      parseOptionalNumber(patch.abortMultipartDays),
    );
  }

  if (patch.transitionDays !== undefined || patch.transitionStorageClass !== undefined) {
    const current = readLifecycleVisualRule(next);
    const days = patch.transitionDays ?? current.transitionDays;
    const storageClass = patch.transitionStorageClass ?? current.transitionStorageClass;
    const parsedDays = parseOptionalNumber(days);
    if (parsedDays === undefined && storageClass === "") delete next.Transitions;
    else {
      next.Transitions = [{
        ...(parsedDays !== undefined ? { Days: parsedDays } : {}),
        ...(storageClass !== "" ? { StorageClass: storageClass } : { StorageClass: "" }),
      }];
    }
  }
  if (
    patch.noncurrentTransitionDays !== undefined ||
    patch.noncurrentTransitionStorageClass !== undefined
  ) {
    const current = readLifecycleVisualRule(next);
    const days = patch.noncurrentTransitionDays ?? current.noncurrentTransitionDays;
    const storageClass =
      patch.noncurrentTransitionStorageClass ?? current.noncurrentTransitionStorageClass;
    const parsedDays = parseOptionalNumber(days);
    if (parsedDays === undefined && storageClass === "") delete next.NoncurrentVersionTransitions;
    else {
      next.NoncurrentVersionTransitions = [{
        ...(parsedDays !== undefined ? { NoncurrentDays: parsedDays } : {}),
        ...(storageClass !== "" ? { StorageClass: storageClass } : { StorageClass: "" }),
      }];
    }
  }
  return next;
}

export function createVisualLifecycleRule(id: string): LifecycleRuleRecord {
  return {
    ID: id,
    Status: "Enabled",
  };
}

export function parseLifecycleRulesJson(
  text: string,
): { rules: LifecycleRuleRecord[] | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : [];
  } catch {
    return { rules: null, error: "Lifecycle rules JSON is invalid." };
  }
  if (!Array.isArray(parsed)) {
    return { rules: null, error: "JSON must be an array of rules." };
  }
  if (
    parsed.some(
      (rule) => rule === null || typeof rule !== "object" || Array.isArray(rule),
    )
  ) {
    return { rules: null, error: "Each lifecycle rule must be a JSON object." };
  }
  return { rules: parsed as LifecycleRuleRecord[], error: null };
}
