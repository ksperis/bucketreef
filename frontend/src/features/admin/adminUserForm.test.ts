import type { CreateUserPayload, User } from "../../api/users";
import { DEFAULT_MANAGER_TOOL_ACCESS } from "./adminAccessConfig";
import {
  adminUserCreatePayload,
  adminUserEditForm,
  adminUserLdapCreatePayload,
  adminUserRoleAccessPatch,
  adminUserUpdatePayload,
  emptyAdminUserCreateForm,
  type AdminUserAssociationSelection,
} from "./adminUserForm";

const associations: AdminUserAssociationSelection = {
  accounts: [{
    id: 7,
    manager_role: "account_administrator",
    portal_role: "portal_user",
    allow_manager_browser_data_access: true,
  }],
  s3Users: [{ s3_user_id: 8, allow_manager_browser_data_access: true }],
  connections: [9],
  groups: [10],
  openStack: [11],
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: "user@example.test",
    full_name: "User",
    role: "ui_admin",
    can_access_ceph_admin: true,
    can_access_storage_ops: true,
    can_create_manual_private_connections: true,
    can_provision_managed_private_connections: true,
    allow_multisite_endpoint_switching: true,
    manager_tool_access: {
      bucket_compare: true,
      bucket_integrity_check: true,
      bucket_migration: true,
      bucket_purge: true,
      feature_rules: true,
    },
    browser_advanced_features_enabled: true,
    ui_language: "fr",
    quota_alerts_enabled: true,
    quota_alerts_global_watch: true,
    account_links: [],
    group_details: [],
    s3_user_links: [],
    s3_user_details: [],
    s3_connection_details: [],
    openstack_cloud_details: [],
    ...overrides,
  } as User;
}

describe("adminUserForm", () => {
  it("enforces target-role and actor privilege boundaries when creating a user", () => {
    const form: CreateUserPayload = {
      ...emptyAdminUserCreateForm(),
      email: " user@example.test ",
      full_name: " User ",
      password: "secret",
      role: "ui_none",
      can_access_ceph_admin: true,
      can_access_storage_ops: true,
      can_create_manual_private_connections: true,
      can_provision_managed_private_connections: true,
      allow_multisite_endpoint_switching: true,
      browser_advanced_features_enabled: true,
      manager_tool_access: {
        bucket_compare: true,
        bucket_integrity_check: true,
        bucket_migration: true,
        bucket_purge: true,
        feature_rules: true,
      },
    };

    const payload = adminUserCreatePayload(
      form,
      associations,
      { currentIsAdminLike: true, currentIsSuperAdmin: true },
      false,
    );

    expect(payload).toEqual(expect.objectContaining({
      email: " user@example.test ",
      full_name: "User",
      role: "ui_none",
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      can_create_manual_private_connections: false,
      can_provision_managed_private_connections: false,
      allow_multisite_endpoint_switching: false,
      manager_tool_access: DEFAULT_MANAGER_TOOL_ACCESS,
      browser_advanced_features_enabled: true,
      account_links: [{
        account_id: 7,
        manager_role: "account_administrator",
        portal_role: "portal_user",
        allow_manager_browser_data_access: true,
      }],
      s3_user_links: associations.s3Users,
      s3_connection_ids: [9],
      group_ids: [10],
    }));
    expect(payload).not.toHaveProperty("openstack_cloud_ids");
  });

  it("projects persisted state and clears stale operational access on role downgrade", () => {
    const user = makeUser();
    const form = adminUserEditForm(user);
    expect(form).toEqual(expect.objectContaining({
      role: "ui_admin",
      can_access_ceph_admin: true,
      can_access_storage_ops: true,
      allow_multisite_endpoint_switching: true,
    }));

    const downgraded = {
      ...form,
      ...adminUserRoleAccessPatch("ui_none", form, {
        currentIsAdminLike: true,
        currentIsSuperAdmin: true,
      }),
    };
    const payload = adminUserUpdatePayload(
      downgraded,
      user,
      associations,
      { currentIsAdminLike: true, currentIsSuperAdmin: true },
      true,
    );

    expect(payload).toEqual(expect.objectContaining({
      role: "ui_none",
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      can_create_manual_private_connections: false,
      can_provision_managed_private_connections: false,
      allow_multisite_endpoint_switching: false,
      manager_tool_access: DEFAULT_MANAGER_TOOL_ACCESS,
      quota_alerts_global_watch: false,
      openstack_cloud_ids: [11],
    }));
  });

  it("builds the LDAP create contract from the same payload without the local password", () => {
    const payload = adminUserCreatePayload(
      {
        ...emptyAdminUserCreateForm(),
        email: "ldap@example.test",
        password: "local-only",
        role: "ui_admin",
      },
      { accounts: [], s3Users: [], connections: [], groups: [], openStack: [] },
      { currentIsAdminLike: true, currentIsSuperAdmin: true },
      true,
    );

    expect(adminUserLdapCreatePayload(payload)).toEqual(
      expect.objectContaining({ email: "ldap@example.test", role: "ui_admin" }),
    );
    expect(adminUserLdapCreatePayload(payload)).not.toHaveProperty("password");
  });
});
