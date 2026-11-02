/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import {
  parseOptionalNonNegativeInteger,
  quotaBytesToForm,
  validateCephAdminQuotaForm,
  type CephAdminQuotaFormValues,
  type CephAdminQuotaUnit,
} from "./quotaForm";
import type { CephAdminRgwUserCapsUpdate, CephAdminRgwUserDetail } from "../../api/cephAdminUsers";

export type CephAdminUserCapsMode = NonNullable<CephAdminRgwUserCapsUpdate["mode"]>;
type CephAdminUserFieldErrors = Partial<Record<"maxBuckets" | "quotaSize" | "quotaObjects", string>>;
export type CephAdminUserDraft = {
  profile: {
    displayName: string;
    email: string;
    maxBuckets: string;
    opMask: string;
    defaultPlacement: string;
    defaultStorageClass: string;
  };
  flags: {
    suspended: boolean;
    admin: boolean;
    system: boolean;
  };
  quota: CephAdminQuotaFormValues;
  caps: {
    mode: CephAdminUserCapsMode;
    text: string;
  };
};

export function createEmptyCephAdminUserDraft(quotaEnabled = false): CephAdminUserDraft {
  return {
    profile: {
      displayName: "",
      email: "",
      maxBuckets: "",
      opMask: "",
      defaultPlacement: "",
      defaultStorageClass: "",
    },
    flags: { suspended: false, admin: false, system: false },
    quota: { enabled: quotaEnabled, size: "", unit: "GiB", objects: "" },
    caps: { mode: "replace", text: "" },
  };
}

export function cephAdminUserDraftFromDetail(detail: CephAdminRgwUserDetail): CephAdminUserDraft {
  const quotaConfigured = Boolean(
    detail.quota && (detail.quota.max_size_bytes != null || detail.quota.max_objects != null)
  );
  const quotaForm = quotaBytesToForm(detail.quota?.max_size_bytes);
  return {
    profile: {
      displayName: detail.display_name ?? "",
      email: detail.email ?? "",
      maxBuckets: detail.max_buckets != null ? String(detail.max_buckets) : "",
      opMask: detail.op_mask ?? "",
      defaultPlacement: detail.default_placement ?? "",
      defaultStorageClass: detail.default_storage_class ?? "",
    },
    flags: {
      suspended: Boolean(detail.suspended),
      admin: Boolean(detail.admin),
      system: Boolean(detail.system),
    },
    quota: {
      enabled: detail.quota?.enabled ?? quotaConfigured,
      size: quotaForm.value,
      unit: quotaForm.unit,
      objects: detail.quota?.max_objects != null ? String(detail.quota.max_objects) : "",
    },
    caps: { mode: "replace", text: detail.caps.join("\n") },
  };
}

export function parseCephAdminUserCaps(value: string): string[] {
  return [...new Set(value.split(/\r?\n|;/).map((entry) => entry.trim()).filter(Boolean))];
}

export function validateCephAdminUserLimits(values: {
  maxBuckets: string;
  quotaEnabled: boolean;
  quotaSize: string;
  quotaUnit: CephAdminQuotaUnit;
  quotaObjects: string;
}): CephAdminUserFieldErrors {
  const errors: CephAdminUserFieldErrors = {};
  if (values.maxBuckets.trim() && parseOptionalNonNegativeInteger(values.maxBuckets) == null) {
    errors.maxBuckets = "Max buckets must be a non-negative integer.";
  }
  const quotaErrors = validateCephAdminQuotaForm({
    enabled: values.quotaEnabled, size: values.quotaSize, unit: values.quotaUnit, objects: values.quotaObjects,
  });
  if (quotaErrors.size) errors.quotaSize = quotaErrors.size;
  if (quotaErrors.objects) errors.quotaObjects = quotaErrors.objects;
  return errors;
}
