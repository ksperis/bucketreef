/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type {
  CreateUserPayload,
  S3UserMembership,
  UiRole,
  UpdateUserPayload,
  User,
} from "../../api/users";
import {
  isAdminLikeRole,
} from "../../utils/workspaces";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  normalizeManagerToolAccess,
  roleSupportsOperationalAccess,
} from "./adminAccessConfig";
import type { AdminAccountSelection } from "./AdminAccountAssociationsPanel";

export type AdminUserAssociationSelection = {
  accounts: AdminAccountSelection[];
  s3Users: S3UserMembership[];
  connections: number[];
  groups: number[];
  openStack: number[];
};

type AdminUserActorAccess = {
  currentIsAdminLike: boolean;
  currentIsSuperAdmin: boolean;
};

type AdminUserRoleAccessPatch = Pick<
  UpdateUserPayload,
  | "role"
  | "can_access_ceph_admin"
  | "can_access_storage_ops"
  | "can_create_manual_private_connections"
  | "can_provision_managed_private_connections"
>;

export function emptyAdminUserCreateForm(): CreateUserPayload {
  return {
    email: "",
    full_name: "",
    password: "",
    role: "ui_user",
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    allow_multisite_endpoint_switching: false,
    manager_tool_access: { ...DEFAULT_MANAGER_TOOL_ACCESS },
    browser_advanced_features_enabled: false,
  };
}

export function adminUserEditForm(user: User): UpdateUserPayload {
  const supportsOperationalAccess = roleSupportsOperationalAccess(user.role);
  return {
    email: user.email,
    full_name: user.full_name ?? "",
    ui_language: user.ui_language ?? null,
    quota_alerts_enabled: user.quota_alerts_enabled !== false,
    quota_alerts_global_watch: Boolean(user.quota_alerts_global_watch),
    role: user.role,
    can_access_ceph_admin: isAdminLikeRole(user.role)
      ? Boolean(user.can_access_ceph_admin)
      : false,
    can_access_storage_ops: supportsOperationalAccess
      ? Boolean(user.can_access_storage_ops)
      : false,
    can_create_manual_private_connections: supportsOperationalAccess
      ? Boolean(user.can_create_manual_private_connections)
      : false,
    can_provision_managed_private_connections: supportsOperationalAccess
      ? Boolean(user.can_provision_managed_private_connections)
      : false,
    allow_multisite_endpoint_switching: supportsOperationalAccess
      ? Boolean(user.allow_multisite_endpoint_switching)
      : false,
    manager_tool_access: normalizeManagerToolAccess(user.manager_tool_access),
    browser_advanced_features_enabled: Boolean(user.browser_advanced_features_enabled),
  };
}

export function adminUserRoleAccessPatch(
  role: UiRole,
  current: UpdateUserPayload,
  actor: AdminUserActorAccess,
): AdminUserRoleAccessPatch {
  const supportsCephAdmin = isAdminLikeRole(role);
  const supportsOperationalAccess = roleSupportsOperationalAccess(role);
  return {
    role,
    can_access_ceph_admin:
      actor.currentIsSuperAdmin && supportsCephAdmin
        ? Boolean(current.can_access_ceph_admin)
        : false,
    can_access_storage_ops:
      actor.currentIsAdminLike && supportsOperationalAccess
        ? Boolean(current.can_access_storage_ops)
        : false,
    can_create_manual_private_connections: supportsOperationalAccess
      ? Boolean(current.can_create_manual_private_connections)
      : false,
    can_provision_managed_private_connections: supportsOperationalAccess
      ? Boolean(current.can_provision_managed_private_connections)
      : false,
  };
}

function accountLinks(accounts: AdminAccountSelection[]) {
  return accounts.map((entry) => ({
    account_id: Number(entry.id),
    manager_role: entry.manager_role,
    portal_role: entry.portal_role,
    allow_manager_browser_data_access: entry.allow_manager_browser_data_access,
  }));
}

