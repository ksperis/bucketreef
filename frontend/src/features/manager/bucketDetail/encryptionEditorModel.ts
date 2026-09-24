/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type EncryptionRuleRecord = Record<string, unknown>;

const encryptionAlgorithms = ["AES256", "aws:kms"] as const;
type EncryptionAlgorithm = (typeof encryptionAlgorithms)[number];
type EncryptionBucketKeyState = "default" | "enabled" | "disabled";

export type EncryptionVisualRuleDraft = {
  algorithm: EncryptionAlgorithm;
  kmsKeyId: string;
  bucketKeyState: EncryptionBucketKeyState;
};

export type EncryptionVisualRulePatch = Partial<EncryptionVisualRuleDraft>;

const allowedRuleKeys = new Set([
  "ApplyServerSideEncryptionByDefault",
  "BucketKeyEnabled",
]);
const allowedDefaultEncryptionKeys = new Set(["SSEAlgorithm", "KMSMasterKeyID"]);

function isPlainRecord(value: unknown): value is EncryptionRuleRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: EncryptionRuleRecord, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isEncryptionAlgorithm(value: unknown): value is EncryptionAlgorithm {
  return (
    typeof value === "string" &&
    encryptionAlgorithms.includes(value as EncryptionAlgorithm)
  );
}

export function isEncryptionRuleVisuallyEditable(rule: EncryptionRuleRecord): boolean {
  if (!isPlainRecord(rule) || !hasOnlyKeys(rule, allowedRuleKeys)) return false;

  const defaultEncryption = rule.ApplyServerSideEncryptionByDefault;
  if (!isPlainRecord(defaultEncryption)) return false;
  if (!hasOnlyKeys(defaultEncryption, allowedDefaultEncryptionKeys)) return false;
  if (!isEncryptionAlgorithm(defaultEncryption.SSEAlgorithm)) return false;

  if (
    defaultEncryption.KMSMasterKeyID !== undefined &&
    typeof defaultEncryption.KMSMasterKeyID !== "string"
  ) {
    return false;
  }
  if (
    defaultEncryption.SSEAlgorithm === "AES256" &&
    defaultEncryption.KMSMasterKeyID !== undefined
  ) {
    return false;
  }
  if (rule.BucketKeyEnabled !== undefined && typeof rule.BucketKeyEnabled !== "boolean") {
    return false;
  }
  if (
    defaultEncryption.SSEAlgorithm === "AES256" &&
    rule.BucketKeyEnabled !== undefined
  ) {
    return false;
  }

  return true;
}

export function readEncryptionVisualRule(
  rule: EncryptionRuleRecord,
): EncryptionVisualRuleDraft {
  const defaultEncryption = isPlainRecord(rule.ApplyServerSideEncryptionByDefault)
    ? rule.ApplyServerSideEncryptionByDefault
    : {};
  const algorithm = isEncryptionAlgorithm(defaultEncryption.SSEAlgorithm)
    ? defaultEncryption.SSEAlgorithm
    : "AES256";
  const bucketKeyState: EncryptionBucketKeyState =
    rule.BucketKeyEnabled === true
      ? "enabled"
      : rule.BucketKeyEnabled === false
        ? "disabled"
        : "default";

  return {
    algorithm,
    kmsKeyId:
      typeof defaultEncryption.KMSMasterKeyID === "string"
        ? defaultEncryption.KMSMasterKeyID
        : "",
    bucketKeyState,
  };
}

export function updateEncryptionVisualRule(
  rule: EncryptionRuleRecord,
  patch: EncryptionVisualRulePatch,
): EncryptionRuleRecord {
  if (!isEncryptionRuleVisuallyEditable(rule)) return rule;

  const next: EncryptionRuleRecord = { ...rule };
  const currentDefault = rule.ApplyServerSideEncryptionByDefault as EncryptionRuleRecord;
  const nextDefault: EncryptionRuleRecord = { ...currentDefault };
  const nextAlgorithm = patch.algorithm ?? readEncryptionVisualRule(rule).algorithm;

  if (patch.algorithm !== undefined) {
    nextDefault.SSEAlgorithm = patch.algorithm;
    if (patch.algorithm === "AES256") {
      delete nextDefault.KMSMasterKeyID;
      delete next.BucketKeyEnabled;
    }
  }
  if (patch.kmsKeyId !== undefined && nextAlgorithm === "aws:kms") {
    if (patch.kmsKeyId.length > 0) nextDefault.KMSMasterKeyID = patch.kmsKeyId;
    else delete nextDefault.KMSMasterKeyID;
  }
  if (patch.bucketKeyState !== undefined) {
    if (patch.bucketKeyState === "default") delete next.BucketKeyEnabled;
    else next.BucketKeyEnabled = patch.bucketKeyState === "enabled";
  }

  next.ApplyServerSideEncryptionByDefault = nextDefault;
  return next;
}

export function createVisualEncryptionRule(): EncryptionRuleRecord {
  return {
    ApplyServerSideEncryptionByDefault: {
      SSEAlgorithm: "AES256",
    },
  };
}

export function parseEncryptionRulesJson(
  text: string,
): { rules: EncryptionRuleRecord[] | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : [];
  } catch {
    return { rules: null, error: "Encryption rules JSON is invalid." };
  }
  if (!Array.isArray(parsed)) {
    return { rules: null, error: "Encryption JSON must be an array of rules." };
  }
  if (parsed.some((rule) => !isPlainRecord(rule))) {
    return { rules: null, error: "Each encryption rule must be a JSON object." };
  }
  return { rules: parsed as EncryptionRuleRecord[], error: null };
}

export function validateVisualEncryptionRules(
  rules: EncryptionRuleRecord[],
): string | null {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!isEncryptionRuleVisuallyEditable(rule)) continue;
    const draft = readEncryptionVisualRule(rule);
    if (!encryptionAlgorithms.includes(draft.algorithm)) {
      return `Rule ${index + 1}: select a supported encryption algorithm.`;
    }
  }
  return null;
}
