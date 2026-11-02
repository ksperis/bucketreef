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

export type UserAdvancedStatusFilter = "any" | "active" | "suspended";

export type UserAdvancedFilterState = QuotaAdvancedFilterState & {
  tenant: string;
  tenantMatchMode: TextMatchMode;
  accountId: string;
  accountIdMatchMode: TextMatchMode;
  accountName: string;
  accountNameMatchMode: TextMatchMode;
  fullName: string;
  fullNameMatchMode: TextMatchMode;
  email: string;
  emailMatchMode: TextMatchMode;
  minMaxBuckets: string;
  maxMaxBuckets: string;
  suspended: UserAdvancedStatusFilter;
};

type UserAdvancedTextField = "tenant" | "accountId" | "accountName" | "fullName" | "email";
export type UserAdvancedNumericField =
  | "minMaxBuckets"
  | "maxMaxBuckets"
  | QuotaAdvancedNumericField;
type UserAdvancedField = UserAdvancedTextField | UserAdvancedNumericField | "suspended";
export type UserActiveFilterRemoveAction =
  | { type: "quick" }
  | { type: "advanced"; field: UserAdvancedField };
export type UserActiveFilterSummaryItem = {
  id: string;
  label: string;
  remove: UserActiveFilterRemoveAction;
};

export const defaultUserAdvancedFilter: UserAdvancedFilterState = {
  tenant: "",
  tenantMatchMode: "contains",
  accountId: "",
  accountIdMatchMode: "contains",
  accountName: "",
  accountNameMatchMode: "contains",
  fullName: "",
  fullNameMatchMode: "contains",
  email: "",
  emailMatchMode: "contains",
  minMaxBuckets: "",
  maxMaxBuckets: "",
  ...defaultQuotaAdvancedFilter,
  suspended: "any",
};

export const hasUserAdvancedFilters = (
  advanced: UserAdvancedFilterState | null,
  allowUsageFilters: boolean,
) => {
  if (!advanced) return false;
  return Boolean(
    advanced.tenant.trim() ||
      advanced.accountId.trim() ||
      advanced.accountName.trim() ||
      advanced.fullName.trim() ||
      advanced.email.trim() ||
      advanced.minMaxBuckets.trim() ||
      advanced.maxMaxBuckets.trim() ||
      hasQuotaAdvancedFilters(advanced, allowUsageFilters) ||
      advanced.suspended !== "any"
  );
};

export const buildUserAdvancedFilterPayload = (
  advanced: UserAdvancedFilterState | null,
  quickSearch: string,
  quickMatchMode: TextMatchMode,
  allowUsageFilters: boolean,
) => {
  const rules: Array<Record<string, unknown>> = [];
  rules.push(...buildQuickTextFilterRules("uid", quickSearch, quickMatchMode));

  if (advanced) {
    rules.push(...buildTextFieldRules("tenant", advanced.tenant, advanced.tenantMatchMode));
    rules.push(...buildTextFieldRules("account_id", advanced.accountId, advanced.accountIdMatchMode));
    rules.push(...buildTextFieldRules("account_name", advanced.accountName, advanced.accountNameMatchMode));
    rules.push(...buildTextFieldRules("full_name", advanced.fullName, advanced.fullNameMatchMode));
    rules.push(...buildTextFieldRules("email", advanced.email, advanced.emailMatchMode));
    appendNumericFilterRule(rules, "max_buckets", "gte", advanced.minMaxBuckets);
    appendNumericFilterRule(rules, "max_buckets", "lte", advanced.maxMaxBuckets);
    appendQuotaAdvancedFilterRules(rules, advanced, allowUsageFilters);

    if (advanced.suspended === "active") {
      rules.push({ field: "suspended", op: "eq", value: false });
    } else if (advanced.suspended === "suspended") {
      rules.push({ field: "suspended", op: "eq", value: true });
    }
  }

  if (rules.length === 0) return undefined;
  return serializeAdvancedFilterRules(rules);
};

const USER_BASE_NUMERIC_FIELDS: readonly UserAdvancedNumericField[] = [
  "minMaxBuckets",
  "maxMaxBuckets",
  ...quotaBaseAdvancedNumericFields,
];

const USER_USAGE_NUMERIC_FIELDS: readonly UserAdvancedNumericField[] =
  quotaUsageAdvancedNumericFields;

type UserAdvancedFilterCost = {
  activeCount: number;
  directTextCount: number;
  enrichedTextCount: number;
  numericCount: number;
  level: FilterCostLevel;
};

export const resolveUserAdvancedFilterCost = (
  advanced: UserAdvancedFilterState,
  allowUsageFilters: boolean,
): UserAdvancedFilterCost => {
  const directTextCount = Number(advanced.tenant.trim().length > 0);
  const enrichedTextCount =
    Number(advanced.accountId.trim().length > 0) +
    Number(advanced.accountName.trim().length > 0) +
    Number(advanced.fullName.trim().length > 0) +
    Number(advanced.email.trim().length > 0) +
    Number(advanced.suspended !== "any");
  const numericCount =
    countActiveNumericFilterFields(advanced, USER_BASE_NUMERIC_FIELDS) +
    (allowUsageFilters
      ? countActiveNumericFilterFields(advanced, USER_USAGE_NUMERIC_FIELDS)
      : 0);
  const activeCount = directTextCount + enrichedTextCount + numericCount;
  const level: FilterCostLevel = numericCount >= 4
    ? "high"
    : numericCount > 0 || enrichedTextCount > 0
      ? "medium"
      : directTextCount > 0
        ? "low"
        : "none";

  return {
    activeCount,
    directTextCount,
    enrichedTextCount,
    numericCount,
    level,
  };
};