export function adminUserCreatePayload(
  form: CreateUserPayload,
  associations: AdminUserAssociationSelection,
  actor: AdminUserActorAccess,
  openStackEnabled: boolean,
): CreateUserPayload {
  const role = form.role ?? "ui_user";
  const supportsOperationalAccess = roleSupportsOperationalAccess(role);
  return {
    email: form.email,
    full_name: form.full_name?.trim() || null,
    password: form.password,
    role,
    can_access_ceph_admin:
      actor.currentIsSuperAdmin && isAdminLikeRole(role)
        ? Boolean(form.can_access_ceph_admin)
        : false,
    can_access_storage_ops:
      actor.currentIsAdminLike && supportsOperationalAccess
        ? Boolean(form.can_access_storage_ops)
        : false,
    can_create_manual_private_connections: supportsOperationalAccess
      ? Boolean(form.can_create_manual_private_connections)
      : false,
    can_provision_managed_private_connections: supportsOperationalAccess
      ? Boolean(form.can_provision_managed_private_connections)
      : false,
    allow_multisite_endpoint_switching: supportsOperationalAccess
      ? Boolean(form.allow_multisite_endpoint_switching)
      : false,
    manager_tool_access: supportsOperationalAccess
      ? normalizeManagerToolAccess(form.manager_tool_access)
      : { ...DEFAULT_MANAGER_TOOL_ACCESS },
    browser_advanced_features_enabled: Boolean(form.browser_advanced_features_enabled),
    account_links: accountLinks(associations.accounts),
    s3_user_links: associations.s3Users,
    s3_connection_ids: associations.connections,
    group_ids: associations.groups,
    ...(openStackEnabled ? { openstack_cloud_ids: associations.openStack } : {}),
  };
}

export function adminUserUpdatePayload(
  form: UpdateUserPayload,
  user: User,
  associations: AdminUserAssociationSelection,
  actor: AdminUserActorAccess,
  openStackEnabled: boolean,
): UpdateUserPayload {
  const nextRole = form.role ?? user.role;
  const supportsOperationalAccess = roleSupportsOperationalAccess(nextRole);
  return {
    ...(form.email ? { email: form.email } : {}),
    full_name: form.full_name?.trim() || null,
    ui_language: form.ui_language ?? null,
    quota_alerts_enabled: form.quota_alerts_enabled !== false,
    quota_alerts_global_watch:
      isAdminLikeRole(nextRole) && Boolean(form.quota_alerts_global_watch),
    ...(form.role ? { role: nextRole } : {}),
    can_access_ceph_admin:
      actor.currentIsSuperAdmin && isAdminLikeRole(nextRole)
        ? Boolean(form.can_access_ceph_admin ?? user.can_access_ceph_admin)
        : false,
    can_access_storage_ops:
      actor.currentIsAdminLike && supportsOperationalAccess
        ? Boolean(form.can_access_storage_ops ?? user.can_access_storage_ops)
        : false,
    can_create_manual_private_connections: supportsOperationalAccess
      ? Boolean(
          form.can_create_manual_private_connections ??
            user.can_create_manual_private_connections,
        )
      : false,
    can_provision_managed_private_connections: supportsOperationalAccess
      ? Boolean(
          form.can_provision_managed_private_connections ??
            user.can_provision_managed_private_connections,
        )
      : false,
    allow_multisite_endpoint_switching: supportsOperationalAccess
      ? Boolean(
          form.allow_multisite_endpoint_switching ??
            user.allow_multisite_endpoint_switching,
        )
      : false,
    manager_tool_access: supportsOperationalAccess
      ? normalizeManagerToolAccess(form.manager_tool_access ?? user.manager_tool_access)
      : { ...DEFAULT_MANAGER_TOOL_ACCESS },
    browser_advanced_features_enabled: Boolean(
      form.browser_advanced_features_enabled ?? user.browser_advanced_features_enabled,
    ),
    account_links: accountLinks(associations.accounts),
    group_ids: associations.groups,
    s3_user_links: associations.s3Users,
    s3_connection_ids: associations.connections,
    ...(openStackEnabled ? { openstack_cloud_ids: associations.openStack } : {}),
  };
}

export function adminUserLdapCreatePayload(
  payload: CreateUserPayload,
): Omit<CreateUserPayload, "password"> {
  const { password: _password, ...create } = payload;
  return create;
}
