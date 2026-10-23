import type { AuthUser } from "../../../src/api/auth";
import type { AccountMembership, EffectiveUserAccess, ManagerToolAccess } from "../../../src/api/users";

const managerTools: ManagerToolAccess = {
  bucket_compare: true,
  bucket_integrity_check: true,
  bucket_migration: true,
  bucket_purge: false,
  feature_rules: false,
};

const noManagerTools: ManagerToolAccess = {
  bucket_compare: false,
  bucket_integrity_check: false,
  bucket_migration: false,
  bucket_purge: false,
  feature_rules: false,
};

function effectiveAccess({
  canAccessCephAdmin = false,
  canAccessStorageOps = false,
  managerToolAccess = managerTools,
  browserAdvancedFeaturesEnabled = false,
  accountLinks = [],
  s3UserDetails = [],
  s3ConnectionDetails = [],
}: {
  canAccessCephAdmin?: boolean;
  canAccessStorageOps?: boolean;
  managerToolAccess?: ManagerToolAccess;
  browserAdvancedFeaturesEnabled?: boolean;
  accountLinks?: AccountMembership[];
  s3UserDetails?: { id: number; name: string }[];
  s3ConnectionDetails?: { id: number; name: string }[];
} = {}): EffectiveUserAccess {
  return {
    can_access_ceph_admin: canAccessCephAdmin,
    can_access_storage_ops: canAccessStorageOps,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    group_can_provision_managed_private_connections: false,
    has_owned_private_connections: false,
    manager_tool_access: managerToolAccess,
    group_manager_tool_access: noManagerTools,
    browser_advanced_features_enabled: browserAdvancedFeaturesEnabled,
    account_links: accountLinks.map((link) => ({
      ...link,
      provenance: {
        direct_manager_role: link.manager_role ?? null,
        direct_portal_role: link.portal_role ?? null,
        direct_determines_effective_manager_role: Boolean(link.manager_role),
        direct_determines_effective_portal_role: Boolean(link.portal_role),
        direct_allow_manager_browser_data_access: link.allow_manager_browser_data_access,
        groups: [],
      },
    })),
    s3_user_details: s3UserDetails,
    s3_connection_details: s3ConnectionDetails,
  };
}

function fixtureUser(input: Pick<AuthUser, "id" | "email" | "role"> & Partial<AuthUser>): AuthUser {
  const fullName = input.full_name ?? null;
  const initials = fullName
    ? fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("")
    : input.email.slice(0, 1).toUpperCase();
  return {
    id: input.id,
    email: input.email,
    full_name: fullName,
    picture_url: input.picture_url ?? null,
    avatar: input.avatar ?? {
      preference: "initials",
      source: "initials",
      url: null,
      initials,
      updated_at: null,
    },
    has_local_password: input.has_local_password ?? true,
    is_active: input.is_active ?? true,
    is_admin: input.is_admin ?? (input.role === "ui_admin" || input.role === "ui_superadmin"),
    role: input.role,
    can_access_ceph_admin: input.can_access_ceph_admin ?? false,
    can_access_storage_ops: input.can_access_storage_ops ?? false,
    can_create_manual_private_connections: input.can_create_manual_private_connections ?? false,
    can_provision_managed_private_connections: input.can_provision_managed_private_connections ?? false,
    manager_tool_access: input.manager_tool_access ?? managerTools,
    browser_advanced_features_enabled: input.browser_advanced_features_enabled ?? false,
    ui_language: input.ui_language ?? "en",
    quota_alerts_enabled: input.quota_alerts_enabled ?? true,
    quota_alerts_global_watch: input.quota_alerts_global_watch ?? false,
    ui_preferences: input.ui_preferences ?? { theme: null, selected_portal_account_id: null },
    account_links: input.account_links ?? [],
    group_details: input.group_details ?? [],
    s3_user_links: input.s3_user_links ?? [],
    s3_user_details: input.s3_user_details ?? [],
    s3_connection_details: input.s3_connection_details ?? [],
    effective_access: input.effective_access ?? effectiveAccess(),
    last_login_at: input.last_login_at ?? null,
  };
}

const superAdminAccountLinks: AccountMembership[] = [
  { account_id: 101, manager_role: "account_administrator", portal_role: "portal_manager", allow_manager_browser_data_access: false },
];
const superAdminS3Users = [{ id: 901, name: "helios-admin" }];
const sharedConnections = [{ id: 701, name: "BlueHarbor Shared Connection" }];

export const superAdminUser = fixtureUser({
  id: 1,
  email: "admin.docs@example.com",
  full_name: "Docs Administrator",
  role: "ui_superadmin",
  ui_language: "en",
  can_access_ceph_admin: true,
  manager_tool_access: managerTools,
  account_links: superAdminAccountLinks,
  s3_user_details: superAdminS3Users,
  s3_connection_details: sharedConnections,
  effective_access: effectiveAccess({
    canAccessCephAdmin: true,
    accountLinks: superAdminAccountLinks,
    s3UserDetails: superAdminS3Users,
    s3ConnectionDetails: sharedConnections,
  }),
});

const adminS3Users = [{ id: 903, name: "platform-admin" }];
export const adminUser = fixtureUser({
  ...superAdminUser,
  id: 2,
  email: "platform.admin@example.com",
  full_name: "Platform Administrator",
  role: "ui_admin",
  s3_user_details: adminS3Users,
  effective_access: effectiveAccess({
    canAccessCephAdmin: true,
    accountLinks: superAdminAccountLinks,
    s3UserDetails: adminS3Users,
    s3ConnectionDetails: sharedConnections,
  }),
});

export const storageOpsAdminUser = fixtureUser({
  ...adminUser,
  can_access_storage_ops: true,
  effective_access: {
    ...adminUser.effective_access,
    can_access_storage_ops: true,
  },
});

const portalAccountLinks: AccountMembership[] = [
  { account_id: 101, manager_role: null, portal_role: "portal_user", allow_manager_browser_data_access: false },
];
export const portalUser = fixtureUser({
  id: 3,
  email: "storage.user@example.com",
  full_name: "Storage User",
  role: "ui_user",
  ui_language: "en",
  can_access_ceph_admin: false,
  account_links: portalAccountLinks,
  effective_access: effectiveAccess({ accountLinks: portalAccountLinks }),
});

const storageS3Users = [{ id: 904, name: "storage-user-helios" }];
export const storageUser = fixtureUser({
  ...portalUser,
  browser_advanced_features_enabled: true,
  manager_tool_access: managerTools,
  s3_user_details: storageS3Users,
  s3_connection_details: sharedConnections,
  effective_access: effectiveAccess({
    browserAdvancedFeaturesEnabled: true,
    accountLinks: portalAccountLinks,
    s3UserDetails: storageS3Users,
    s3ConnectionDetails: sharedConnections,
  }),
});
