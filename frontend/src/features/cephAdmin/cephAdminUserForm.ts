/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { parseOptionalNonNegativeInteger, validateCephAdminQuotaForm, type CephAdminQuotaUnit } from "./quotaForm";
import type { CephAdminRgwUserCapsUpdate } from "../../api/cephAdminUsers";

export type CephAdminUserCapsMode = NonNullable<CephAdminRgwUserCapsUpdate["mode"]>;
type CephAdminUserFieldErrors = Partial<Record<"maxBuckets" | "quotaSize" | "quotaObjects", string>>;

export function parseCephAdminUserCaps(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean))];
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
