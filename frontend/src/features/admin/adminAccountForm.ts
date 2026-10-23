/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { S3Account, AccountUserLink, AccountGroupLink, updateS3Account } from "../../api/accounts";
import { normalizeUiTags } from "../../utils/uiTags";
import { buildAdminQuotaSizeEditorValue } from "./adminQuotaForm";

export function adminAccountForm(account: S3Account) {
  const quota = buildAdminQuotaSizeEditorValue(account.quota_max_size_gb);
  return {
    tags: normalizeUiTags(account.tags),
    quota_max_size_gb: quota.value,
    quota_max_size_unit: quota.unit as string,
    quota_max_objects: account.quota_max_objects == null ? "" : String(account.quota_max_objects),
    allow_bucket_quota_management: account.allow_bucket_quota_management,
    allow_access_key_metadata: account.allow_access_key_metadata,
    allow_access_key_expiration: account.allow_access_key_expiration,
    allow_activity_history: account.allow_activity_history,
    allow_rgw_usage_metrics: account.allow_rgw_usage_metrics,
    allow_cost_estimation: account.allow_cost_estimation,
    allow_bucket_usage_stats: account.allow_bucket_usage_stats,
    allow_bucket_usage_stats_collection: account.allow_bucket_usage_stats_collection,
    user_links: account.user_links.map<AccountUserLink>(link => ({ ...link })),
    group_links: account.group_links.map<AccountGroupLink>(link => ({ ...link })),
  };
}

export type AdminAccountForm = ReturnType<typeof adminAccountForm>;

export function accountQuotaChanged(draft: AdminAccountForm, baseline: AdminAccountForm) {
  return draft.quota_max_size_gb !== baseline.quota_max_size_gb
    || draft.quota_max_size_unit !== baseline.quota_max_size_unit
    || draft.quota_max_objects !== baseline.quota_max_objects;
}

/** Quota fields are one RGW operation: omit unchanged quotas, retain explicit clears. */
export function adminAccountPayload(draft: AdminAccountForm, baseline: AdminAccountForm, allowQuotaUpdates: boolean, canManageManagerFeatures: boolean): Parameters<typeof updateS3Account>[1] {
  return {
    tags: normalizeUiTags(draft.tags),
    user_links: draft.user_links.map(({
      user_id,
      manager_role,
      portal_role,
      allow_manager_browser_data_access,
    }) => ({
      user_id,
      manager_role,
      portal_role,
      allow_manager_browser_data_access,
    })),
    group_links: draft.group_links.map(({
      group_id,
      manager_role,
      portal_role,
      allow_manager_browser_data_access,
    }) => ({
      group_id,
      manager_role,
      portal_role,
      allow_manager_browser_data_access,
    })),
    allow_bucket_usage_stats: draft.allow_bucket_usage_stats,
    allow_bucket_usage_stats_collection: draft.allow_bucket_usage_stats_collection,
    ...(canManageManagerFeatures ? {
      allow_bucket_quota_management: draft.allow_bucket_quota_management,
      allow_access_key_metadata: draft.allow_access_key_metadata,
      allow_access_key_expiration: draft.allow_access_key_expiration,
      allow_activity_history: draft.allow_activity_history,
      allow_rgw_usage_metrics: draft.allow_rgw_usage_metrics,
      allow_cost_estimation: draft.allow_cost_estimation,
    } : {}),
    ...(allowQuotaUpdates && accountQuotaChanged(draft, baseline) ? {
      quota_max_size_gb: draft.quota_max_size_gb !== "" ? Number(draft.quota_max_size_gb) : null,
      quota_max_size_unit: draft.quota_max_size_gb !== "" ? draft.quota_max_size_unit : null,
      quota_max_objects: draft.quota_max_objects !== "" ? Number(draft.quota_max_objects) : null,
    } : {}),
  };
}
