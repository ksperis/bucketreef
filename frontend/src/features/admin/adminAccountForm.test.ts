import type { S3Account } from "../../api/accounts";
import {
  adminAccountForm,
  adminAccountPayload,
  buildCreateAccountDraft,
  buildImportAccountDraft,
} from "./adminAccountForm";

function makeAccount(overrides: Partial<S3Account> = {}): S3Account {
  return {
    id: 1,
    name: "Account",
    tags: [],
    quota_max_size_gb: null,
    quota_max_objects: null,
    max_buckets: null,
    max_users: null,
    max_roles: null,
    max_groups: null,
    rgw_account_id: "RGW001",
    rgw_tenant: "",
    email: null,
    used_bytes: null,
    used_objects: null,
    user_links: [],
    group_links: [],
    bucket_count: null,
    rgw_user_count: null,
    rgw_user_uids: null,
    rgw_topic_count: null,
    rgw_topics: null,
    storage_endpoint_id: 10,
    storage_endpoint_name: "Ceph",
    storage_endpoint_url: "https://rgw.example.test",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: { admin: true },
    allow_bucket_quota_management: null,
    allow_access_key_metadata: null,
    allow_access_key_expiration: null,
    allow_activity_history: null,
    allow_rgw_usage_metrics: null,
    allow_cost_estimation: null,
    allow_bucket_usage_stats: null,
    allow_bucket_usage_stats_collection: null,
    allow_multisite_endpoint_switching: null,
    allow_manager_browser_data_access_for_all_admins: null,
    ...overrides,
  };
}

describe("adminAccountForm", () => {
  it("normalizes create and import drafts before unsaved-change comparisons", () => {
    const form = {
      name: "Account",
      storage_endpoint_id: "10",
      tags: [
        { label: " Team ", color_key: "sky" as const, scope: "standard" as const },
        { label: "env", color_key: "neutral" as const, scope: "standard" as const },
      ],
    };

    expect(buildCreateAccountDraft(form, "10")).toEqual({
      form: {
        name: "Account",
        storage_endpoint_id: "",
        tags: [
          { id: undefined, label: "env", color_key: "neutral", scope: "standard" },
          { id: undefined, label: "Team", color_key: "sky", scope: "standard" },
        ],
      },
    });
    expect(buildImportAccountDraft("account-a", "10", "10")).toEqual({
      importText: "account-a",
      importTenantEndpointId: "",
    });
  });

  it("projects RGW account limits and emits only changed writable limits", () => {
    const baseline = adminAccountForm(makeAccount({
      max_buckets: 10,
      max_users: 20,
      max_roles: 30,
      max_groups: 40,
    }));
    expect(baseline).toEqual(expect.objectContaining({
      max_buckets: "10",
      max_users: "20",
      max_roles: "30",
      max_groups: "40",
    }));

    const draft = { ...baseline, max_buckets: "12", max_roles: "" };
    expect(adminAccountPayload(draft, baseline, false, true, false)).toEqual(expect.objectContaining({
      max_buckets: 12,
      max_roles: null,
    }));
    expect(adminAccountPayload(draft, baseline, false, true, false)).not.toHaveProperty("max_users");
    expect(adminAccountPayload(draft, baseline, false, true, false)).not.toHaveProperty("max_groups");
    expect(adminAccountPayload(draft, baseline, false, false, false)).not.toHaveProperty("max_buckets");
  });

});
