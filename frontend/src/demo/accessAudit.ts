import {
  ACCESS_AUDIT_RIGHTS,
  type AccessAuditRight,
  type AccessAuditRightCode,
  type AccessAuditRow,
  type AccessAuditScope,
} from "../api/accessAudit";
import type { UiGroup } from "../api/groups";
import type { User } from "../api/users";
import { resolveDemoAccountGrant } from "./http";
import type { DemoState } from "./state";

type AuditSource = AccessAuditRight["sources"][number];
type AuditTarget = AccessAuditRow["target"];

const rightLabels = new Map(ACCESS_AUDIT_RIGHTS.map(({ value, label }) => [value, label]));
const managerToolRights = {
  bucket_compare: "manager_bucket_compare",
  bucket_integrity_check: "manager_bucket_integrity_check",
  bucket_migration: "manager_bucket_migration",
  feature_rules: "manager_feature_rules",
  bucket_purge: "manager_bucket_purge",
} as const satisfies Record<string, AccessAuditRightCode>;

function directSource(): AuditSource {
  return { kind: "direct" };
}

function groupSource(group: UiGroup): AuditSource {
  return { kind: "group", group_id: group.id, group_name: group.name };
}

function groupsForUser(state: DemoState, userId: number): UiGroup[] {
  return state.groups.filter(group => group.user_details?.some(member => member.id === userId));
}

function flagSources(
  userValue: unknown,
  groups: UiGroup[],
  groupValue: (group: UiGroup) => unknown,
): AuditSource[] {
  return [
    ...(userValue ? [directSource()] : []),
    ...groups.filter(group => groupValue(group)).map(groupSource),
  ];
}

function addRight(
  rows: Map<string, AccessAuditRow>,
  user: User,
  scope: AccessAuditScope,
  target: AuditTarget,
  code: AccessAuditRightCode,
  sources: AuditSource[],
): void {
  if (sources.length === 0) return;
  const key = scope === "platform" ? `${user.id}:platform` : `${user.id}:${scope}:${target.id}`;
  let row = rows.get(key);
  if (!row) {
    row = {
      key,
      principal: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_active: user.is_active !== false,
      },
      scope,
      target,
      rights: [],
    };
    rows.set(key, row);
  }
  const existing = row.rights.find(right => right.code === code);
  if (existing) {
    for (const source of sources) {
      if (!existing.sources.some(candidate => candidate.kind === source.kind && candidate.group_id === source.group_id)) {
        existing.sources.push(source);
      }
    }
    return;
  }
  row.rights.push({ code, label: rightLabels.get(code) ?? code, sources: [...sources] });
}

function addPlatformRows(rows: Map<string, AccessAuditRow>, user: User, groups: UiGroup[]): void {
  const supportsManagerTools = user.role !== "ui_none";
  const supportsCephAdmin = user.role === "ui_admin" || user.role === "ui_superadmin";
  const target = { name: "Platform" };

  if (supportsCephAdmin) {
    addRight(rows, user, "platform", target, "ceph_admin", flagSources(
      user.can_access_ceph_admin,
      groups,
      group => group.can_access_ceph_admin,
    ));
  }
  if (supportsManagerTools) {
    addRight(rows, user, "platform", target, "storage_ops", flagSources(
      user.can_access_storage_ops,
      groups,
      group => group.can_access_storage_ops,
    ));
    addRight(rows, user, "platform", target, "private_connection_create", flagSources(
      user.can_create_manual_private_connections,
      groups,
      group => group.can_create_manual_private_connections,
    ));
    addRight(rows, user, "platform", target, "managed_private_connection_provision", flagSources(
      user.can_provision_managed_private_connections,
      groups,
      group => group.can_provision_managed_private_connections,
    ));
    for (const [tool, code] of Object.entries(managerToolRights) as Array<[
      keyof NonNullable<User["manager_tool_access"]>,
      AccessAuditRightCode,
    ]>) {
      addRight(rows, user, "platform", target, code, flagSources(
        user.manager_tool_access?.[tool],
        groups,
        group => group.manager_tool_access?.[tool],
      ));
    }
  }
  addRight(rows, user, "platform", target, "browser_advanced_features", flagSources(
    user.browser_advanced_features_enabled,
    groups,
    group => group.browser_advanced_features_enabled,
  ));
}

