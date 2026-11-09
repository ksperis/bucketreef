/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const QUOTA_SIZE_UNITS = ["MiB", "GiB", "TiB"] as const;

export type QuotaSizeUnit = (typeof QUOTA_SIZE_UNITS)[number];

export const QUOTA_SIZE_UNIT_BYTES: Record<QuotaSizeUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};
