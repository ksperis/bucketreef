import type { FeaturePolicy } from "../api/featurePolicies";
import type { S3Account } from "../api/accounts";
import type { UiGroup } from "../api/groups";
import { resolveDemoAccountGrant } from "./http";
import { demoGroupsForUser, settings, type DemoState, type DemoUser } from "./state";

export type DemoManagerBrowserAccessSource =
  | { kind: "direct" }
  | { kind: "group"; group: UiGroup }
  | { kind: "resource" | "platform" };

export type DemoS3UserResource = {
  id: number;
  name: string;
  rgw_user_uid: string;
  storage_endpoint_id: number;
  storage_endpoint_name: string;
  storage_endpoint_url: string;
  allow_manager_browser_data_access_for_all_admins: boolean | null;
};

export function resolveDemoManagerBrowserAutomaticAccess(
  policy: FeaturePolicy,
  override: boolean | null,
): { enabled: boolean; source: "resource" | "platform" | null } {
  if (policy === "disabled") return { enabled: false, source: null };
  if (override !== null) {
    return { enabled: override, source: override ? "resource" : null };
  }
  return {
    enabled: policy === "default_on",
    source: policy === "default_on" ? "platform" : null,
  };
}

function automaticSource(
  override: boolean | null,
  eligible: boolean,
): DemoManagerBrowserAccessSource[] {
  if (!eligible) return [];
  const automatic = resolveDemoManagerBrowserAutomaticAccess(
    settings.manager.feature_policies.manager_browser_data_access,
    override,
  );
  return automatic.enabled && automatic.source ? [{ kind: automatic.source }] : [];
}

export function resolveDemoAccountManagerBrowserAccess(
  state: DemoState,
  account: S3Account,
  user: DemoUser,
): { allowed: boolean; sources: DemoManagerBrowserAccessSource[] } {
  const resolved = resolveDemoAccountGrant(state, account, user.id);
  const explicit = resolved.sources
    .filter(source => source.link.manager_role === "account_administrator"
      && source.link.allow_manager_browser_data_access)
    .map<DemoManagerBrowserAccessSource>(source => source.kind === "direct"
      ? { kind: "direct" }
      : { kind: "group", group: source.group });
  const automatic = automaticSource(
    account.allow_manager_browser_data_access_for_all_admins,
    resolved.manager_role === "account_administrator",
  );
  const sources = [...explicit, ...automatic];
  return { allowed: sources.length > 0, sources };
}

export function demoS3UserResources(state: DemoState): DemoS3UserResource[] {
  return state.accounts.flatMap(account => (state.iam[account.id]?.users ?? []).map((rgwUser, index) => ({
    id: account.id * 100 + index,
    name: rgwUser.name,
    rgw_user_uid: rgwUser.name,
    storage_endpoint_id: account.storage_endpoint_id,
    storage_endpoint_name: account.storage_endpoint_name,
    storage_endpoint_url: account.storage_endpoint_url,
    allow_manager_browser_data_access_for_all_admins:
      rgwUser.allow_manager_browser_data_access_for_all_admins ?? null,
  })));
}

export function resolveDemoS3UserManagerBrowserAccess(
  state: DemoState,
  rgwUser: DemoS3UserResource,
  user: DemoUser,
): { allowed: boolean; sources: DemoManagerBrowserAccessSource[] } {
  const groups = demoGroupsForUser(state, user.id);
  const direct = user.s3_user_links?.find(link => link.s3_user_id === rgwUser.id);
  const inherited = groups.flatMap(group => group.s3_user_links
    .filter(link => link.s3_user_id === rgwUser.id)
    .map(link => ({ group, link })));
  const explicit: DemoManagerBrowserAccessSource[] = [
    ...(direct?.allow_manager_browser_data_access ? [{ kind: "direct" as const }] : []),
    ...inherited
      .filter(({ link }) => link.allow_manager_browser_data_access)
      .map(({ group }) => ({ kind: "group" as const, group })),
  ];
  const automatic = automaticSource(
    rgwUser.allow_manager_browser_data_access_for_all_admins,
    Boolean(direct || inherited.length),
  );
  const sources = [...explicit, ...automatic];
  return { allowed: sources.length > 0, sources };
}
