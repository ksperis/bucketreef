import type { StorageEndpoint } from "../api/storageEndpoints";

export type StorageServiceIdentity = StorageEndpoint["service_identities"][number];

export function buildStorageServiceIdentity(
  kind: StorageServiceIdentity["kind"] = "runtime",
  overrides: Partial<StorageServiceIdentity> = {},
): StorageServiceIdentity {
  return {
    kind,
    mode: "managed",
    status: "ready",
    rgw_uid: null,
    credentials_configured: false,
    rotation_pending: false,
    rotation_phase: null,
    last_error: null,
    last_reconciled_at: null,
    ...overrides,
  };
}

export function buildStorageEndpoint(
  id = 1,
  overrides: Partial<StorageEndpoint> = {},
): StorageEndpoint {
  return {
    id,
    name: `Endpoint ${id}`,
    endpoint_url: `https://s3-${id}.example.test`,
    region: null,
    realm_id: null,
    zonegroup_id: null,
    zone_id: null,
    force_path_style: false,
    latitude: null,
    longitude: null,
    verify_tls: true,
    provider: "ceph",
    admin_access_key: null,
    has_admin_secret: false,
    ceph_admin_active: false,
    service_identities: [],
    ceph_admin_allowed: false,
    capabilities: {},
    admin_ops_permissions: {
      users_read: false,
      users_write: false,
      buckets_read: false,
      buckets_write: false,
      accounts_read: false,
      accounts_write: false,
      usage_read: false,
      usage_write: false,
    },
    features: {
      admin: { enabled: false },
      account: { enabled: false },
      sts: { enabled: false },
      usage: { enabled: false },
      metrics: { enabled: false },
      static_website: { enabled: false },
      iam: { enabled: false },
      sns: { enabled: false },
      sse: { enabled: false },
      replication: { enabled: false },
      healthcheck: { enabled: false, mode: "http" },
    },
    is_default: false,
    is_editable: true,
    tags: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
