import type { AuthUser } from "../../../src/api/auth";
import type { AccountMembership, EffectiveUserAccess, ManagerToolAccess } from "../../../src/api/users";

const managerTools: ManagerToolAccess = {
  bucket_compare: true,
  bucket_integrity_check: true,
  bucket_migration: true,
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
    has_owned_private_connections: false,
    manager_tool_access: managerToolAccess,
    browser_advanced_features_enabled: browserAdvancedFeaturesEnabled,
    account_links: accountLinks.map((link) => ({
      ...link,
      provenance: {
        direct_manager_role: link.manager_role ?? null,
        direct_portal_role: link.portal_role ?? null,
        direct_determines_effective_manager_role: Boolean(link.manager_role),
        direct_determines_effective_portal_role: Boolean(link.portal_role),
        groups: [],
      },
    })),
    s3_user_details: s3UserDetails,
    s3_connection_details: s3ConnectionDetails,
  };
}

const superAdminAccountLinks: AccountMembership[] = [
  { account_id: 101, manager_role: "account_administrator", portal_role: "portal_manager" },
];
const superAdminS3Users = [{ id: 901, name: "helios-admin" }];
const sharedConnections = [{ id: 701, name: "BlueHarbor Shared Connection" }];

export const superAdminUser = {
  id: 1,
  email: "admin.docs@example.com",
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
} satisfies AuthUser;

const adminS3Users = [{ id: 903, name: "platform-admin" }];
export const adminUser = {
  ...superAdminUser,
  id: 2,
  email: "platform.admin@example.com",
  role: "ui_admin",
  s3_user_details: adminS3Users,
  effective_access: effectiveAccess({
    canAccessCephAdmin: true,
    accountLinks: superAdminAccountLinks,
    s3UserDetails: adminS3Users,
    s3ConnectionDetails: sharedConnections,
  }),
} satisfies AuthUser;

export const storageOpsAdminUser = {
  ...adminUser,
  can_access_storage_ops: true,
  effective_access: {
    ...adminUser.effective_access,
    can_access_storage_ops: true,
  },
} satisfies AuthUser;

const portalAccountLinks: AccountMembership[] = [
  { account_id: 101, manager_role: null, portal_role: "portal_user" },
];
export const portalUser = {
  id: 3,
  email: "storage.user@example.com",
  role: "ui_user",
  ui_language: "en",
  can_access_ceph_admin: false,
  account_links: portalAccountLinks,
  effective_access: effectiveAccess({ accountLinks: portalAccountLinks }),
} satisfies AuthUser;

const storageS3Users = [{ id: 904, name: "storage-user-helios" }];
export const storageUser = {
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
} satisfies AuthUser;
