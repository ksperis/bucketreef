/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { UiGroup, UiGroupPayload } from "../../api/groups";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  normalizeManagerToolAccess,
} from "./adminAccessConfig";

export function emptyAdminGroupForm(): UiGroupPayload {
  return {
    name: "",
    description: "",
    avatar_source: "initials",
    avatar_icon: null,
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    allow_multisite_endpoint_switching: false,
    browser_advanced_features_enabled: false,
    manager_tool_access: { ...DEFAULT_MANAGER_TOOL_ACCESS },
    user_ids: [],
    account_links: [],
    s3_user_links: [],
    s3_connection_ids: [],
    openstack_cloud_ids: [],
  };
}

export function adminGroupForm(group: UiGroup): UiGroupPayload {
  return {
    name: group.name,
    description: group.description ?? "",
    avatar_source: group.avatar.source,
    avatar_icon: group.avatar.icon,
    can_access_ceph_admin: group.can_access_ceph_admin,
    can_access_storage_ops: group.can_access_storage_ops,
    can_create_manual_private_connections: group.can_create_manual_private_connections,
    can_provision_managed_private_connections:
      group.can_provision_managed_private_connections,
    allow_multisite_endpoint_switching: group.allow_multisite_endpoint_switching,
    browser_advanced_features_enabled: group.browser_advanced_features_enabled,
    manager_tool_access: group.manager_tool_access,
    user_ids: group.user_details.map((user) => Number(user.id)),
    account_links: group.account_links.map((link) => ({
      account_id: Number(link.account_id),
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    })),
    s3_user_links: group.s3_user_links.map((link) => ({
      s3_user_id: Number(link.s3_user_id),
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    })),
    s3_connection_ids: group.s3_connection_details.map((connection) =>
      Number(connection.id),
    ),
    openstack_cloud_ids: (group.openstack_cloud_details ?? []).map((cloud) =>
      Number(cloud.id),
    ),
  };
}

export function adminGroupPayload(
  form: UiGroupPayload,
  options: {
    includeMembers: boolean;
    openStackEnabled: boolean;
    avatarUploadPending: boolean;
  },
): UiGroupPayload {
  return {
    name: String(form.name || "").trim(),
    description: form.description || null,
    avatar_source: options.avatarUploadPending ? undefined : form.avatar_source,
    avatar_icon: form.avatar_icon,
    can_access_ceph_admin: Boolean(form.can_access_ceph_admin),
    can_access_storage_ops: Boolean(form.can_access_storage_ops),
    can_create_manual_private_connections: Boolean(
      form.can_create_manual_private_connections,
    ),
    can_provision_managed_private_connections: Boolean(
      form.can_provision_managed_private_connections,
    ),
    allow_multisite_endpoint_switching: Boolean(
      form.allow_multisite_endpoint_switching,
    ),
    browser_advanced_features_enabled: Boolean(
      form.browser_advanced_features_enabled,
    ),
    manager_tool_access: normalizeManagerToolAccess(form.manager_tool_access),
    ...(options.includeMembers ? { user_ids: form.user_ids ?? [] } : {}),
    account_links:
      form.account_links?.map((link) => ({
        account_id: Number(link.account_id),
        manager_role: link.manager_role,
        portal_role: link.portal_role,
        allow_manager_browser_data_access: link.allow_manager_browser_data_access,
      })) ?? [],
    s3_user_links: form.s3_user_links ?? [],
    s3_connection_ids: form.s3_connection_ids ?? [],
    ...(options.openStackEnabled
      ? { openstack_cloud_ids: form.openstack_cloud_ids ?? [] }
      : {}),
  };
}
