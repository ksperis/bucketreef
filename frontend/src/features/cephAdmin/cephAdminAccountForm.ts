/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { CephAdminRgwAccountDetail } from "../../api/cephAdminAccounts";
import {
  parseOptionalNonNegativeInteger,
  quotaBytesToForm,
  validateCephAdminQuotaForm,
  type CephAdminQuotaFormValues,
} from "./quotaForm";
import { rgwAccountNameFormatError } from "../../utils/rgwAccountName";

export const ACCOUNT_LIMIT_FIELDS = [
  ["maxBuckets", "Max buckets"],
  ["maxUsers", "Max users"],
  ["maxRoles", "Max roles"],
  ["maxGroups", "Max groups"],
  ["maxAccessKeys", "Max access keys"],
] as const;

export type CephAdminAccountProfileValues = Record<"accountName" | "email" | (typeof ACCOUNT_LIMIT_FIELDS)[number][0], string>;
export type CephAdminAccountProfileErrors = Partial<Record<keyof CephAdminAccountProfileValues, string>>;
export type CephAdminAccountDraft = {
  profile: CephAdminAccountProfileValues;
  accountQuota: CephAdminQuotaFormValues;
  bucketQuota: CephAdminQuotaFormValues;
};

export function createEmptyCephAdminAccountDraft(quotaEnabled = false): CephAdminAccountDraft {
  return {
    profile: {
      accountName: "",
      email: "",
      maxUsers: "",
      maxBuckets: "",
      maxRoles: "",
      maxGroups: "",
      maxAccessKeys: "",
    },
    accountQuota: { enabled: quotaEnabled, size: "", unit: "GiB", objects: "" },
    bucketQuota: { enabled: quotaEnabled, size: "", unit: "GiB", objects: "" },
  };
}

export function cephAdminAccountDraftFromDetail(detail: CephAdminRgwAccountDetail): CephAdminAccountDraft {
  const quotaConfigured = Boolean(
    detail.quota && (detail.quota.max_size_bytes != null || detail.quota.max_objects != null)
  );
  const quotaForm = quotaBytesToForm(detail.quota?.max_size_bytes);
  const bucketQuotaConfigured = Boolean(
    detail.bucket_quota && (detail.bucket_quota.max_size_bytes != null || detail.bucket_quota.max_objects != null)
  );
  const bucketQuotaForm = quotaBytesToForm(detail.bucket_quota?.max_size_bytes);
  return {
    profile: {
      accountName: detail.account_name ?? "",
      email: detail.email ?? "",
      maxUsers: detail.max_users != null ? String(detail.max_users) : "",
      maxBuckets: detail.max_buckets != null ? String(detail.max_buckets) : "",
      maxRoles: detail.max_roles != null ? String(detail.max_roles) : "",
      maxGroups: detail.max_groups != null ? String(detail.max_groups) : "",
      maxAccessKeys: detail.max_access_keys != null ? String(detail.max_access_keys) : "",
    },
    accountQuota: {
      enabled: detail.quota?.enabled ?? quotaConfigured,
      size: quotaForm.value,
      unit: quotaForm.unit,
      objects: detail.quota?.max_objects != null ? String(detail.quota.max_objects) : "",
    },
    bucketQuota: {
      enabled: detail.bucket_quota?.enabled ?? bucketQuotaConfigured,
      size: bucketQuotaForm.value,
      unit: bucketQuotaForm.unit,
      objects: detail.bucket_quota?.max_objects != null ? String(detail.bucket_quota.max_objects) : "",
    },
  };
}

export function validateCephAdminAccountForm(
  profile: CephAdminAccountProfileValues,
  accountQuota: CephAdminQuotaFormValues,
  bucketQuota: CephAdminQuotaFormValues,
  requireName = false,
) {
  const profileErrors: CephAdminAccountProfileErrors = {};
  if (requireName && !profile.accountName.trim()) profileErrors.accountName = "Account name is required.";
  else if (profile.accountName) {
    const nameFormatError = rgwAccountNameFormatError(profile.accountName);
    if (nameFormatError) profileErrors.accountName = nameFormatError;
  }
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
