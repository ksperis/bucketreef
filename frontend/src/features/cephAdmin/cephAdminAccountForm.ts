/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { parseOptionalNonNegativeInteger, validateCephAdminQuotaForm, type CephAdminQuotaFormValues } from "./quotaForm";

export const ACCOUNT_LIMIT_FIELDS = [
  ["maxBuckets", "Max buckets"],
  ["maxUsers", "Max users"],
  ["maxRoles", "Max roles"],
  ["maxGroups", "Max groups"],
  ["maxAccessKeys", "Max access keys"],
] as const;

export type CephAdminAccountProfileValues = Record<"accountName" | "email" | (typeof ACCOUNT_LIMIT_FIELDS)[number][0], string>;
export type CephAdminAccountProfileErrors = Partial<Record<keyof CephAdminAccountProfileValues, string>>;

export function validateCephAdminAccountForm(
  profile: CephAdminAccountProfileValues,
  accountQuota: CephAdminQuotaFormValues,
  bucketQuota: CephAdminQuotaFormValues,
  requireName = false,
) {
  const profileErrors: CephAdminAccountProfileErrors = {};
  if (requireName && !profile.accountName.trim()) profileErrors.accountName = "Account name is required.";
  for (const [field, label] of ACCOUNT_LIMIT_FIELDS) {
    if (profile[field].trim() && parseOptionalNonNegativeInteger(profile[field]) == null) {
      profileErrors[field] = `${label} must be a non-negative integer.`;
    }
  }
  const errors = { profile: profileErrors, accountQuota: validateCephAdminQuotaForm(accountQuota), bucketQuota: validateCephAdminQuotaForm(bucketQuota) };
  return { ...errors, invalid: Object.values(errors).some((fields) => Object.keys(fields).length > 0) };
}

export function parseCephAdminAccountLimits(values: CephAdminAccountProfileValues) {
  return {
    max_buckets: parseOptionalNonNegativeInteger(values.maxBuckets),
    max_users: parseOptionalNonNegativeInteger(values.maxUsers),
    max_roles: parseOptionalNonNegativeInteger(values.maxRoles),
    max_groups: parseOptionalNonNegativeInteger(values.maxGroups),
    max_access_keys: parseOptionalNonNegativeInteger(values.maxAccessKeys),
  };
}
