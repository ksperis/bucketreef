import type { CephAdminRgwAccount } from "../api/cephAdminAccounts";
import type { CephAdminBucket } from "../api/cephAdminBuckets";
import type { CephAdminRgwUser } from "../api/cephAdminUsers";
import type { StorageOpsBucket } from "../api/storageOps";

export function buildCephAdminAccount(
  accountId = "RGW12345678901234567",
  overrides: Partial<CephAdminRgwAccount> = {},
): CephAdminRgwAccount {
  return {
    account_id: accountId,
    tenant: null,
    account_name: null,
    email: null,
    max_users: null,
    max_buckets: null,
    quota_max_size_bytes: null,
    quota_max_objects: null,
    used_bytes: null,
    object_count: null,
    bucket_count: null,
    user_count: null,
    ...overrides,
  };
}

export function buildCephAdminUser(
  uid = "alice",
  overrides: Partial<CephAdminRgwUser> = {},
): CephAdminRgwUser {
  return {
    uid,
    tenant: null,
    account_id: null,
    account_name: null,
    full_name: null,
    email: null,
    suspended: null,
    max_buckets: null,
    quota_max_size_bytes: null,
    quota_max_objects: null,
    ...overrides,
  };
}

export function buildCephAdminBucket(
  name = "bucket-a",
  overrides: Partial<CephAdminBucket> = {},
): CephAdminBucket {
  return {
    name,
    tenant: null,
    owner: null,
    owner_name: null,
    owner_suspended: null,
    used_bytes: null,
    object_count: null,
    quota_max_size_bytes: null,
    quota_max_objects: null,
    owner_used_bytes: null,
    owner_object_count: null,
    owner_quota_max_size_bytes: null,
    owner_quota_max_objects: null,
    tags: null,
    features: null,
    column_details: null,
    ui_tags: [],
    ...overrides,
  };
}

export function buildStorageOpsBucket(
  name = "account-1::bucket-a",
  overrides: Partial<StorageOpsBucket> = {},
): StorageOpsBucket {
  const [contextId = "account-1", bucketName = name] = name.split("::", 2);
  return {
    ...buildCephAdminBucket(name),
    context_id: contextId,
    context_name: contextId,
    context_kind: "account",
    bucket_name: bucketName,
    bucket_identity: bucketName,
    ...overrides,
  };
}
