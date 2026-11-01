import type { ExecutionContext } from "../api/executionContexts";
import type { ManagerContext } from "../api/managerContext";

export function buildExecutionContext(
  id = "context-1",
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    kind: "account",
    id,
    display_name: `Context ${id}`,
    connection_scope: null,
    tags: [],
    endpoint_tags: [],
    manager_role: null,
    portal_role: null,
    rgw_account_id: null,
    endpoint_id: null,
    endpoint_name: "Default endpoint",
    endpoint_is_default: true,
    endpoint_provider: "ceph",
    endpoint_url: "https://s3.example.test",
    storage_endpoint_capabilities: {},
    destination_switching_allowed: false,
    execution_destinations: [],
    capabilities: {
      can_manage_iam: true,
      sts_capable: true,
      admin_api_capable: true,
    },
    ...overrides,
  };
}

export function buildManagerContext(
  overrides: Partial<ManagerContext> = {},
): ManagerContext {
  return {
    feature_states: {},
    naming_validation_profile: "standard",
    access_mode: "admin",
    context_kind: "account",
    iam_identity: null,
    manager_stats_enabled: false,
    manager_stats_message: null,
    manager_browser_enabled: false,
    manager_browser_message: null,
    manager_bucket_quota_enabled: false,
    manager_ceph_keys_enabled: false,
    manager_access_key_metadata_enabled: false,
    manager_access_key_expiration_enabled: false,
    manager_private_access_enabled: false,
    quota_max_size_gb: null,
    quota_max_objects: null,
    max_buckets: null,
    max_users: null,
    max_roles: null,
    max_groups: null,
    ...overrides,
  };
}
