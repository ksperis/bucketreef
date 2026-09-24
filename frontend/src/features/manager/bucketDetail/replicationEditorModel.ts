/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  buildReplicationConfigurationFromGraphical,
  createEmptyGraphicalReplicationRule,
  type GraphicalReplicationRule,
  type ReplicationRuleStatus,
} from "../bucketReplication";

export type ReplicationRuleRecord = Record<string, unknown>;
export type ReplicationVisualRulePatch = Partial<GraphicalReplicationRule>;

const allowedRuleKeys = new Set([
  "ID",
  "Status",
  "Priority",
  "Prefix",
  "Filter",
  "Destination",
  "DeleteMarkerReplication",
]);

function asRecord(value: unknown): ReplicationRuleRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as ReplicationRuleRecord;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyKeys(value: ReplicationRuleRecord, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isStatus(value: unknown): value is ReplicationRuleStatus {
  return value === "Enabled" || value === "Disabled";
}

function isPriority(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
  }
  return typeof value === "string" && /^\d+$/.test(value.trim());
}

export function cloneReplicationConfiguration(
  configuration: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(configuration)) as Record<string, unknown>;
}

export function normalizeReplicationEditorConfiguration(
  value: unknown,
): Record<string, unknown> {
  return asRecord(value)
    ? cloneReplicationConfiguration(value as Record<string, unknown>)
    : {};
}

export function replicationConfigurationRules(
  configuration: Record<string, unknown>,
): unknown[] {
  return Array.isArray(configuration.Rules) ? configuration.Rules : [];
}

export function replicationConfigurationRole(
  configuration: Record<string, unknown>,
): string {
  return typeof configuration.Role === "string" ? configuration.Role : "";
}

export function hasAdvancedReplicationTopLevelFields(
  configuration: Record<string, unknown>,
): boolean {
  return Object.keys(configuration).some(
    (key) => key !== "Role" && key !== "Rules",
  );
}

export function isReplicationRuleVisuallyEditable(rule: unknown): boolean {
  const record = asRecord(rule);
  if (!record || !hasOnlyKeys(record, allowedRuleKeys)) return false;

  if (hasOwn(record, "ID") && typeof record.ID !== "string") return false;
  if (hasOwn(record, "Status") && !isStatus(record.Status)) return false;
  if (hasOwn(record, "Priority") && !isPriority(record.Priority)) return false;
  if (hasOwn(record, "Prefix") && typeof record.Prefix !== "string") return false;

  const filter = asRecord(record.Filter);
  if (hasOwn(record, "Filter")) {
    if (!filter || !hasOnlyKeys(filter, new Set(["Prefix"]))) return false;
    if (hasOwn(filter, "Prefix") && typeof filter.Prefix !== "string") return false;
  }
  if (hasOwn(record, "Prefix") && hasOwn(record, "Filter")) return false;

  const destination = asRecord(record.Destination);
  if (hasOwn(record, "Destination")) {
    if (!destination || !hasOnlyKeys(destination, new Set(["Bucket"]))) {
      return false;
    }
    if (
      hasOwn(destination, "Bucket") &&
      typeof destination.Bucket !== "string"
    ) {
      return false;
    }
  }

  const deleteMarker = asRecord(record.DeleteMarkerReplication);
  if (hasOwn(record, "DeleteMarkerReplication")) {
    if (!deleteMarker || !hasOnlyKeys(deleteMarker, new Set(["Status"]))) {
      return false;
    }
    if (hasOwn(deleteMarker, "Status") && !isStatus(deleteMarker.Status)) {
      return false;
    }
  }

  return true;
}

export function readReplicationVisualRule(rule: unknown): GraphicalReplicationRule {
  const record = asRecord(rule);
  if (!record) return createEmptyGraphicalReplicationRule();

  const filter = asRecord(record.Filter);
  const destination = asRecord(record.Destination);
  const deleteMarker = asRecord(record.DeleteMarkerReplication);
  const rawPriority = record.Priority;

  return {
    id: typeof record.ID === "string" ? record.ID : "",
    status: isStatus(record.Status) ? record.Status : "Enabled",
    priority:
      typeof rawPriority === "number" && Number.isFinite(rawPriority)
        ? String(Math.trunc(rawPriority))
        : typeof rawPriority === "string"
          ? rawPriority
          : "",
    prefix:
      typeof record.Prefix === "string"
        ? record.Prefix
        : typeof filter?.Prefix === "string"
          ? filter.Prefix
          : "",
    destinationBucket:
      typeof destination?.Bucket === "string" ? destination.Bucket : "",
    deleteMarkerStatus: isStatus(deleteMarker?.Status)
      ? deleteMarker.Status
      : "Disabled",
  };
}

