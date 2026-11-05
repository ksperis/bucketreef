/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { PaginatedResponse } from "./types";
import type { UiRole } from "./users";

export type AccessAuditScope = "platform" | "rgw_account" | "rgw_user" | "s3_connection";
export type AccessAuditSourceKind = "direct" | "group" | "platform";
export type AccessAuditRightCode =
  | "ceph_admin"
  | "storage_ops"
  | "manager_bucket_compare"
  | "manager_bucket_integrity_check"
  | "manager_bucket_migration"
  | "manager_feature_rules"
  | "manager_bucket_purge"
  | "private_connection_create"
  | "managed_private_connection_provision"
  | "browser_advanced_features"
  | "account_administrator"
  | "portal_manager"
  | "portal_user"
  | "manager_browser_data_access"
  | "rgw_user_access"
  | "shared_connection_access";

type AccessAuditGrantSource = {
  kind: AccessAuditSourceKind;
  group_id: number | null;
  group_name: string | null;
};

export type AccessAuditRight = {
  code: AccessAuditRightCode;
  sources: AccessAuditGrantSource[];
};

export type AccessAuditRow = {
  key: string;
  principal: {
    id: number;
    email: string;
    full_name: string | null;
    role: UiRole;
    is_active: boolean;
  };
  scope: AccessAuditScope;
  target: {
    id: number | null;
    name: string;
    identifier: string | null;
  };
  rights: AccessAuditRight[];
};

export type AccessAuditSortBy = "user" | "scope" | "target";
export type AccessAuditSortDir = "asc" | "desc";

type AccessAuditQuery = {
  page?: number;
  page_size?: number;
  search?: string;
  scope?: AccessAuditScope;
  right?: AccessAuditRightCode;
  source?: AccessAuditSourceKind;
  user_id?: number;
  group_id?: number;
  target_id?: number;
  sort_by?: AccessAuditSortBy;
  sort_dir?: AccessAuditSortDir;
};

export const ACCESS_AUDIT_SCOPES: readonly AccessAuditScope[] = [
  "platform",
  "rgw_account",
  "rgw_user",
  "s3_connection",
];

export const ACCESS_AUDIT_SOURCES: readonly AccessAuditSourceKind[] = [
  "platform",
  "direct",
  "group",
];

export const ACCESS_AUDIT_RIGHTS: readonly AccessAuditRightCode[] = [
  "ceph_admin",
  "storage_ops",
  "manager_bucket_compare",
  "manager_bucket_integrity_check",
  "manager_bucket_migration",
  "manager_feature_rules",
  "manager_bucket_purge",
  "private_connection_create",
  "managed_private_connection_provision",
  "browser_advanced_features",
  "account_administrator",
  "portal_manager",
  "portal_user",
  "manager_browser_data_access",
  "rgw_user_access",
  "shared_connection_access",
];

export async function listAccessAudit(params: AccessAuditQuery = {}): Promise<PaginatedResponse<AccessAuditRow>> {
  const { data } = await client.get<PaginatedResponse<AccessAuditRow>>("/admin/access-audit", { params });
  return data;
}

export async function downloadAccessAuditCsv(params: Omit<AccessAuditQuery, "page" | "page_size"> = {}): Promise<Blob> {
  const { data } = await client.get<Blob>("/admin/access-audit/export.csv", {
    params,
    responseType: "blob",
  });
  return data;
}
