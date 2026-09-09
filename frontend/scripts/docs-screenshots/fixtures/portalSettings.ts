import { buildBaseRules } from "./base";
import type { MockRule } from "../types";
import type { PortalProjectSettings } from "../../../src/api/portalAccounts";

/** UI fixtures only: these scenarios do not exercise a real RGW endpoint. */
export function buildPortalSettingsRules(): MockRule[] {
  const rules = buildBaseRules();
  const project = rules.find((rule) => rule.id === "portal-project-settings")!.body as PortalProjectSettings;
  const account = {
    id: 101, name: "Research project", rgw_account_id: "RGW000000000000101", storage_endpoint_id: 11,
    storage_endpoint_name: "Research storage", storage_endpoint_url: "https://storage.example.test",
    user_links: [], group_links: [], tags: [], allow_bucket_quota_management: false,
  };
  return [
    { id: "coherence-pending-counts", path: /^\/admin\/navigation\/pending-requests$/, body: { identity_link_requests: 0, portal_requests: 0 } },
    { id: "coherence-accounts", path: /^\/admin\/accounts$/, body: { items: [account], total: 1, page: 1, page_size: 25, has_next: false } },
    { id: "coherence-account", path: /^\/admin\/accounts\/101$/, body: account },
    { id: "coherence-account-settings", path: /^\/admin\/accounts\/101\/portal-settings$/, body: { effective: project.effective, admin_override: { browser_access_enabled: true }, delegated_to_portal_managers: true } },
    { id: "coherence-account-stats", path: /^\/admin\/stats\/account$/, body: { used_bytes: 0, used_objects: 0, bucket_count: 0 } },
    { id: "coherence-groups", path: /^\/admin\/groups\/minimal$/, body: [] },
    { id: "coherence-tags", path: /^\/admin\/tag-definitions$/, body: { items: [] } },
    { id: "coherence-endpoint", path: /^\/admin\/storage-endpoints\/11$/, body: { id: 11, name: "Research storage", provider: "ceph", is_default: true, capabilities: { account: true, admin: true }, admin_ops_permissions: { buckets_write: true, accounts_write: true } } },
    ...rules.map((rule): MockRule => {
      if (rule.id === "portal-storage-space-settings") return { ...rule, body: { ...(rule.body as object), can_update: true } };
      if (rule.id === "portal-state") return { ...rule, body: { ...(rule.body as object), portal_role: "portal_manager" } };
      if (rule.id === "portal-accounts") return { ...rule, body: (rule.body as Record<string, unknown>[]).map((account) => ({ ...account, portal_role: "portal_manager" })) };
      if (rule.id === "portal-storage-spaces") return { ...rule, body: (context) => {
        const spaces = (typeof rule.body === "function" ? rule.body(context) : rule.body) as Record<string, unknown>[];
        return spaces.map((space) => ({ ...space, role: "Manager", name_editable: true }));
      } };
      return rule;
    }),
  ];
}
