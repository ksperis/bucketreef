import type { ManagerContext } from "../api/managerContext";

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
