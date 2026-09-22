/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type AdminQuotaSizeEditorValue = {
  value: string;
  unit: "MiB" | "GiB";
};

export function buildAdminQuotaSizeEditorValue(
  quotaGb?: number | null,
): AdminQuotaSizeEditorValue {
  if (quotaGb == null) {
    return { value: "", unit: "GiB" };
  }
  if (quotaGb > 0 && quotaGb < 1 && Number.isInteger(quotaGb * 1024)) {
    return { value: String(quotaGb * 1024), unit: "MiB" };
  }
  return { value: String(quotaGb), unit: "GiB" };
}
