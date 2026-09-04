import type { AuthUser } from "../../../src/api/auth";
import type { ManagerToolAccess } from "../../../src/api/users";

const managerTools: ManagerToolAccess = {
  bucket_compare: true,
  bucket_integrity_check: true,
  bucket_migration: true,
  bucket_purge: false,
  feature_rules: false,
};

export const superAdminUser = {
  id: 1,
  email: "admin.docs@example.com",
  role: "ui_superadmin",
  ui_language: "en",
  can_access_ceph_admin: true,
  manager_tool_access: managerTools,
  account_links: [
    { account_id: 101, manager_role: "account_administrator", portal_role: "portal_manager" },
  ],
  s3_user_details: [{ id: 901, name: "helios-admin" }],
  s3_connection_details: [{ id: 701, name: "BlueHarbor Shared Connection" }],
} satisfies AuthUser;

export const adminUser = {
  ...superAdminUser,
  id: 2,
  email: "platform.admin@example.com",
  role: "ui_admin",
  s3_user_details: [{ id: 903, name: "platform-admin" }],
} satisfies AuthUser;

export const storageOpsAdminUser = {
  ...adminUser,
  can_access_storage_ops: true,
} satisfies AuthUser;

export const portalUser = {
  id: 3,
  email: "storage.user@example.com",
  role: "ui_user",
  ui_language: "en",
  can_access_ceph_admin: false,
  account_links: [
    { account_id: 101, manager_role: null, portal_role: "portal_user" },
  ],
} satisfies AuthUser;

export const storageUser = {
  ...portalUser,
  browser_advanced_features_enabled: true,
  manager_tool_access: managerTools,
  s3_user_details: [{ id: 904, name: "storage-user-helios" }],
  s3_connection_details: [{ id: 701, name: "BlueHarbor Shared Connection" }],
} satisfies AuthUser;
