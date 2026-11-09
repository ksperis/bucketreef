/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import type { QuotaSizeUnit } from "../../utils/quotaUnits";

export type AdminRgwCreateForm = {
  name: string;
  rgw_tenant: string;
  email: string;
  tags: UiTagDefinition[];
  quota_max_size_gb: string;
  quota_max_size_unit: QuotaSizeUnit;
  quota_max_objects: string;
  storage_endpoint_id: string;
};

type AdminRgwUserCreateForm = AdminRgwCreateForm & {
  uid: string;
};

export function emptyAdminRgwCreateForm(storageEndpointId = ""): AdminRgwCreateForm {
  return {
    name: "",
    rgw_tenant: "",
    email: "",
    tags: [],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    storage_endpoint_id: storageEndpointId,
  };
}

export function emptyAdminRgwUserCreateForm(storageEndpointId = ""): AdminRgwUserCreateForm {
  return {
    ...emptyAdminRgwCreateForm(storageEndpointId),
    uid: "",
  };
}

export function adminRgwCreatePayload(
  form: AdminRgwCreateForm,
  managedTenantCreationEnabled: boolean,
) {
  return {
    name: form.name.trim(),
    rgw_tenant: managedTenantCreationEnabled ? form.rgw_tenant.trim() : "",
    email: form.email.trim() || undefined,
    tags: normalizeUiTags(form.tags),
    quota_max_size_gb: form.quota_max_size_gb ? Number(form.quota_max_size_gb) : undefined,
    quota_max_size_unit: form.quota_max_size_gb ? form.quota_max_size_unit : undefined,
    quota_max_objects: form.quota_max_objects ? Number(form.quota_max_objects) : undefined,
    storage_endpoint_id: Number(form.storage_endpoint_id),
  };
}

export function adminRgwUserCreatePayload(
  form: AdminRgwUserCreateForm,
  managedTenantCreationEnabled: boolean,
) {
  return {
    ...adminRgwCreatePayload(form, managedTenantCreationEnabled),
    uid: form.uid.trim() || undefined,
  };
}