export function createReplicationVisualRule(): ReplicationRuleRecord {
  const configuration = buildReplicationConfigurationFromGraphical("", [
    createEmptyGraphicalReplicationRule(),
  ]);
  const rules = replicationConfigurationRules(configuration);
  return asRecord(rules[0]) ?? {
    Status: "Enabled",
    Destination: { Bucket: "" },
    DeleteMarkerReplication: { Status: "Disabled" },
  };
}

export function updateReplicationVisualRule(
  rule: unknown,
  patch: ReplicationVisualRulePatch,
): unknown {
  const current = asRecord(rule);
  if (!current || !isReplicationRuleVisuallyEditable(current)) return rule;

  const next: ReplicationRuleRecord = { ...current };

  if (hasOwn(patch, "id")) {
    if (patch.id) next.ID = patch.id;
    else delete next.ID;
  }
  if (hasOwn(patch, "status") && patch.status) {
    next.Status = patch.status;
  }
  if (hasOwn(patch, "priority")) {
    const priority = patch.priority ?? "";
    if (!priority.trim()) {
      delete next.Priority;
    } else {
      const asNumber = Number(priority);
      next.Priority =
        Number.isFinite(asNumber) && Number.isInteger(asNumber)
          ? asNumber
          : priority;
    }
  }
  if (hasOwn(patch, "prefix")) {
    const prefix = patch.prefix ?? "";
    if (hasOwn(current, "Prefix")) {
      if (prefix) next.Prefix = prefix;
      else delete next.Prefix;
    } else {
      const currentFilter = asRecord(current.Filter);
      const nextFilter: ReplicationRuleRecord = currentFilter
        ? { ...currentFilter }
        : {};
      if (prefix) nextFilter.Prefix = prefix;
      else delete nextFilter.Prefix;
      if (Object.keys(nextFilter).length > 0 || currentFilter) {
        next.Filter = nextFilter;
      } else {
        delete next.Filter;
      }
    }
  }
  if (hasOwn(patch, "destinationBucket")) {
    const destination = asRecord(current.Destination);
    next.Destination = {
      ...(destination ?? {}),
      Bucket: patch.destinationBucket ?? "",
    };
  }
  if (hasOwn(patch, "deleteMarkerStatus") && patch.deleteMarkerStatus) {
    const deleteMarker = asRecord(current.DeleteMarkerReplication);
    next.DeleteMarkerReplication = {
      ...(deleteMarker ?? {}),
      Status: patch.deleteMarkerStatus,
    };
  }

  return next;
}

export function parseReplicationEditorJson(text: string): {
  configuration: Record<string, unknown> | null;
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    return {
      configuration: null,
      error: "Replication configuration JSON is invalid.",
    };
  }

  const configuration = asRecord(parsed);
  if (!configuration) {
    return {
      configuration: null,
      error: "Replication configuration must be a JSON object.",
    };
  }
  if (hasOwn(configuration, "Rules") && !Array.isArray(configuration.Rules)) {
    return {
      configuration: null,
      error: "Replication configuration Rules must be an array.",
    };
  }

  return {
    configuration: cloneReplicationConfiguration(configuration),
    error: null,
  };
}

export function replicationRuleSummary(rule: unknown): {
  id: string;
  status: string;
  priority: string;
  prefix: string;
  destination: string;
  deleteMarkerStatus: string;
} {
  const record = asRecord(rule);
  const filter = asRecord(record?.Filter);
  const destination = asRecord(record?.Destination);
  const deleteMarker = asRecord(record?.DeleteMarkerReplication);
  const priority = record?.Priority;

  return {
    id: typeof record?.ID === "string" && record.ID ? record.ID : "(no ID)",
    status: typeof record?.Status === "string" ? record.Status : "Unknown",
    priority:
      typeof priority === "number" || typeof priority === "string"
        ? String(priority)
        : "—",
    prefix:
      typeof record?.Prefix === "string"
        ? record.Prefix || "(all objects)"
        : typeof filter?.Prefix === "string"
          ? filter.Prefix || "(all objects)"
          : "(all objects)",
    destination:
      typeof destination?.Bucket === "string" && destination.Bucket
        ? destination.Bucket
        : "Not set",
    deleteMarkerStatus:
      typeof deleteMarker?.Status === "string"
        ? deleteMarker.Status
        : "Disabled",
  };
}
