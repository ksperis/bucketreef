import type { EffectiveUserAccess, ManagerToolAccess } from "../api/users";

type EffectiveUserAccessOverrides = Omit<
  Partial<EffectiveUserAccess>,
  "manager_tool_access" | "group_manager_tool_access"
> & {
  manager_tool_access?: Partial<ManagerToolAccess>;
  group_manager_tool_access?: Partial<ManagerToolAccess>;
};

export function buildManagerToolAccess(
  overrides: Partial<ManagerToolAccess> = {},
): ManagerToolAccess {
  return {
    bucket_compare: false,
    bucket_integrity_check: false,
    bucket_migration: false,
    bucket_purge: false,
    feature_rules: false,
    ...overrides,
  };
}

export function buildEffectiveUserAccess(
  overrides: EffectiveUserAccessOverrides = {},
): EffectiveUserAccess {
  const {
    manager_tool_access: managerToolAccess,
    group_manager_tool_access: groupManagerToolAccess,
    ...accessOverrides
  } = overrides;
  return {
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    allow_multisite_endpoint_switching: false,
    group_can_provision_managed_private_connections: false,
    has_owned_private_connections: false,
    browser_advanced_features_enabled: false,
    account_links: [],
    s3_user_details: [],
    s3_connection_details: [],
    ...accessOverrides,
    manager_tool_access: buildManagerToolAccess(managerToolAccess),
    group_manager_tool_access: buildManagerToolAccess(groupManagerToolAccess),
  };
}
