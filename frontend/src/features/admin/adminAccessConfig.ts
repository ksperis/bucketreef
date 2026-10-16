import type { ManagerFeaturePolicies } from "../../api/appSettings";
import { isFeaturePolicyAvailable } from "../../api/featurePolicies";
import type { ManagerToolAccess, UiRole } from "../../api/users";

export type ManagerToolKey = keyof ManagerToolAccess;

export type ManagerToolDefinition = {
  key: ManagerToolKey;
  title: string;
  description: string;
  enabled: boolean;
  platformDefault: boolean;
};

export const DEFAULT_MANAGER_TOOL_ACCESS: ManagerToolAccess = {
  bucket_compare: false,
  bucket_integrity_check: false,
  bucket_migration: false,
  bucket_purge: false,
  feature_rules: false,
};

export function roleSupportsOperationalAccess(role: UiRole): boolean {
  return role !== "ui_none";
}

export function normalizeManagerToolAccess(access?: ManagerToolAccess | null): ManagerToolAccess {
  return {
    bucket_compare: Boolean(access?.bucket_compare),
    bucket_integrity_check: Boolean(access?.bucket_integrity_check),
    bucket_migration: Boolean(access?.bucket_migration),
    bucket_purge: Boolean(access?.bucket_purge),
    feature_rules: Boolean(access?.feature_rules),
  };
}

export function buildManagerToolDefinitions(settings: {
  manager_feature_policies: ManagerFeaturePolicies;
}): ManagerToolDefinition[] {
  const policies = settings.manager_feature_policies;
  return [
    {
      key: "bucket_compare",
      title: "Bucket compare",
      description: "Allow access to Manager > Tools > Compare.",
      enabled: isFeaturePolicyAvailable(policies.bucket_compare),
      platformDefault: policies.bucket_compare === "default_on",
    },
    {
      key: "bucket_integrity_check",
      title: "Bucket integrity check",
      description: "Allow access to Manager > Tools > Integrity.",
      enabled: isFeaturePolicyAvailable(policies.bucket_integrity_check),
      platformDefault: policies.bucket_integrity_check === "default_on",
    },
    {
      key: "bucket_migration",
      title: "Bucket migration",
      description: "Allow access to Manager > Tools > Migration.",
      enabled: isFeaturePolicyAvailable(policies.bucket_migration),
      platformDefault: policies.bucket_migration === "default_on",
    },
    {
      key: "bucket_purge",
      title: "Bucket purge",
      description: "Allow access to Manager > Tools > Purge.",
      enabled: isFeaturePolicyAvailable(policies.bucket_purge),
      platformDefault: policies.bucket_purge === "default_on",
    },
    {
      key: "feature_rules",
      title: "Feature rule inventory",
      description: "Allow access to Manager > Tools > Feature rules.",
      enabled: isFeaturePolicyAvailable(policies.feature_rules),
      platformDefault: policies.feature_rules === "default_on",
    },
  ];
}
