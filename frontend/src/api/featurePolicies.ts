/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { AppSettings, GeneralSettings, PortalConfiguration, PortalSettings, PortalSettingsOverride } from "./appSettings";

export type FeaturePolicy = "disabled" | "targeted" | "default_on";
export type FeatureState = { enabled: boolean; source: "platform" | "resource" | "direct" | "group"; blocked_reason?: string | null };
export type ManagerFeaturePolicies = {
  activity_history: FeaturePolicy;
  bucket_compare: FeaturePolicy;
  bucket_integrity_check: FeaturePolicy;
  bucket_migration: FeaturePolicy;
  bucket_purge: FeaturePolicy;
  feature_rules: FeaturePolicy;
  bucket_quota_management: FeaturePolicy;
  ceph_s3_user_keys: FeaturePolicy;
  access_key_metadata: FeaturePolicy;
  access_key_expiration: FeaturePolicy;
  managed_private_connection_provisioning: FeaturePolicy;
};
export const DEFAULT_MANAGER_FEATURE_POLICIES: ManagerFeaturePolicies = {
  activity_history: "default_on",
  bucket_compare: "targeted",
  bucket_integrity_check: "targeted",
  bucket_migration: "disabled",
  bucket_purge: "disabled",
  feature_rules: "targeted",
  bucket_quota_management: "disabled",
  ceph_s3_user_keys: "targeted",
  access_key_metadata: "targeted",
  access_key_expiration: "targeted",
  managed_private_connection_provisioning: "disabled",
};

export type PortalFeaturePolicies = {
  browser_access: FeaturePolicy;
  private_storage_space_create: FeaturePolicy;
  named_bucket_create: FeaturePolicy;
  user_access_key_create: FeaturePolicy;
  user_external_sharing: FeaturePolicy;
  server_access_logging: FeaturePolicy;
  storage_space_version_cleanup: FeaturePolicy;
};
export const DEFAULT_PORTAL_FEATURE_POLICIES: PortalFeaturePolicies = {
  browser_access: "default_on",
  private_storage_space_create: "default_on",
  named_bucket_create: "targeted",
  user_access_key_create: "default_on",
  user_external_sharing: "targeted",
  server_access_logging: "default_on",
  storage_space_version_cleanup: "default_on",
};

export function projectGeneralSettings(settings: AppSettings): GeneralSettings {
  const policies = settings.manager.feature_policies;
  return { ...settings.general, manager_feature_policies: policies,
    bucket_compare_enabled: policies.bucket_compare !== "disabled",
    bucket_integrity_check_enabled: policies.bucket_integrity_check !== "disabled",
    bucket_migration_enabled: policies.bucket_migration !== "disabled",
    bucket_purge_enabled: policies.bucket_purge !== "disabled",
    bucket_quota_management_enabled: policies.bucket_quota_management !== "disabled",
    manager_ceph_s3_user_keys_enabled: policies.ceph_s3_user_keys !== "disabled",
    manager_access_key_metadata_enabled: policies.access_key_metadata !== "disabled",
    manager_access_key_expiration_enabled: policies.access_key_expiration !== "disabled",
    managed_private_connection_provisioning_enabled: policies.managed_private_connection_provisioning !== "disabled",
  };
}

export function resolvePortalSettings(configuration: PortalConfiguration, override: PortalSettingsOverride = {}): PortalSettings {
  const fields = {
    browser_access_enabled: "browser_access", allow_private_storage_space_create: "private_storage_space_create",
    allow_portal_named_bucket_create: "named_bucket_create", allow_portal_user_access_key_create: "user_access_key_create",
    allow_portal_user_external_sharing: "user_external_sharing", server_access_logging_enabled: "server_access_logging",
    storage_space_version_cleanup_enabled: "storage_space_version_cleanup",
  } as const;
  const flags = Object.fromEntries(Object.entries(fields).map(([field, feature]) => {
    const policy = configuration.feature_policies[feature];
    return [field, policy !== "disabled" && (override[field as keyof typeof fields] ?? policy === "default_on")];
  })) as Pick<PortalSettings, keyof typeof fields>;
  return { ...configuration, ...flags, bucket_defaults: { ...configuration.bucket_defaults,
    ...Object.fromEntries(Object.entries(override.bucket_defaults ?? {}).filter(([, value]) => value != null)) } };
}
