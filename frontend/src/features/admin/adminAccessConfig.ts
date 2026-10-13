import type { ManagerFeaturePolicies } from "../../api/appSettings";
import type { ManagerToolAccess } from "../../api/users";

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
  manager_feature_policies?: ManagerFeaturePolicies;
  bucket_compare_enabled?: boolean | null;
  bucket_integrity_check_enabled?: boolean | null;
  bucket_migration_enabled?: boolean | null;
  bucket_purge_enabled?: boolean | null;
}): ManagerToolDefinition[] {
  return [
    {
      key: "bucket_compare",
      title: "Bucket compare",
      description: "Allow access to Manager > Tools > Compare.",
      enabled: Boolean(settings.bucket_compare_enabled),
      platformDefault: settings.manager_feature_policies?.bucket_compare === "default_on",
    },
    {
      key: "bucket_integrity_check",
      title: "Bucket integrity check",
      description: "Allow access to Manager > Tools > Integrity.",
      enabled: Boolean(settings.bucket_integrity_check_enabled),
      platformDefault: settings.manager_feature_policies?.bucket_integrity_check === "default_on",
    },
    {
      key: "bucket_migration",
      title: "Bucket migration",
      description: "Allow access to Manager > Tools > Migration.",
      enabled: Boolean(settings.bucket_migration_enabled),
      platformDefault: settings.manager_feature_policies?.bucket_migration === "default_on",
    },
    {
      key: "bucket_purge",
      title: "Bucket purge",
      description: "Allow access to Manager > Tools > Purge.",
      enabled: Boolean(settings.bucket_purge_enabled),
      platformDefault: settings.manager_feature_policies?.bucket_purge === "default_on",
    },
    {
      key: "feature_rules",
      title: "Feature rule inventory",
      description: "Allow access to Manager > Tools > Feature rules.",
      enabled: settings.manager_feature_policies?.feature_rules !== "disabled",
      platformDefault: settings.manager_feature_policies?.feature_rules === "default_on",
    },
  ];
}
