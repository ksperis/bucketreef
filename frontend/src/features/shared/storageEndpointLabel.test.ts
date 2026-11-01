import { describe, expect, it } from "vitest";

import type { S3Account } from "../../api/accounts";
import type { ExecutionContext } from "../../api/executionContexts";
import { buildExecutionContext } from "../../test/executionContexts";
import { formatAccountLabel } from "./storageEndpointLabel";

const capabilities = {
  can_manage_iam: true,
  sts_capable: true,
  admin_api_capable: true,
};

function executionContext(
  overrides: Partial<ExecutionContext>,
): ExecutionContext {
  return buildExecutionContext("1", {
    display_name: "Primary",
    endpoint_name: "Default endpoint",
    endpoint_is_default: true,
    endpoint_url: "https://s3.example.test",
    capabilities,
    ...overrides,
  });
}

function account(overrides: Partial<S3Account>): S3Account {
  return {
    id: 1,
    name: "Primary",
    tags: [],
    quota_max_size_gb: null,
    quota_max_objects: null,
    rgw_account_id: "RGW-PRIMARY",
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
    storage_endpoint_id: 1,
    storage_endpoint_name: "Default endpoint",
    storage_endpoint_url: "https://s3.example.test",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: {},
    allow_bucket_quota_management: null,
    allow_access_key_metadata: null,
    allow_access_key_expiration: null,
    allow_activity_history: null,
    allow_rgw_usage_metrics: null,
    allow_cost_estimation: null,
    allow_bucket_usage_stats: null,
    allow_bucket_usage_stats_collection: null,
    allow_multisite_endpoint_switching: null,
    ...overrides,
  };
}

describe("formatAccountLabel", () => {
  it("uses explicit endpoint metadata", () => {
    expect(
      formatAccountLabel(
        executionContext({
          endpoint_id: 1,
          endpoint_name: "Default endpoint",
          endpoint_is_default: true,
        }),
      ),
    ).toBe("Primary");
    expect(
      formatAccountLabel(
        executionContext({
          endpoint_id: 2,
          endpoint_name: "Archive",
          endpoint_is_default: false,
        }),
      ),
    ).toBe("Primary (Archive)");
  });

  it("uses canonical context kinds instead of ID prefixes", () => {
    expect(
      formatAccountLabel(
        executionContext({
          kind: "account",
          id: "conn-misleading",
          endpoint_is_default: true,
        }),
      ),
    ).toBe("Primary");
    expect(
      formatAccountLabel(
        executionContext({
          kind: "s3_user",
          id: "conn-misleading",
          endpoint_id: 2,
          endpoint_name: "Ceph",
          endpoint_is_default: false,
        }),
      ),
    ).toBe("Primary · S3 user (Ceph)");
  });

  it("formats a stored account with its endpoint metadata", () => {
    expect(
      formatAccountLabel(
        account({
          id: 2,
          storage_endpoint_id: 2,
          storage_endpoint_name: "Ceph",
          storage_endpoint_is_default: false,
        }),
      ),
    ).toBe("Primary (Ceph)");
  });
});
