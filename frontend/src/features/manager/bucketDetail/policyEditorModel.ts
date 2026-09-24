/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type PolicyDocumentRecord = Record<string, unknown>;
export type PolicyStatementRecord = Record<string, unknown>;
export type PolicyEffect = "" | "Allow" | "Deny";
export type PolicyPrincipalMode =
  | "none"
  | "any"
  | "direct"
  | "AWS"
  | "Service"
  | "Federated"
  | "CanonicalUser";

export type PolicyConditionEntry = {
  operator: string;
  key: string;
  values: string[];
};

export type PolicyVisualStatementDraft = {
  sid: string;
  effect: PolicyEffect;
  principalMode: PolicyPrincipalMode;
  principalValues: string[];
  actions: string[];
  resources: string[];
  conditions: PolicyConditionEntry[];
};

export type PolicyVisualStatementPatch = Partial<
  Omit<PolicyVisualStatementDraft, "conditions">
>;

const supportedPrincipalKinds = new Set([
  "AWS",
  "Service",
  "Federated",
  "CanonicalUser",
]);

const supportedStatementKeys = new Set([
  "Sid",
  "Effect",
  "Principal",
  "Action",
  "Resource",
  "Condition",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isStringListValue(value: unknown): boolean {
  return typeof value === "string" || (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function readStringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function writeStringList(
  target: Record<string, unknown>,
  key: string,
  values: string[],
  previousValue: unknown,
) {
  if (values.length === 0) {
    target[key] = [];
    return;
  }
  target[key] = Array.isArray(previousValue) || values.length > 1 ? values : values[0];
}

export function splitPolicyListText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function policyListText(values: string[]): string {
  return values.join("\n");
}

export function policyStatements(policy: PolicyDocumentRecord): PolicyStatementRecord[] {
  const raw = policy.Statement;
  if (Array.isArray(raw)) {
    return raw.filter(
      (entry): entry is PolicyStatementRecord => asRecord(entry) !== null,
    );
  }
  const statement = asRecord(raw);
  return statement ? [statement] : [];
}

export function withPolicyStatements(
  policy: PolicyDocumentRecord,
  statements: PolicyStatementRecord[],
): PolicyDocumentRecord {
  const next = cloneRecord(policy);
  if (!Object.prototype.hasOwnProperty.call(next, "Version") && statements.length > 0) {
    next.Version = "2012-10-17";
  }
  const preserveSingleStatementShape = !Array.isArray(policy.Statement) && asRecord(policy.Statement);
  next.Statement = preserveSingleStatementShape && statements.length === 1
    ? statements[0]
    : statements;
  return next;
}

function isSupportedPrincipal(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return true;
  const principal = asRecord(value);
  if (!principal) return false;
  const entries = Object.entries(principal);
  if (entries.length !== 1) return false;
  const [kind, principalValue] = entries[0];
  return supportedPrincipalKinds.has(kind) && isStringListValue(principalValue);
}

function isSupportedCondition(value: unknown): boolean {
  if (value === undefined) return true;
  const condition = asRecord(value);
  if (!condition) return false;
  return Object.values(condition).every((operatorValue) => {
    const operator = asRecord(operatorValue);
    if (!operator) return false;
    return Object.values(operator).every((entry) => isStringListValue(entry));
  });
}

export function isPolicyStatementVisuallyEditable(statement: PolicyStatementRecord): boolean {
  if (Object.keys(statement).some((key) => !supportedStatementKeys.has(key))) return false;
  if (statement.Sid !== undefined && typeof statement.Sid !== "string") return false;
  if (
    statement.Effect !== undefined
    && statement.Effect !== "Allow"
    && statement.Effect !== "Deny"
  ) return false;
  if (statement.Action !== undefined && !isStringListValue(statement.Action)) return false;
  if (statement.Resource !== undefined && !isStringListValue(statement.Resource)) return false;
  if (!isSupportedPrincipal(statement.Principal)) return false;
  return isSupportedCondition(statement.Condition);
}

function readPrincipal(statement: PolicyStatementRecord): Pick<
  PolicyVisualStatementDraft,
  "principalMode" | "principalValues"
> {
  const principal = statement.Principal;
  if (principal === undefined) return { principalMode: "none", principalValues: [] };
  if (typeof principal === "string") {
    if (principal === "*") return { principalMode: "any", principalValues: [] };
    return { principalMode: "direct", principalValues: [principal] };
  }
  const record = asRecord(principal);
  if (!record) return { principalMode: "none", principalValues: [] };
  const [entry] = Object.entries(record);
  if (!entry || !supportedPrincipalKinds.has(entry[0])) {
    return { principalMode: "none", principalValues: [] };
  }
  return {
    principalMode: entry[0] as PolicyPrincipalMode,
    principalValues: readStringList(entry[1]),
  };
}

export function readPolicyConditions(statement: PolicyStatementRecord): PolicyConditionEntry[] {
  const condition = asRecord(statement.Condition);
  if (!condition) return [];
  const entries: PolicyConditionEntry[] = [];
  Object.entries(condition).forEach(([operator, rawOperator]) => {
    const operatorValue = asRecord(rawOperator);
    if (!operatorValue) return;
    Object.entries(operatorValue).forEach(([key, rawValue]) => {
      entries.push({ operator, key, values: readStringList(rawValue) });
    });
  });
  return entries;
}

export function readPolicyVisualStatement(
  statement: PolicyStatementRecord,
): PolicyVisualStatementDraft {
  const principal = readPrincipal(statement);
  return {
    sid: typeof statement.Sid === "string" ? statement.Sid : "",
    effect: statement.Effect === "Allow" || statement.Effect === "Deny"
      ? statement.Effect
      : "",
    ...principal,
    actions: readStringList(statement.Action),
    resources: readStringList(statement.Resource),
    conditions: readPolicyConditions(statement),
  };
}

function writePrincipal(
  target: PolicyStatementRecord,
  mode: PolicyPrincipalMode,
  values: string[],
  previousValue: unknown,
) {
  if (mode === "none") {
    delete target.Principal;
    return;
  }
  if (mode === "any") {
    target.Principal = "*";
    return;
  }
  if (mode === "direct") {
    target.Principal = values[0] ?? "";
    return;
  }

  const previousPrincipal = asRecord(previousValue);
  const previousKindValue = previousPrincipal?.[mode];
  target.Principal = {
    [mode]: Array.isArray(previousKindValue) || values.length > 1
      ? values
      : (values[0] ?? ""),
  };
}

export function updatePolicyVisualStatement(
  statement: PolicyStatementRecord,
  patch: PolicyVisualStatementPatch,
): PolicyStatementRecord {
  if (!isPolicyStatementVisuallyEditable(statement)) return statement;
  const next = cloneRecord(statement);
  const current = readPolicyVisualStatement(statement);

  if (patch.sid !== undefined) {
    if (patch.sid) next.Sid = patch.sid;
    else delete next.Sid;
  }
  if (patch.effect !== undefined) {
    if (patch.effect) next.Effect = patch.effect;
    else delete next.Effect;
  }
  if (patch.actions !== undefined) {
    writeStringList(next, "Action", patch.actions, statement.Action);
  }
  if (patch.resources !== undefined) {
    writeStringList(next, "Resource", patch.resources, statement.Resource);
  }
  if (patch.principalMode !== undefined || patch.principalValues !== undefined) {
    writePrincipal(
      next,
      patch.principalMode ?? current.principalMode,
      patch.principalValues ?? current.principalValues,
      statement.Principal,
    );
  }
  return next;
}

export function setPolicyConditionValue(
  statement: PolicyStatementRecord,
  operator: string,
  key: string,
  values: string[],
): PolicyStatementRecord {
  if (!isPolicyStatementVisuallyEditable(statement) || !operator || !key) return statement;
  const next = cloneRecord(statement);
  const condition = asRecord(next.Condition) ?? {};
  const operatorValue = asRecord(condition[operator]) ?? {};
  const previousValue = operatorValue[key];
  writeStringList(operatorValue, key, values, previousValue);
  condition[operator] = operatorValue;
  next.Condition = condition;
  return next;
}

export function removePolicyCondition(
  statement: PolicyStatementRecord,
  operator: string,
  key: string,
): PolicyStatementRecord {
  if (!isPolicyStatementVisuallyEditable(statement)) return statement;
  const next = cloneRecord(statement);
  const condition = asRecord(next.Condition);
  if (!condition) return next;
  const operatorValue = asRecord(condition[operator]);
  if (!operatorValue) return next;
  delete operatorValue[key];
  if (Object.keys(operatorValue).length === 0) delete condition[operator];
  else condition[operator] = operatorValue;
  if (Object.keys(condition).length === 0) delete next.Condition;
  else next.Condition = condition;
  return next;
}

export function createVisualPolicyStatement(sid: string): PolicyStatementRecord {
  return {
    Sid: sid,
    Effect: "Allow",
    Principal: "*",
    Action: [],
    Resource: [],
  };
}

export function parsePolicyJson(text: string): {
  policy: PolicyDocumentRecord | null;
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { policy: null, error: "Bucket policy JSON is invalid." };
  }
  const policy = asRecord(parsed);
  if (!policy) {
    return { policy: null, error: "Bucket policy must be a JSON object." };
  }
  if (policy.Statement !== undefined) {
    const statement = policy.Statement;
    const valid = asRecord(statement) !== null || (
      Array.isArray(statement) && statement.every((entry) => asRecord(entry) !== null)
    );
    if (!valid) {
      return {
        policy: null,
        error: "Policy Statement must be an object or an array of objects.",
      };
    }
  }
  return { policy, error: null };
}

export function isPolicyConfigurationEmpty(policy: PolicyDocumentRecord): boolean {
  if (Object.keys(policy).length === 0) return true;
  if (policyStatements(policy).length > 0) return false;
  return Object.keys(policy).every((key) => key === "Version" || key === "Id" || key === "Statement");
}

export function validateVisualPolicy(policy: PolicyDocumentRecord): string | null {
  const statements = policyStatements(policy);
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (!isPolicyStatementVisuallyEditable(statement)) continue;
    const draft = readPolicyVisualStatement(statement);
    const label = draft.sid.trim() || `Statement ${index + 1}`;
    if (!draft.effect) return `${label}: Effect is required.`;
    if (draft.principalMode === "none") return `${label}: Principal is required.`;
    if (
      (draft.principalMode === "direct"
        || supportedPrincipalKinds.has(draft.principalMode))
      && draft.principalValues.every((value) => !value.trim())
    ) return `${label}: Principal value is required.`;
    if (draft.actions.length === 0 || draft.actions.every((value) => !value.trim())) {
      return `${label}: at least one Action is required.`;
    }
    if (draft.resources.length === 0 || draft.resources.every((value) => !value.trim())) {
      return `${label}: at least one Resource is required.`;
    }
    for (const condition of draft.conditions) {
      if (!condition.operator.trim() || !condition.key.trim()) {
        return `${label}: Condition operator and key are required.`;
      }
      if (condition.values.length === 0 || condition.values.every((value) => !value.trim())) {
        return `${label}: Condition values cannot be empty.`;
      }
    }
  }
  return null;
}

export function policyStatementSid(statement: PolicyStatementRecord, index: number): string {
  return typeof statement.Sid === "string" && statement.Sid.trim()
    ? statement.Sid
    : `Statement ${index + 1}`;
}

export function policyStatementEffect(statement: PolicyStatementRecord): string {
  return statement.Effect === "Allow" || statement.Effect === "Deny"
    ? statement.Effect
    : "—";
}

export function policyValueSummary(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.length ? value.join(", ") : "—";
  }
  return value === undefined ? "—" : "Advanced";
}

export function policyPrincipalSummary(value: unknown): string {
  if (typeof value === "string") return value;
  const principal = asRecord(value);
  if (!principal) return value === undefined ? "—" : "Advanced";
  return Object.entries(principal)
    .map(([kind, principalValue]) => `${kind}: ${policyValueSummary(principalValue)}`)
    .join("; ") || "—";
}