function addAccountRows(rows: Map<string, AccessAuditRow>, state: DemoState, user: User): void {
  for (const account of state.accounts) {
    const resolved = resolveDemoAccountGrant(state, account, user.id);
    const sourcesFor = (predicate: (link: typeof resolved.sources[number]["link"]) => boolean) => resolved.sources
      .filter(source => predicate(source.link))
      .map(source => source.kind === "direct" ? directSource() : groupSource(source.group));
    const managerSources = sourcesFor(link => link.manager_role === "account_administrator");
    const portalSources = resolved.portal_role
      ? sourcesFor(link => link.portal_role === resolved.portal_role)
      : [];
    const browserSources = sourcesFor(link =>
      link.manager_role === "account_administrator" && Boolean(link.allow_manager_browser_data_access));
    const target = { id: account.id, name: account.name, identifier: account.rgw_account_id };
    addRight(rows, user, "rgw_account", target, "account_administrator", managerSources);
    if (resolved.portal_role) addRight(rows, user, "rgw_account", target, resolved.portal_role, portalSources);
    addRight(rows, user, "rgw_account", target, "manager_browser_data_access", browserSources);
  }
}

function demoS3Users(state: DemoState) {
  return state.accounts.flatMap(account => (state.iam[account.id]?.users ?? []).map((rgwUser, index) => ({
    id: account.id * 100 + index,
    name: rgwUser.name,
    rgw_user_uid: rgwUser.name,
    storage_endpoint_id: account.storage_endpoint_id,
    storage_endpoint_name: account.storage_endpoint_name,
  })));
}

function addS3UserRows(rows: Map<string, AccessAuditRow>, state: DemoState, user: User, groups: UiGroup[]): void {
  for (const rgwUser of demoS3Users(state)) {
    const direct = user.s3_user_links?.find(link => link.s3_user_id === rgwUser.id);
    const inherited = groups.flatMap(group => (group.s3_user_links ?? [])
      .filter(link => link.s3_user_id === rgwUser.id)
      .map(link => ({ group, link })));
    const accessSources = [
      ...(direct ? [directSource()] : []),
      ...inherited.map(({ group }) => groupSource(group)),
    ];
    const browserSources = [
      ...(direct?.allow_manager_browser_data_access ? [directSource()] : []),
      ...inherited.filter(({ link }) => link.allow_manager_browser_data_access).map(({ group }) => groupSource(group)),
    ];
    const target = { id: rgwUser.id, name: rgwUser.name, identifier: rgwUser.rgw_user_uid };
    addRight(rows, user, "rgw_user", target, "rgw_user_access", accessSources);
    addRight(rows, user, "rgw_user", target, "manager_browser_data_access", browserSources);
  }
}

function addConnectionRows(rows: Map<string, AccessAuditRow>, state: DemoState, user: User, groups: UiGroup[]): void {
  for (const connection of state.connections.filter(candidate => candidate.is_shared !== false)) {
    const sources = [
      ...(connection.user_details?.some(member => member.id === user.id) ? [directSource()] : []),
      ...groups
        .filter(group => connection.group_details?.some(candidate => candidate.id === group.id))
        .map(groupSource),
    ];
    addRight(rows, user, "s3_connection", { id: connection.id, name: connection.name }, "shared_connection_access", sources);
  }
}

export function buildDemoAccessAuditRows(state: DemoState): AccessAuditRow[] {
  const rows = new Map<string, AccessAuditRow>();
  for (const user of state.users) {
    const groups = groupsForUser(state, user.id);
    addPlatformRows(rows, user, groups);
    addAccountRows(rows, state, user);
    addS3UserRows(rows, state, user, groups);
    addConnectionRows(rows, state, user, groups);
  }
  return [...rows.values()];
}

export function listDemoS3Users(state: DemoState) {
  return demoS3Users(state).map(rgwUser => ({
    ...rgwUser,
    tags: [],
    user_links: state.users.flatMap(user => (user.s3_user_links ?? [])
      .filter(link => link.s3_user_id === rgwUser.id)
      .map(link => ({
        user_id: user.id,
        user_email: user.email,
        user_full_name: user.full_name,
        allow_manager_browser_data_access: link.allow_manager_browser_data_access,
      }))),
    group_links: state.groups.flatMap(group => (group.s3_user_links ?? [])
      .filter(link => link.s3_user_id === rgwUser.id)
      .map(link => ({
        group_id: group.id,
        group_name: group.name,
        allow_manager_browser_data_access: link.allow_manager_browser_data_access,
      }))),
  }));
}
