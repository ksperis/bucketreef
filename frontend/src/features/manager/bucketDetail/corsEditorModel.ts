/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type CorsRuleRecord = Record<string, unknown>;

export const corsMethods = ["GET", "PUT", "POST", "DELETE", "HEAD"] as const;
export type CorsMethod = (typeof corsMethods)[number];

export type CorsVisualRuleDraft = {
  id: string;
  allowedOrigins: string[];
  allowedMethods: CorsMethod[];
  allowedHeaders: string[];
  exposeHeaders: string[];
  maxAgeSeconds: string;
};

export type CorsVisualRulePatch = Partial<CorsVisualRuleDraft>;

const allowedRuleKeys = new Set([
  "ID",
  "AllowedOrigins",
  "AllowedMethods",
  "AllowedHeaders",
  "ExposeHeaders",
  "MaxAgeSeconds",
]);

function isPlainRecord(value: unknown): value is CorsRuleRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function optionalStringArray(rule: CorsRuleRecord, key: string): boolean {
  return rule[key] === undefined || isStringArray(rule[key]);
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

export function isCorsRuleVisuallyEditable(rule: CorsRuleRecord): boolean {
  if (!isPlainRecord(rule)) return false;
  if (Object.keys(rule).some((key) => !allowedRuleKeys.has(key))) return false;
  if (rule.ID !== undefined && typeof rule.ID !== "string") return false;
  if (!optionalStringArray(rule, "AllowedOrigins")) return false;
  if (!optionalStringArray(rule, "AllowedHeaders")) return false;
  if (!optionalStringArray(rule, "ExposeHeaders")) return false;
  if (!optionalStringArray(rule, "AllowedMethods")) return false;
  if (!optionalFiniteNumber(rule.MaxAgeSeconds)) return false;

  const methods = rule.AllowedMethods;
  return (
    methods === undefined ||
    (isStringArray(methods) &&
      methods.every((method) => corsMethods.includes(method as CorsMethod)))
  );
}

function stringArray(value: unknown): string[] {
  return isStringArray(value) ? [...value] : [];
}

export function readCorsVisualRule(rule: CorsRuleRecord): CorsVisualRuleDraft {
  const methods = stringArray(rule.AllowedMethods).filter((method): method is CorsMethod =>
    corsMethods.includes(method as CorsMethod),
  );
  return {
    id: typeof rule.ID === "string" ? rule.ID : "",
    allowedOrigins: stringArray(rule.AllowedOrigins),
    allowedMethods: methods,
    allowedHeaders: stringArray(rule.AllowedHeaders),
    exposeHeaders: stringArray(rule.ExposeHeaders),
    maxAgeSeconds:
      typeof rule.MaxAgeSeconds === "number" && Number.isFinite(rule.MaxAgeSeconds)
        ? String(rule.MaxAgeSeconds)
        : "",
  };
}

function setOptionalStringArray(
  rule: CorsRuleRecord,
  key: "AllowedHeaders" | "ExposeHeaders",
  values: string[],
) {
  if (values.length === 0) delete rule[key];
  else rule[key] = values;
}

export function updateCorsVisualRule(
  rule: CorsRuleRecord,
  patch: CorsVisualRulePatch,
): CorsRuleRecord {
  if (!isCorsRuleVisuallyEditable(rule)) return rule;
  const next = { ...rule };

  if (patch.id !== undefined) {
    if (patch.id.trim()) next.ID = patch.id;
    else delete next.ID;
  }
  if (patch.allowedOrigins !== undefined) next.AllowedOrigins = [...patch.allowedOrigins];
  if (patch.allowedMethods !== undefined) next.AllowedMethods = [...patch.allowedMethods];
  if (patch.allowedHeaders !== undefined) {
    setOptionalStringArray(next, "AllowedHeaders", patch.allowedHeaders);
  }
  if (patch.exposeHeaders !== undefined) {
    setOptionalStringArray(next, "ExposeHeaders", patch.exposeHeaders);
  }
  if (patch.maxAgeSeconds !== undefined) {
    if (patch.maxAgeSeconds === "") {
      delete next.MaxAgeSeconds;
    } else {
      const parsed = Number(patch.maxAgeSeconds);
      if (Number.isFinite(parsed)) next.MaxAgeSeconds = parsed;
    }
  }
  return next;
}

export function createVisualCorsRule(): CorsRuleRecord {
  return {
    AllowedOrigins: [""],
    AllowedMethods: ["GET"],
  };
}

export function parseCorsRulesJson(
  text: string,
): { rules: CorsRuleRecord[] | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : [];
  } catch {
    return { rules: null, error: "CORS rules JSON is invalid." };
  }
  if (!Array.isArray(parsed)) {
    return { rules: null, error: "CORS JSON must be an array of rules." };
  }
  if (parsed.some((rule) => !isPlainRecord(rule))) {
    return { rules: null, error: "Each CORS rule must be a JSON object." };
  }
  return { rules: parsed as CorsRuleRecord[], error: null };
}

export function validateVisualCorsRules(rules: CorsRuleRecord[]): string | null {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!isCorsRuleVisuallyEditable(rule)) continue;
    const draft = readCorsVisualRule(rule);
    if (draft.allowedOrigins.length === 0) {
      return `Rule ${index + 1}: at least one allowed origin is required.`;
    }
    if (draft.allowedMethods.length === 0) {
      return `Rule ${index + 1}: at least one allowed method is required.`;
    }
    if (draft.allowedOrigins.some((origin) => !origin.trim())) {
      return `Rule ${index + 1}: allowed origins cannot be empty.`;
    }
    if (draft.allowedHeaders.some((header) => !header.trim())) {
      return `Rule ${index + 1}: allowed headers cannot be empty.`;
    }
    if (draft.exposeHeaders.some((header) => !header.trim())) {
      return `Rule ${index + 1}: exposed headers cannot be empty.`;
    }
    if (
      draft.maxAgeSeconds &&
      (!/^\d+$/.test(draft.maxAgeSeconds) || Number(draft.maxAgeSeconds) < 0)
    ) {
      return `Rule ${index + 1}: max age must be a non-negative integer.`;
    }
  }
  return null;
}
