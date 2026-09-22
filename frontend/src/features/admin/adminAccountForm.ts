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
    allow_bucket_quota_management: Boolean(account.allow_bucket_quota_management),
    user_links: account.user_links.map<AccountUserLink>(link => ({ ...link, allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access) })),
    group_links: account.group_links.map<AccountGroupLink>(link => ({ ...link, allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access) })),
  };
}

export type AdminAccountForm = ReturnType<typeof adminAccountForm>;

export function accountQuotaChanged(draft: AdminAccountForm, baseline: AdminAccountForm) {
  return draft.quota_max_size_gb !== baseline.quota_max_size_gb
    || draft.quota_max_size_unit !== baseline.quota_max_size_unit
    || draft.quota_max_objects !== baseline.quota_max_objects;
}

/** Quota fields are one RGW operation: omit unchanged quotas, retain explicit clears. */
export function adminAccountPayload(draft: AdminAccountForm, baseline: AdminAccountForm, allowQuotaUpdates: boolean, canManagePrivilegedTargets: boolean): Parameters<typeof updateS3Account>[1] {
  return {
    tags: normalizeUiTags(draft.tags),
    user_links: draft.user_links,
    group_links: draft.group_links,
    ...(canManagePrivilegedTargets ? { allow_bucket_quota_management: draft.allow_bucket_quota_management } : {}),
    ...(allowQuotaUpdates && accountQuotaChanged(draft, baseline) ? {
      quota_max_size_gb: draft.quota_max_size_gb !== "" ? Number(draft.quota_max_size_gb) : null,
      quota_max_size_unit: draft.quota_max_size_gb !== "" ? draft.quota_max_size_unit : null,
      quota_max_objects: draft.quota_max_objects !== "" ? Number(draft.quota_max_objects) : null,
    } : {}),
  };
}
