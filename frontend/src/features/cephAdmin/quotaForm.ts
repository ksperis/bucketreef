/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { QUOTA_SIZE_UNIT_BYTES, QUOTA_SIZE_UNITS } from "../../utils/quotaUnits";

export const CEPH_ADMIN_QUOTA_UNITS = ["B", ...QUOTA_SIZE_UNITS] as const;
export type CephAdminQuotaUnit = (typeof CEPH_ADMIN_QUOTA_UNITS)[number];

export type CephAdminQuotaFormValues = {
  enabled: boolean;
  size: string;
  unit: CephAdminQuotaUnit;
  objects: string;
};

export function validateCephAdminQuotaForm(values: CephAdminQuotaFormValues): { size?: string; objects?: string } {
  if (!values.enabled) return {};
  return {
    ...(values.size.trim() && parseQuotaBytes(values.size, values.unit) == null
      ? { size: "Storage quota value is invalid." } : {}),
    ...(values.objects.trim() && parseOptionalNonNegativeInteger(values.objects) == null
      ? { objects: "Object quota must be a non-negative integer." } : {}),
  };
}

const UNIT_FACTORS: Record<CephAdminQuotaUnit, number> = {
  B: 1,
  ...QUOTA_SIZE_UNIT_BYTES,
};

export const parseOptionalNonNegativeInteger = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

export const parseQuotaBytes = (value: string, unit: CephAdminQuotaUnit): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const bytes = Math.round(parsed * UNIT_FACTORS[unit]);
  return Number.isFinite(bytes) ? bytes : null;
};

export const quotaBytesToForm = (
  bytes?: number | null
): { value: string; unit: CephAdminQuotaUnit } => {
  if (bytes == null || bytes < 0 || !Number.isFinite(bytes)) {
    return { value: "", unit: "GiB" };
  }
  if (bytes === 0) {
    return { value: "0", unit: "GiB" };
  }
  if (bytes % UNIT_FACTORS.TiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.TiB), unit: "TiB" };
  }
  if (bytes % UNIT_FACTORS.GiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.GiB), unit: "GiB" };
  }
  if (bytes % UNIT_FACTORS.MiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.MiB), unit: "MiB" };
  }
  return { value: String(bytes), unit: "B" };
};
