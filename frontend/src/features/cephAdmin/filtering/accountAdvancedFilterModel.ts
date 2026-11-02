/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  buildQuickTextFilterRules,
  buildTextFieldRules,
  serializeAdvancedFilterRules,
  type FilterCostLevel,
  type TextMatchMode,
} from "../../shared/advancedFilterShared";
import {
  appendQuotaAdvancedFilterRules,
  defaultQuotaAdvancedFilter,
  hasQuotaAdvancedFilters,
  quotaBaseAdvancedNumericFields,
  quotaUsageAdvancedNumericFields,
  type QuotaAdvancedFilterState,
  type QuotaAdvancedNumericField,
} from "../../shared/quotaAdvancedFilterModel";
import {
  appendNumericFilterRule,
  countActiveNumericFilterFields,
} from "./advancedFilterModel";

export type AccountAdvancedFilterState = QuotaAdvancedFilterState & {
  accountName: string;
  accountNameMatchMode: TextMatchMode;
  email: string;
  emailMatchMode: TextMatchMode;
  minMaxUsers: string;
  maxMaxUsers: string;
  minMaxBuckets: string;
  maxMaxBuckets: string;
  minBucketCount: string;
  maxBucketCount: string;
  minUserCount: string;
  maxUserCount: string;
};

type AccountAdvancedTextField = "accountName" | "email";
export type AccountAdvancedNumericField =
  | "minMaxUsers"
  | "maxMaxUsers"
  | "minMaxBuckets"
  | "maxMaxBuckets"
  | QuotaAdvancedNumericField
  | "minBucketCount"
  | "maxBucketCount"
  | "minUserCount"
  | "maxUserCount";
type AccountAdvancedField = AccountAdvancedTextField | AccountAdvancedNumericField;
export type AccountActiveFilterRemoveAction =
  | { type: "quick" }
  | { type: "advanced"; field: AccountAdvancedField };
export type AccountActiveFilterSummaryItem = {
  id: string;
  label: string;
  remove: AccountActiveFilterRemoveAction;
};

export const defaultAccountAdvancedFilter: AccountAdvancedFilterState = {
  accountName: "",
  accountNameMatchMode: "contains",
  email: "",
  emailMatchMode: "contains",
  minMaxUsers: "",
  maxMaxUsers: "",
  minMaxBuckets: "",
  maxMaxBuckets: "",
  ...defaultQuotaAdvancedFilter,
  minBucketCount: "",
  maxBucketCount: "",
  minUserCount: "",
  maxUserCount: "",
};

export const hasAccountAdvancedFilters = (
  advanced: AccountAdvancedFilterState | null,
  allowUsageFilters: boolean,
) => {
  if (!advanced) return false;
  return Boolean(
    advanced.accountName.trim() ||
      advanced.email.trim() ||
      advanced.minMaxUsers.trim() ||
      advanced.maxMaxUsers.trim() ||
      advanced.minMaxBuckets.trim() ||
      advanced.maxMaxBuckets.trim() ||
      hasQuotaAdvancedFilters(advanced, allowUsageFilters) ||
      advanced.minBucketCount.trim() ||
      advanced.maxBucketCount.trim() ||
      advanced.minUserCount.trim() ||
      advanced.maxUserCount.trim()
  );
};

export const buildAccountAdvancedFilterPayload = (
  advanced: AccountAdvancedFilterState | null,
  quickSearch: string,
  quickMatchMode: TextMatchMode,
  allowUsageFilters: boolean,
) => {
  const rules: Array<Record<string, unknown>> = [];
  rules.push(...buildQuickTextFilterRules("account_id", quickSearch, quickMatchMode));

  if (advanced) {
    rules.push(...buildTextFieldRules("account_name", advanced.accountName, advanced.accountNameMatchMode));
    rules.push(...buildTextFieldRules("email", advanced.email, advanced.emailMatchMode));
    appendNumericFilterRule(rules, "max_users", "gte", advanced.minMaxUsers);
    appendNumericFilterRule(rules, "max_users", "lte", advanced.maxMaxUsers);
    appendNumericFilterRule(rules, "max_buckets", "gte", advanced.minMaxBuckets);
    appendNumericFilterRule(rules, "max_buckets", "lte", advanced.maxMaxBuckets);
    appendQuotaAdvancedFilterRules(rules, advanced, allowUsageFilters);
    appendNumericFilterRule(rules, "bucket_count", "gte", advanced.minBucketCount);
    appendNumericFilterRule(rules, "bucket_count", "lte", advanced.maxBucketCount);
    appendNumericFilterRule(rules, "user_count", "gte", advanced.minUserCount);
    appendNumericFilterRule(rules, "user_count", "lte", advanced.maxUserCount);
  }

  if (rules.length === 0) return undefined;
  return serializeAdvancedFilterRules(rules);
};

const ACCOUNT_BASE_NUMERIC_FIELDS: readonly AccountAdvancedNumericField[] = [
  "minMaxUsers",
  "maxMaxUsers",
  "minMaxBuckets",
  "maxMaxBuckets",
  ...quotaBaseAdvancedNumericFields,
  "minBucketCount",
  "maxBucketCount",
  "minUserCount",
  "maxUserCount",
];

const ACCOUNT_USAGE_NUMERIC_FIELDS: readonly AccountAdvancedNumericField[] =
  quotaUsageAdvancedNumericFields;

type AccountAdvancedFilterCost = {
  activeCount: number;
  textCount: number;
  numericCount: number;
  level: FilterCostLevel;
};

export const resolveAccountAdvancedFilterCost = (
  advanced: AccountAdvancedFilterState,
  allowUsageFilters: boolean,
): AccountAdvancedFilterCost => {
  const textCount =
    Number(advanced.accountName.trim().length > 0) +
    Number(advanced.email.trim().length > 0);
  const numericCount =
    countActiveNumericFilterFields(advanced, ACCOUNT_BASE_NUMERIC_FIELDS) +
    (allowUsageFilters
      ? countActiveNumericFilterFields(advanced, ACCOUNT_USAGE_NUMERIC_FIELDS)
      : 0);
  const activeCount = textCount + numericCount;
  const level: FilterCostLevel = numericCount >= 6
    ? "high"
    : numericCount > 0 || textCount > 0
      ? "medium"
      : "none";

  return { activeCount, textCount, numericCount, level };
};
