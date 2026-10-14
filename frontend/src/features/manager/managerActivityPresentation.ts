/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ManagerActivityEntry } from "../../api/managerActivity";

type ManagerActivityCategory = "bucket" | "user" | "group" | "role" | "policy" | "topic" | "migration" | "object" | "other";

function normalizeActionLabel(action: string): string {
  return action
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function bucketActionLabel(action: string): string {
  if (action.includes("create")) return "Bucket created";
  if (action.includes("delete")) return "Bucket deleted";
  if (action.includes("lifecycle")) return "Lifecycle updated";
  if (action.includes("versioning")) return "Versioning updated";
  if (action.includes("notification")) return "Notifications updated";
  if (action.includes("replication")) return "Replication updated";
  if (action.includes("policy")) return "Bucket policy updated";
  if (action.includes("tag")) return "Bucket tags updated";
  if (action.includes("quota")) return "Bucket quota updated";
  if (action.includes("compare")) return "Bucket compare updated";
  return "Bucket updated";
}

function iamActionLabel(action: string, entityLabel: string): string {
  if (action.includes("create")) return `${entityLabel} created`;
  if (action.includes("delete")) return `${entityLabel} deleted`;
  if (action.includes("attach")) return `${entityLabel} policy attached`;
  if (action.includes("detach")) return `${entityLabel} policy detached`;
  if (action.includes("status")) return `${entityLabel} status updated`;
  if (action.includes("key")) return `${entityLabel} key updated`;
  if (action.includes("policy")) return `${entityLabel} policy updated`;
  return `${entityLabel} updated`;
}

function genericEntityActionLabel(action: string, entityLabel: string): string {
  if (action.includes("create")) return `${entityLabel} created`;
  if (action.includes("delete")) return `${entityLabel} deleted`;
  return `${entityLabel} updated`;
}

export function managerActivityPresentation(log: ManagerActivityEntry): { label: string; category: ManagerActivityCategory } {
  const action = log.action.toLowerCase();
  const entityType = (log.entity_type ?? "").toLowerCase();
  if (entityType === "bucket" || action.includes("bucket")) return { label: bucketActionLabel(action), category: "bucket" };
  if (entityType.includes("user") || action.includes("iam_user") || action.includes("access_key")) return { label: iamActionLabel(action, "IAM user"), category: "user" };
  if (entityType.includes("group") || action.includes("iam_group")) return { label: iamActionLabel(action, "IAM group"), category: "group" };
  if (entityType.includes("role") || action.includes("iam_role")) return { label: iamActionLabel(action, "IAM role"), category: "role" };
  if (entityType.includes("policy") || action.includes("policy")) return { label: iamActionLabel(action, "Policy"), category: "policy" };
  if (entityType.includes("topic") || action.includes("topic")) return { label: genericEntityActionLabel(action, "Topic"), category: "topic" };
  if (action.includes("migration")) return { label: genericEntityActionLabel(action, "Migration"), category: "migration" };
  if (entityType.includes("object") || action.includes("object")) return { label: genericEntityActionLabel(action, "Object"), category: "object" };
  return { label: normalizeActionLabel(log.action), category: "other" };
}

export function managerActivityTarget(log: ManagerActivityEntry): string {
  return log.entity_id || log.context_name || log.account_name || "—";
}
