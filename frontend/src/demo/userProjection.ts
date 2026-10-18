import type {
  EffectiveAccountMembership,
  EffectiveUserAccess,
  ManagerToolAccess,
  User,
  UserSummary,
} from "../api/users";
import { resolveDemoAccountGrant } from "./http";
import { settings, type DemoState, type DemoUser } from "./state";

const MANAGER_TOOLS = [
  "bucket_compare",
  "bucket_integrity_check",
  "bucket_migration",
  "bucket_purge",
  "feature_rules",
] as const satisfies ReadonlyArray<keyof ManagerToolAccess>;

function groupsForUser(state: DemoState, userId: number) {
  return state.groups.filter(group => group.user_details?.some(member => member.id === userId));
}

function hasFeatureGrant(
  user: DemoUser,
  groups: ReturnType<typeof groupsForUser>,
  field: keyof Pick<
    DemoUser,
    | "can_access_ceph_admin"
    | "can_access_storage_ops"
    | "can_create_manual_private_connections"
    | "can_provision_managed_private_connections"
    | "browser_advanced_features_enabled"
  >,
): boolean {
  return Boolean(user[field] || groups.some(group => group[field]));
}

function managerToolAccess(
  user: DemoUser,
  groups: ReturnType<typeof groupsForUser>,
): { effective: ManagerToolAccess; inherited: ManagerToolAccess } {
  const roleSupportsTools = user.role !== "ui_none";
  const effective = {} as ManagerToolAccess;
  const inherited = {} as ManagerToolAccess;
  for (const tool of MANAGER_TOOLS) {
    const policy = settings.manager.feature_policies[tool];
    const directGrant = Boolean(user.manager_tool_access?.[tool]);
    const groupGrant = groups.some(group => Boolean(group.manager_tool_access?.[tool]));
    const enabled = roleSupportsTools
      && policy !== "disabled"
      && (policy === "default_on" || directGrant || groupGrant);
    effective[tool] = enabled;
    inherited[tool] = enabled && groupGrant;
  }
  return { effective, inherited };
}

function effectiveAccountLinks(state: DemoState, user: DemoUser): EffectiveAccountMembership[] {
  return state.accounts.flatMap(account => {
    const resolved = resolveDemoAccountGrant(state, account, user.id);
    if (!resolved.manager_role && !resolved.portal_role) return [];
    const direct = resolved.sources.find(source => source.kind === "direct")?.link;
    const groups = resolved.sources
      .filter(source => source.kind === "group")
      .map(source => ({
        group_id: source.group.id,
        group_name: source.group.name,
        manager_role: source.link.manager_role,
        portal_role: source.link.portal_role,
        determines_effective_manager_role: Boolean(
          source.link.manager_role
          && source.link.manager_role === resolved.manager_role,
        ),
        determines_effective_portal_role: Boolean(
          source.link.portal_role
          && source.link.portal_role === resolved.portal_role,
        ),
      }))
      .sort((left, right) => left.group_name.localeCompare(right.group_name) || left.group_id - right.group_id);
    const managerBrowserAllowed = resolved.sources.some(source =>
      source.link.manager_role === "account_administrator"
      && Boolean(source.link.allow_manager_browser_data_access));
    return [{
      account_id: account.id,
      manager_role: resolved.manager_role,
      portal_role: resolved.portal_role,
      allow_manager_browser_data_access: managerBrowserAllowed,
      provenance: {
        direct_manager_role: direct?.manager_role ?? null,
        direct_portal_role: direct?.portal_role ?? null,
        direct_determines_effective_manager_role: Boolean(
          direct?.manager_role
          && direct.manager_role === resolved.manager_role,
        ),
        direct_determines_effective_portal_role: Boolean(
          direct?.portal_role
          && direct.portal_role === resolved.portal_role,
        ),
        groups,
      },
    }];
  });
}

function effectiveS3UserDetails(state: DemoState, user: DemoUser) {
  const groups = groupsForUser(state, user.id);
  const ids = new Set([
    ...(user.s3_user_links ?? []).map(link => link.s3_user_id),
    ...groups.flatMap(group => (group.s3_user_links ?? []).map(link => link.s3_user_id)),
  ]);
  const names = new Map<number, string>();
  for (const account of state.accounts) {
    for (const [index, rgwUser] of (state.iam[account.id]?.users ?? []).entries()) {
      names.set(account.id * 100 + index, rgwUser.name);
    }
  }
  return [...ids]
    .sort((left, right) => left - right)
    .map(id => ({ id, name: names.get(id) ?? `S3 User #${id}` }));
}

function effectiveConnectionDetails(state: DemoState, user: DemoUser) {
  const groupIds = new Set(groupsForUser(state, user.id).map(group => group.id));
  return state.connections
    .filter(connection => connection.is_shared !== false)
    .filter(connection =>
      connection.user_details?.some(member => member.id === user.id)
      || connection.group_details?.some(group => groupIds.has(group.id)))
    .map(connection => ({ id: connection.id, name: connection.name }))
    .sort((left, right) => left.id - right.id);
}

function demoEffectiveAccess(state: DemoState, user: DemoUser): EffectiveUserAccess {
  const groups = groupsForUser(state, user.id);
  const roleSupportsTools = user.role !== "ui_none";
  const tools = managerToolAccess(user, groups);
  const groupManagedProvisioning = groups.some(group => Boolean(group.can_provision_managed_private_connections));
  const managedProvisioningPolicy = settings.manager.feature_policies.managed_private_connection_provisioning;
  const managedProvisioningEnabled = roleSupportsTools
    && managedProvisioningPolicy !== "disabled"
    && (managedProvisioningPolicy === "default_on"
      || hasFeatureGrant(user, groups, "can_provision_managed_private_connections"));
  return {
    can_access_ceph_admin: (user.role === "ui_admin" || user.role === "ui_superadmin")
      && hasFeatureGrant(user, groups, "can_access_ceph_admin"),
    can_access_storage_ops: roleSupportsTools
      && hasFeatureGrant(user, groups, "can_access_storage_ops"),
    can_create_manual_private_connections: roleSupportsTools
      && hasFeatureGrant(user, groups, "can_create_manual_private_connections"),
    can_provision_managed_private_connections: managedProvisioningEnabled,
    group_can_provision_managed_private_connections: managedProvisioningEnabled && groupManagedProvisioning,
    has_owned_private_connections: state.connections.some(connection =>
      connection.is_shared === false && connection.created_by_user_id === user.id),
    manager_tool_access: tools.effective,
    group_manager_tool_access: tools.inherited,
    browser_advanced_features_enabled: hasFeatureGrant(user, groups, "browser_advanced_features_enabled"),
    account_links: effectiveAccountLinks(state, user),
    s3_user_details: effectiveS3UserDetails(state, user),
    s3_connection_details: effectiveConnectionDetails(state, user),
  };
}

export function demoUserView(state: DemoState, user: DemoUser): User {
  return {
    ...user,
    effective_access: demoEffectiveAccess(state, user),
  };
}

export function demoUserSummary(user: DemoUser): UserSummary {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    avatar: user.avatar,
    role: user.role,
  };
}
