import type {
  BucketLoggingConfiguration,
  BucketObjectLockConfiguration,
  BucketProperties,
  BucketPublicAccessBlock,
} from "../api/bucketContracts";

export function buildBucketObjectLockConfiguration(
  overrides: Partial<BucketObjectLockConfiguration> = {},
): BucketObjectLockConfiguration {
  return {
    enabled: false,
    mode: null,
    days: null,
    years: null,
    ...overrides,
  };
}

export function buildBucketProperties(
  overrides: Partial<BucketProperties> = {},
): BucketProperties {
  return {
    lifecycle_rules: [],
    ...overrides,
  };
}

export function buildBucketLoggingConfiguration(
  overrides: Partial<BucketLoggingConfiguration> = {},
): BucketLoggingConfiguration {
  return {
    enabled: false,
    target_bucket: null,
    target_prefix: null,
    ...overrides,
  };
}

export function buildBucketPublicAccessBlock(
  overrides: Partial<BucketPublicAccessBlock> = {},
): BucketPublicAccessBlock {
  return {
    block_public_acls: false,
    ignore_public_acls: false,
    block_public_policy: false,
    restrict_public_buckets: false,
    ...overrides,
  };
}
