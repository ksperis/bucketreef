/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { PaginatedResponse } from "./types";

export type AccessAuditScope = "platform" | "rgw_account" | "rgw_user" | "s3_connection";
export type AccessAuditSourceKind = "direct" | "group";
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
  group_id?: number | null;
  group_name?: string | null;
};

export type AccessAuditRight = {
  code: AccessAuditRightCode;
  label: string;
  sources: AccessAuditGrantSource[];
};

export type AccessAuditRow = {
  key: string;
  principal: {
    id: number;
    email: string;
    full_name?: string | null;
    role: string;
    is_active: boolean;
  };
  scope: AccessAuditScope;
  target: {
    id?: number | null;
    name: string;
    identifier?: string | null;
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
  target_id?: number;
  sort_by?: AccessAuditSortBy;
  sort_dir?: AccessAuditSortDir;
};

export const ACCESS_AUDIT_SCOPES: Array<{ value: AccessAuditScope; label: string }> = [
  { value: "platform", label: "Platform" },
  { value: "rgw_account", label: "RGW Account" },
  { value: "rgw_user", label: "RGW User" },
  { value: "s3_connection", label: "S3 Connection" },
];

export const ACCESS_AUDIT_RIGHTS: Array<{ value: AccessAuditRightCode; label: string }> = [
  { value: "ceph_admin", label: "Ceph Admin" },
  { value: "storage_ops", label: "Storage Ops" },
  { value: "manager_bucket_compare", label: "Manager · Bucket compare" },
  { value: "manager_bucket_integrity_check", label: "Manager · Integrity check" },
  { value: "manager_bucket_migration", label: "Manager · Bucket migration" },
  { value: "manager_feature_rules", label: "Manager · Feature rules" },
  { value: "manager_bucket_purge", label: "Manager · Bucket purge" },
  { value: "private_connection_create", label: "Create manual private connections" },
  { value: "managed_private_connection_provision", label: "Provision managed private connections" },
  { value: "browser_advanced_features", label: "Browser advanced features" },
  { value: "account_administrator", label: "Account administrator" },
  { value: "portal_manager", label: "Portal manager" },
  { value: "portal_user", label: "Portal user" },
  { value: "manager_browser_data_access", label: "Manager Browser data access" },
  { value: "rgw_user_access", label: "RGW user access" },
  { value: "shared_connection_access", label: "Shared S3 connection access" },
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
