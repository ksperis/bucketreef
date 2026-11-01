import type { PortalStorageSpaceSummary } from "../api/portal";
import type { PortalAccount, PortalState } from "../api/portalAccounts";
import type { PortalPublicLink } from "../api/portalSharing";
import type { ManagerTrafficStats } from "../api/stats";
import type { PortalWorkspaceSpace } from "../features/portal/portalWorkspaceModel";

export function buildPortalAccount(
  id = 101,
  overrides: Partial<PortalAccount> = {},
): PortalAccount {
  return {
    id,
    name: `Account ${id}`,
    rgw_account_id: `RGW${id}`,
    portal_role: "portal_user",
    storage_endpoint_name: "Primary storage",
    storage_endpoint_url: "https://s3.example.test",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: {},
    ...overrides,
  };
}

export function buildPortalState(
  overrides: Partial<PortalState> = {},
): PortalState {
  return {
    portal_role: null,
    can_manage_buckets: false,
    can_create_private_storage_spaces: false,
    can_create_team_storage_spaces: false,
    can_create_external_sharing: false,
    can_manage_portal_users: false,
    portal_collaborator_role_management_delegated: false,
    portal_collaborator_addition_delegated: false,
    allow_named_bucket_create: false,
    server_access_logging_enabled: false,
    storage_space_version_cleanup_enabled: false,
    bucket_usage_stats_enabled: false,
    cost_estimation_enabled: false,
    ...overrides,
  };
}

export function buildPortalStorageSpaceSummary(
  id = "research-data",
  overrides: Partial<PortalStorageSpaceSummary> = {},
): PortalStorageSpaceSummary {
  return {
    id,
    name: "Research Data",
    role: "Owner",
    can_browse: true,
    can_delete: true,
    can_take_ownership: false,
    status: "Active",
    description: null,
    owner_label: null,
    owner_user_id: null,
    collaborators: [],
    collaborator_count: 0,
    visibility: "private",
    share_scope: "restricted",
    account_member_role: null,
    project_key: null,
    dataset_label: null,
    region: null,
    created_at: null,
    used_bytes: null,
    object_count: null,
    quota_max_size_bytes: null,
    quota_max_objects: null,
    internal_bucket_name: id,
    archived_at: null,
    origin: "portal_generic",
    name_editable: true,
    icon: {
      source: "preset",
      preset: "bucket",
      url: null,
      updated_at: null,
    },
    ...overrides,
  };
}

export function buildPortalWorkspaceSpace(
  id = "research-data",
  overrides: Partial<PortalWorkspaceSpace> = {},
): PortalWorkspaceSpace {
  return {
    id,
    name: "Research Data",
    internalName: id,
    origin: "portal_generic",
    nameEditable: true,
    description: "Research Data storage space",
    ownerLabel: null,
    ownerUserId: null,
    collaborators: [],
    collaboratorCount: 0,
    visibility: "private",
    shareScope: "restricted",
    accountMemberRole: null,
    projectKey: null,
    datasetLabel: null,
    role: "Owner",
    canBrowse: true,
    canDelete: true,
    canTakeOwnership: false,
    status: "Active",
    access: "Private",
    region: null,
    createdLabel: "",
    usedBytes: null,
    quotaBytes: null,
    quotaObjects: null,
    objectCount: null,
    createdAt: null,
    archivedAt: null,
    shareCount: null,
    icon: {
      source: "preset",
      preset: "bucket",
      url: null,
      updated_at: null,
    },
    ...overrides,
  };
}

export function buildPortalPublicLink(
  overrides: Partial<PortalPublicLink> = {},
): PortalPublicLink {
  return {
    id: 1,
    storage_space_id: "research-data",
    storage_space_name: "Research Data",
    object_key: "reports/report.csv",
    object_name: "report.csv",
    url: "https://storage.example.test/public-links/example",
    label: null,
    created_by_email: null,
    created_at: "2026-09-10T10:00:00Z",
    expires_at: null,
    revoked_at: null,
    status: "Active",
    ...overrides,
  };
}

export function buildPortalTrafficStats(
  overrides: Partial<ManagerTrafficStats> = {},
): ManagerTrafficStats {
  return {
    window: "day",
    start: "2026-06-10T00:00:00Z",
    end: "2026-06-10T23:59:59Z",
    resolution: "day",
    bucket_filter: null,
    data_points: 0,
    series: [],
    totals: {
      bytes_in: 0,
      bytes_out: 0,
      ops: 0,
      success_ops: 0,
      success_rate: null,
    },
    bucket_rankings: [],
    user_rankings: [],
    request_breakdown: [],
    category_breakdown: [],
    ...overrides,
  };
}
