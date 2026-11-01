/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type QuotaAdvancedNumericField =
  | "minQuotaBytes"
  | "maxQuotaBytes"
  | "minQuotaObjects"
  | "maxQuotaObjects"
  | "minQuotaUsageSizePercent"
  | "maxQuotaUsageSizePercent"
  | "minQuotaUsageObjectPercent"
  | "maxQuotaUsageObjectPercent";

export type QuotaAdvancedFilterState = Record<QuotaAdvancedNumericField, string>;

export const defaultQuotaAdvancedFilter: QuotaAdvancedFilterState = {
  minQuotaBytes: "",
  maxQuotaBytes: "",
  minQuotaObjects: "",
  maxQuotaObjects: "",
  minQuotaUsageSizePercent: "",
  maxQuotaUsageSizePercent: "",
  minQuotaUsageObjectPercent: "",
  maxQuotaUsageObjectPercent: "",
};

type QuotaAdvancedFilterRule = {
  stateField: QuotaAdvancedNumericField;
  apiField:
    | "quota_max_size_bytes"
    | "quota_max_objects"
    | "quota_usage_size_percent"
    | "quota_usage_object_percent";
  op: "gte" | "lte";
  usagePercentage: boolean;
};

export const quotaAdvancedFilterRules: readonly QuotaAdvancedFilterRule[] = [
  { stateField: "minQuotaBytes", apiField: "quota_max_size_bytes", op: "gte", usagePercentage: false },
  { stateField: "maxQuotaBytes", apiField: "quota_max_size_bytes", op: "lte", usagePercentage: false },
  { stateField: "minQuotaObjects", apiField: "quota_max_objects", op: "gte", usagePercentage: false },
  { stateField: "maxQuotaObjects", apiField: "quota_max_objects", op: "lte", usagePercentage: false },
  { stateField: "minQuotaUsageSizePercent", apiField: "quota_usage_size_percent", op: "gte", usagePercentage: true },
  { stateField: "maxQuotaUsageSizePercent", apiField: "quota_usage_size_percent", op: "lte", usagePercentage: true },
  { stateField: "minQuotaUsageObjectPercent", apiField: "quota_usage_object_percent", op: "gte", usagePercentage: true },
  { stateField: "maxQuotaUsageObjectPercent", apiField: "quota_usage_object_percent", op: "lte", usagePercentage: true },
];

export const quotaAdvancedNumericFields: readonly QuotaAdvancedNumericField[] =
  quotaAdvancedFilterRules.map(({ stateField }) => stateField);

export const hasQuotaAdvancedFilters = (
  advanced: QuotaAdvancedFilterState,
  allowUsageFilters: boolean,
) => quotaAdvancedFilterRules.some(
  ({ stateField, usagePercentage }) =>
    (!usagePercentage || allowUsageFilters) && Boolean(advanced[stateField].trim()),
);

export const appendQuotaAdvancedFilterRules = (
  rules: Array<Record<string, unknown>>,
  advanced: QuotaAdvancedFilterState,
  allowUsageFilters: boolean,
) => {
  quotaAdvancedFilterRules.forEach(({ stateField, apiField, op, usagePercentage }) => {
    if (usagePercentage && !allowUsageFilters) return;
    const rawValue = advanced[stateField].trim();
    if (!rawValue) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    rules.push({ field: apiField, op, value });
  });
};
