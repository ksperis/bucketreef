/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type {
  S3User,
  S3UserGroupLinkInput,
  S3UserUserLinkInput,
  UpdateS3UserPayload,
} from "../../api/s3Users";
import { normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import { buildAdminQuotaSizeEditorValue } from "./adminQuotaForm";

export function emptyAdminS3UserForm() {
  return {
    name: "",
    email: "",
    tags: [] as UiTagDefinition[],
    user_links: [] as S3UserUserLinkInput[],
    group_links: [] as S3UserGroupLinkInput[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    allow_bucket_quota_management: null as boolean | null,
    allow_access_key_management: null as boolean | null,
    allow_access_key_metadata: null as boolean | null,
    allow_access_key_expiration: null as boolean | null,
    allow_activity_history: null as boolean | null,
    allow_rgw_usage_metrics: null as boolean | null,
    allow_cost_estimation: null as boolean | null,
    allow_bucket_usage_stats: null as boolean | null,
    allow_bucket_usage_stats_collection: null as boolean | null,
    allow_multisite_endpoint_switching: null as boolean | null,
    allow_managed_private_connection_provisioning: null as boolean | null,
  };
}

type AdminS3UserForm = ReturnType<typeof emptyAdminS3UserForm>;

export function adminS3UserForm(user: S3User): AdminS3UserForm {
  const quota = buildAdminQuotaSizeEditorValue(user.quota_max_size_gb);
  return {
    name: user.name,
    email: user.email ?? "",
    tags: normalizeUiTags(user.tags),
    user_links: user.user_links.map<S3UserUserLinkInput>((link) => ({
      user_id: link.user_id,
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    })),
    group_links: user.group_links.map<S3UserGroupLinkInput>((link) => ({
      group_id: link.group_id,
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    })),
    quota_max_size_gb: quota.value,
    quota_max_size_unit: quota.unit,
    quota_max_objects: user.quota_max_objects == null ? "" : String(user.quota_max_objects),
    allow_bucket_quota_management: user.allow_bucket_quota_management,
    allow_access_key_management: user.allow_access_key_management,
    allow_access_key_metadata: user.allow_access_key_metadata,
    allow_access_key_expiration: user.allow_access_key_expiration,
    allow_activity_history: user.allow_activity_history,
    allow_rgw_usage_metrics: user.allow_rgw_usage_metrics,
    allow_cost_estimation: user.allow_cost_estimation,
    allow_bucket_usage_stats: user.allow_bucket_usage_stats,
    allow_bucket_usage_stats_collection: user.allow_bucket_usage_stats_collection,
    allow_multisite_endpoint_switching: user.allow_multisite_endpoint_switching,
    allow_managed_private_connection_provisioning: user.allow_managed_private_connection_provisioning,
  };
}

export function adminS3UserPayload(
  form: AdminS3UserForm,
  allowQuotaUpdates: boolean,
  canManageManagerFeatures: boolean,
): UpdateS3UserPayload {
  return {
    name: form.name || undefined,
    email: form.email || undefined,
    tags: normalizeUiTags(form.tags),
    user_links: form.user_links.map((link) => ({ ...link })),
    group_links: form.group_links.map((link) => ({ ...link })),
    allow_bucket_usage_stats: form.allow_bucket_usage_stats,
    allow_bucket_usage_stats_collection: form.allow_bucket_usage_stats_collection,
    ...(canManageManagerFeatures ? {
      allow_bucket_quota_management: form.allow_bucket_quota_management,
      allow_access_key_management: form.allow_access_key_management,
      allow_access_key_metadata: form.allow_access_key_metadata,
      allow_access_key_expiration: form.allow_access_key_expiration,
      allow_activity_history: form.allow_activity_history,
      allow_rgw_usage_metrics: form.allow_rgw_usage_metrics,
      allow_cost_estimation: form.allow_cost_estimation,
      allow_multisite_endpoint_switching: form.allow_multisite_endpoint_switching,
      allow_managed_private_connection_provisioning: form.allow_managed_private_connection_provisioning,
    } : {}),
    ...(allowQuotaUpdates ? {
      quota_max_size_gb: form.quota_max_size_gb !== "" ? Number(form.quota_max_size_gb) : null,
      quota_max_size_unit: form.quota_max_size_gb !== "" ? form.quota_max_size_unit : null,
      quota_max_objects: form.quota_max_objects !== "" ? Number(form.quota_max_objects) : null,
    } : {}),
  };
}
