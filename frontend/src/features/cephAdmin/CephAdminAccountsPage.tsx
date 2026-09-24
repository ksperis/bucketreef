/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ToolbarSearchTextarea } from "../../components/ToolbarSearchInput";
import { ToolbarAdvancedFilterButton, ToolbarMatchModeButton } from "../../components/ToolbarFilterControls";
import { ListActionButton, ListActions } from "../../components/list/ListControls";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ColumnVisibilityMenu from "../../components/ColumnVisibilityMenu";
import UiActionMenu from "../../components/ui/UiActionMenu";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";

import {
  CephAdminRgwAccount,
  CephAdminRgwAccountDetail,
  listCephAdminAccounts,
  streamCephAdminAccounts,
} from "../../api/cephAdminAccounts";
import { tableCompactIconActionButtonClasses } from "../../components/tableActionClasses";
import CephAdminAccountCreateModal from "./CephAdminAccountCreateModal";
import CephAdminAccountEditModal from "./CephAdminAccountEditModal";
import CephAdminAdminOpsModal from "./CephAdminAdminOpsModal";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import AdvancedFilterDrawerShell from "../shared/AdvancedFilterDrawerShell";
import AdvancedFilterNumberRangeField from "../shared/AdvancedFilterNumberRangeField";
import AdvancedFilterTextMatchField from "../shared/AdvancedFilterTextMatchField";
import {
  FILTER_COST_LABEL,
  advancedFilterSectionClass,
  advancedFilterSyncBadgeClass,
  buildTextFieldRules,
  formatAdvancedFilterSyncLabel,
  formatTextFilterSummary,
  parseExactListInput,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterCostBadge,
  renderAdvancedFilterRuleCountBadge,
  renderAdvancedSearchProgress,
  type FilterCostLevel,
  type TextMatchMode,
} from "../shared/advancedFilterShared";
import {
  advancedFilterFieldHighlight,
  appendNumericFilterRule,
  buildNumericFilterSummaryItems,
} from "./filtering/advancedFilterModel";
import { useCephAdminListingFilters } from "./filtering/useCephAdminListingFilters";
import { useCephAdminEntityListing } from "./listing/useCephAdminEntityListing";
import { readClientJsonFromKey, writeClientJsonToKey } from "../../utils/clientStorage";
import { formatBytes, formatNumber } from "../../utils/format";
import { nextSortState } from "../../utils/sortValues";

type ColumnId =
  | "account_name"
  | "email"
  | "max_users"
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "bucket_count"
  | "user_count";

type SortField =
  | "account_id"
  | "account_name"
  | "email"
  | "max_users"
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "bucket_count"
  | "user_count";

type AdvancedFilterState = {
  accountName: string;
  accountNameMatchMode: TextMatchMode;
  email: string;
  emailMatchMode: TextMatchMode;
  minMaxUsers: string;
  maxMaxUsers: string;
  minMaxBuckets: string;
  maxMaxBuckets: string;
  minQuotaBytes: string;
  maxQuotaBytes: string;
  minQuotaObjects: string;
  maxQuotaObjects: string;
  minQuotaUsageSizePercent: string;
  maxQuotaUsageSizePercent: string;
  minQuotaUsageObjectPercent: string;
  maxQuotaUsageObjectPercent: string;
  minBucketCount: string;
  maxBucketCount: string;
  minUserCount: string;
  maxUserCount: string;
};

type AdvancedTextField = "accountName" | "email";
type AdvancedNumericField =
  | "minMaxUsers"
  | "maxMaxUsers"
  | "minMaxBuckets"
  | "maxMaxBuckets"
  | "minQuotaBytes"
  | "maxQuotaBytes"
  | "minQuotaObjects"
  | "maxQuotaObjects"
  | "minQuotaUsageSizePercent"
  | "maxQuotaUsageSizePercent"
  | "minQuotaUsageObjectPercent"
  | "maxQuotaUsageObjectPercent"
  | "minBucketCount"
  | "maxBucketCount"
  | "minUserCount"
  | "maxUserCount";
type AdvancedNumericRangeField = {
  label: string;
  minKey: AdvancedNumericField;
  maxKey: AdvancedNumericField;
};
type AdvancedField = AdvancedTextField | AdvancedNumericField;
type ActiveFilterRemoveAction = { type: "quick" } | { type: "advanced"; field: AdvancedField };
type ActiveFilterSummaryItem = {
  id: string;
  label: string;
  remove: ActiveFilterRemoveAction;
};

const COLUMNS_STORAGE_KEY = "ceph-admin.account_list.columns.v1";
const defaultVisibleColumns: ColumnId[] = [];
const DEFAULT_SORT: { field: SortField; direction: "asc" | "desc" } = { field: "account_id", direction: "asc" };
const ACCOUNT_COLUMN_GROUPS: Array<{ id: string; label: string; options: Array<{ id: ColumnId; label: string }> }> = [
  {
    id: "identity",
    label: "Identity",
    options: [
      { id: "account_name", label: "Name" },
      { id: "email", label: "Email" },
    ],
  },
  {
    id: "limits_quotas",
    label: "Limits & quotas",
    options: [
      { id: "max_users", label: "Max users" },
      { id: "max_buckets", label: "Max buckets" },
      { id: "quota_max_size_bytes", label: "Quota (size)" },
      { id: "quota_max_objects", label: "Quota (objects)" },
    ],
  },
  {
    id: "usage",
    label: "Usage",
    options: [
      { id: "bucket_count", label: "Buckets" },
      { id: "user_count", label: "Users" },
    ],
  },
];

// Sort choices remain stable when optional table columns are hidden.
const SORT_COLUMNS: Array<{ field: SortField; label: string }> = [
  { field: "account_id", label: "Account ID" },
  ...ACCOUNT_COLUMN_GROUPS.flatMap(group => group.options.map(option => ({ field: option.id, label: option.label }))),
];

const defaultAdvancedFilter: AdvancedFilterState = {
  accountName: "",
  accountNameMatchMode: "contains",
  email: "",
  emailMatchMode: "contains",
  minMaxUsers: "",
  maxMaxUsers: "",
  minMaxBuckets: "",
  maxMaxBuckets: "",
  minQuotaBytes: "",
  maxQuotaBytes: "",
  minQuotaObjects: "",
  maxQuotaObjects: "",
  minQuotaUsageSizePercent: "",
  maxQuotaUsageSizePercent: "",
  minQuotaUsageObjectPercent: "",
  maxQuotaUsageObjectPercent: "",
  minBucketCount: "",
  maxBucketCount: "",
  minUserCount: "",
  maxUserCount: "",
};

const hasAdvancedFilters = (advanced: AdvancedFilterState | null, allowUsageFilters: boolean) => {
  if (!advanced) return false;
  return Boolean(
    advanced.accountName.trim() ||
      advanced.email.trim() ||
      advanced.minMaxUsers.trim() ||
      advanced.maxMaxUsers.trim() ||
      advanced.minMaxBuckets.trim() ||
      advanced.maxMaxBuckets.trim() ||
      advanced.minQuotaBytes.trim() ||
      advanced.maxQuotaBytes.trim() ||
      advanced.minQuotaObjects.trim() ||
      advanced.maxQuotaObjects.trim() ||
      (allowUsageFilters &&
        (advanced.minQuotaUsageSizePercent.trim() ||
          advanced.maxQuotaUsageSizePercent.trim() ||
          advanced.minQuotaUsageObjectPercent.trim() ||
          advanced.maxQuotaUsageObjectPercent.trim())) ||
      advanced.minBucketCount.trim() ||
      advanced.maxBucketCount.trim() ||
      advanced.minUserCount.trim() ||
      advanced.maxUserCount.trim()
  );
};

const buildAdvancedFilterPayload = (
  advanced: AdvancedFilterState | null,
  quickSearch: string,
  quickMatchMode: TextMatchMode,
  allowUsageFilters: boolean
) => {
  const rules: Array<Record<string, unknown>> = [];
  const quickParsed = parseExactListInput(quickSearch);
  if (quickParsed.values.length > 0 && (quickMatchMode === "exact" || quickParsed.listProvided)) {
    rules.push(...buildTextFieldRules("account_id", quickSearch, "exact"));
  }

  if (advanced) {
    rules.push(...buildTextFieldRules("account_name", advanced.accountName, advanced.accountNameMatchMode));
    rules.push(...buildTextFieldRules("email", advanced.email, advanced.emailMatchMode));

    appendNumericFilterRule(rules, "max_users", "gte", advanced.minMaxUsers);
    appendNumericFilterRule(rules, "max_users", "lte", advanced.maxMaxUsers);
    appendNumericFilterRule(rules, "max_buckets", "gte", advanced.minMaxBuckets);
    appendNumericFilterRule(rules, "max_buckets", "lte", advanced.maxMaxBuckets);

    appendNumericFilterRule(rules, "quota_max_size_bytes", "gte", advanced.minQuotaBytes);
    appendNumericFilterRule(rules, "quota_max_size_bytes", "lte", advanced.maxQuotaBytes);
    appendNumericFilterRule(rules, "quota_max_objects", "gte", advanced.minQuotaObjects);
    appendNumericFilterRule(rules, "quota_max_objects", "lte", advanced.maxQuotaObjects);
    if (allowUsageFilters) {
      appendNumericFilterRule(rules, "quota_usage_size_percent", "gte", advanced.minQuotaUsageSizePercent);
      appendNumericFilterRule(rules, "quota_usage_size_percent", "lte", advanced.maxQuotaUsageSizePercent);
      appendNumericFilterRule(rules, "quota_usage_object_percent", "gte", advanced.minQuotaUsageObjectPercent);
      appendNumericFilterRule(rules, "quota_usage_object_percent", "lte", advanced.maxQuotaUsageObjectPercent);
    }

    appendNumericFilterRule(rules, "bucket_count", "gte", advanced.minBucketCount);
    appendNumericFilterRule(rules, "bucket_count", "lte", advanced.maxBucketCount);
    appendNumericFilterRule(rules, "user_count", "gte", advanced.minUserCount);
    appendNumericFilterRule(rules, "user_count", "lte", advanced.maxUserCount);
  }

  if (rules.length === 0) return undefined;
  return JSON.stringify({ match: "all", rules });
};

const loadVisibleColumns = (): ColumnId[] => {
  const parsed = readClientJsonFromKey<unknown>(COLUMNS_STORAGE_KEY);
  if (!Array.isArray(parsed)) return defaultVisibleColumns;
  const allowed = new Set<ColumnId>([
    "account_name",
    "email",
    "max_users",
    "max_buckets",
    "quota_max_size_bytes",
    "quota_max_objects",
    "bucket_count",
    "user_count",
  ]);
  const cleaned = parsed.filter((v) => typeof v === "string" && allowed.has(v as ColumnId)) as ColumnId[];
  return cleaned.length > 0 ? cleaned : defaultVisibleColumns;
};

const persistVisibleColumns = (value: ColumnId[]) => {
  writeClientJsonToKey(COLUMNS_STORAGE_KEY, value);
};

const rowKey = (account: CephAdminRgwAccount) => account.account_id;

export default function CephAdminAccountsPage() {
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint, selectedEndpointAccess } = useCephAdminEndpoint();
  const canViewMetrics = Boolean(selectedEndpointAccess?.can_metrics) && (selectedEndpoint?.capabilities?.metrics !== false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>(DEFAULT_SORT);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadVisibleColumns);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<CephAdminRgwAccount | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const {
    filter,
    setFilter,
    searchValue,
    quickFilterMode,
    setQuickFilterMode,
    showAdvancedFilter,
    setShowAdvancedFilter,
    advancedDraft,
    advancedApplied,
    updateAdvancedField,
    applyAdvancedFilter,
    resetAdvancedFilter,
    resetAllFilters,
    removeActiveFilterItem,
  } = useCephAdminListingFilters<AdvancedFilterState>({
    endpointId: selectedEndpointId,
    defaultAdvancedFilter,
    setPage,
  });

  useEffect(() => {
    persistVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    setPageSize(25);
    setSort(DEFAULT_SORT);
    setShowCreateModal(false);
    setEditingAccountId(null);
  }, [selectedEndpointId]);

  const includeParams = useMemo(() => {
    const include = new Set<string>();
    // Base listing response is already enriched with profile/limits/quota values.
    // Request extra enrichment only for live stats fields.
    if (visibleColumns.includes("bucket_count") || visibleColumns.includes("user_count")) include.add("stats");
    return Array.from(include.values());
  }, [visibleColumns]);

  const quickFilterDraftParsed = useMemo(() => parseExactListInput(filter), [filter]);
  const quickFilterAppliedParsed = useMemo(() => parseExactListInput(searchValue), [searchValue]);
  const quickFilterDraftForcesExact = quickFilterDraftParsed.listProvided && quickFilterDraftParsed.values.length > 0;
  const quickFilterAppliedForcesExact = quickFilterAppliedParsed.listProvided && quickFilterAppliedParsed.values.length > 0;
  const quickFilterModeForDisplay: TextMatchMode = quickFilterDraftForcesExact ? "exact" : quickFilterMode;
  const effectiveQuickFilterMode: TextMatchMode = quickFilterAppliedForcesExact ? "exact" : quickFilterMode;
  const effectiveSearchValue = effectiveQuickFilterMode === "contains" ? searchValue : "";
  const advancedFilterParam = useMemo(
    () => buildAdvancedFilterPayload(advancedApplied, searchValue, effectiveQuickFilterMode, canViewMetrics),
    [advancedApplied, searchValue, effectiveQuickFilterMode, canViewMetrics]
  );

  const { items, total, loading, loadingDetails, advancedProgress, error, updateEntity } =
    useCephAdminEntityListing<CephAdminRgwAccount>({
      endpointId: selectedEndpointId,
      page,
      pageSize,
      search: effectiveSearchValue,
      advancedFilter: advancedFilterParam,
      sortBy: sort.field,
      sortDirection: sort.direction,
      includes: includeParams,
      reloadNonce,
      listEntities: listCephAdminAccounts,
      streamEntities: streamCephAdminAccounts,
      entityKey: rowKey,
    });

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  const toggleSort = (field: SortField) => {
    setSort((current) => nextSortState(current, field));
    setPage(1);
  };

  const quickDraftValue = filter.trim();
  const quickAppliedValue = searchValue.trim();
  const quickFilterPending = quickDraftValue !== quickAppliedValue;
  const quickFilterFieldState = advancedFilterFieldHighlight(quickAppliedValue.length > 0, quickFilterPending);

  const accountNameAppliedValue = (advancedApplied?.accountName ?? "").trim();
  const emailAppliedValue = (advancedApplied?.email ?? "").trim();
  const accountNameDraftValue = advancedDraft.accountName.trim();
  const emailDraftValue = advancedDraft.email.trim();

  const accountNameAppliedParsed = parseExactListInput(advancedApplied?.accountName ?? "");
  const accountNameDraftParsed = parseExactListInput(advancedDraft.accountName);
  const emailAppliedParsed = parseExactListInput(advancedApplied?.email ?? "");
  const emailDraftParsed = parseExactListInput(advancedDraft.email);
  const accountNameDraftForcesExact = accountNameDraftParsed.listProvided && accountNameDraftParsed.values.length > 0;
  const emailDraftForcesExact = emailDraftParsed.listProvided && emailDraftParsed.values.length > 0;

  const accountNameAppliedMode: TextMatchMode =
    accountNameAppliedParsed.listProvided && accountNameAppliedParsed.values.length > 0
      ? "exact"
      : (advancedApplied?.accountNameMatchMode ?? "contains");
  const accountNameDraftMode: TextMatchMode =
    accountNameDraftParsed.listProvided && accountNameDraftParsed.values.length > 0
      ? "exact"
      : advancedDraft.accountNameMatchMode;
  const emailAppliedMode: TextMatchMode =
    emailAppliedParsed.listProvided && emailAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.emailMatchMode ?? "contains");
  const emailDraftMode: TextMatchMode =
    emailDraftParsed.listProvided && emailDraftParsed.values.length > 0 ? "exact" : advancedDraft.emailMatchMode;

  const accountNamePending =
    accountNameDraftValue !== accountNameAppliedValue || (accountNameDraftValue.length > 0 && accountNameDraftMode !== accountNameAppliedMode);
  const emailPending = emailDraftValue !== emailAppliedValue || (emailDraftValue.length > 0 && emailDraftMode !== emailAppliedMode);

  const accountNameFieldState = advancedFilterFieldHighlight(Boolean(accountNameAppliedValue), accountNamePending);
  const emailFieldState = advancedFilterFieldHighlight(Boolean(emailAppliedValue), emailPending);

  const numericRangeFields = useMemo<AdvancedNumericRangeField[]>(() => [
    { label: "Max users", minKey: "minMaxUsers", maxKey: "maxMaxUsers" },
    { label: "Max buckets", minKey: "minMaxBuckets", maxKey: "maxMaxBuckets" },
    { label: "Quota bytes", minKey: "minQuotaBytes", maxKey: "maxQuotaBytes" },
    { label: "Quota objects", minKey: "minQuotaObjects", maxKey: "maxQuotaObjects" },
    { label: "Bucket count", minKey: "minBucketCount", maxKey: "maxBucketCount" },
    { label: "User count", minKey: "minUserCount", maxKey: "maxUserCount" },
  ], []);
  const usageNumericRangeFields = useMemo<AdvancedNumericRangeField[]>(() => [
    { label: "Quota usage size %", minKey: "minQuotaUsageSizePercent", maxKey: "maxQuotaUsageSizePercent" },
    { label: "Quota usage objects %", minKey: "minQuotaUsageObjectPercent", maxKey: "maxQuotaUsageObjectPercent" },
  ], []);
  const numericFields = useMemo<Array<{ key: AdvancedNumericField; label: string }>>(
    () => numericRangeFields.flatMap(({ label, minKey, maxKey }) => [
      { key: minKey, label: `${label} >=` },
      { key: maxKey, label: `${label} <=` },
    ]),
    [numericRangeFields],
  );
  const usageNumericFields = useMemo<Array<{ key: AdvancedNumericField; label: string; format: "percent" }>>(
    () => usageNumericRangeFields.flatMap(({ label, minKey, maxKey }) => [
      { key: minKey, label: `${label} >=`, format: "percent" as const },
      { key: maxKey, label: `${label} <=`, format: "percent" as const },
    ]),
    [usageNumericRangeFields],
  );

  const numericFieldStates = useMemo(() => {
    const states = {} as Record<AdvancedNumericField, { labelClass: string; fieldClass: string }>;
    [...numericFields, ...usageNumericFields].forEach(({ key }) => {
      const draft = (advancedDraft[key] as string).trim();
      const applied = (advancedApplied?.[key] as string | undefined)?.trim() ?? "";
      const pending = draft !== applied;
      states[key] = advancedFilterFieldHighlight(Boolean(applied), pending);
    });
    return states;
  }, [advancedDraft, advancedApplied, numericFields, usageNumericFields]);
  const numericRangeFieldState = (minKey: AdvancedNumericField, maxKey: AdvancedNumericField) => {
    const minDraft = (advancedDraft[minKey] as string).trim();
    const maxDraft = (advancedDraft[maxKey] as string).trim();
    const minApplied = (advancedApplied?.[minKey] as string | undefined)?.trim() ?? "";
    const maxApplied = (advancedApplied?.[maxKey] as string | undefined)?.trim() ?? "";
    return advancedFilterFieldHighlight(
      Boolean(minApplied || maxApplied),
      minDraft !== minApplied || maxDraft !== maxApplied,
    );
  };

  const toggleQuickFilterMode = () => {
    if (quickFilterDraftForcesExact) return;
    setQuickFilterMode((prev) => (prev === "contains" ? "exact" : "contains"));
    setPage(1);
  };
  const updateAdvancedMatchMode = (field: "accountNameMatchMode" | "emailMatchMode", value: TextMatchMode) => {
    updateAdvancedField(field, value);
  };

  const closeAdvancedFilterDrawer = () => {
    setShowAdvancedFilter(false);
  };

  const advancedAppliedPayload = useMemo(
    () => buildAdvancedFilterPayload(advancedApplied, "", "contains", canViewMetrics),
    [advancedApplied, canViewMetrics]
  );
  const advancedDraftPayload = useMemo(
    () => buildAdvancedFilterPayload(advancedDraft, "", "contains", canViewMetrics),
    [advancedDraft, canViewMetrics]
  );
  const hasPendingAdvancedChanges = advancedDraftPayload !== advancedAppliedPayload;
  const hasAnyAdvancedToClear = advancedDraftPayload !== undefined || advancedAppliedPayload !== undefined;
  const advancedFilterCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedFilter && hasPendingAdvancedChanges,
    onClose: closeAdvancedFilterDrawer,
    zIndexClass: "z-[70]",
  });

  const advancedFilterActive = hasAdvancedFilters(advancedApplied, canViewMetrics);
  const quickFilterActive = quickAppliedValue.length > 0;
  const activeFilterSummaryItems = useMemo(() => {
    const items: ActiveFilterSummaryItem[] = [];
    if (quickFilterActive) {
      const label = formatTextFilterSummary("Account ID", searchValue, effectiveQuickFilterMode);
      if (label) items.push({ id: "quick", label, remove: { type: "quick" } });
    }
    if (advancedApplied && hasAdvancedFilters(advancedApplied, canViewMetrics)) {
      const accountNameLabel = formatTextFilterSummary("Account name", advancedApplied.accountName, accountNameAppliedMode);
      if (accountNameLabel) items.push({ id: "accountName", label: accountNameLabel, remove: { type: "advanced", field: "accountName" } });
      const emailLabel = formatTextFilterSummary("Email", advancedApplied.email, emailAppliedMode);
      if (emailLabel) items.push({ id: "email", label: emailLabel, remove: { type: "advanced", field: "email" } });
      buildNumericFilterSummaryItems(
        advancedApplied,
        canViewMetrics ? [...numericFields, ...usageNumericFields] : numericFields,
      ).forEach(({ field, id, label }) => {
        items.push({ id, label, remove: { type: "advanced", field } });
      });
    }
    return items;
  }, [
    quickFilterActive,
    searchValue,
    effectiveQuickFilterMode,
    advancedApplied,
    canViewMetrics,
    accountNameAppliedMode,
    emailAppliedMode,
    numericFields,
    usageNumericFields,
  ]);
  const showActiveFiltersCard =
    activeFilterSummaryItems.length > 0 &&
    !(
      activeFilterSummaryItems.length === 1 &&
      quickFilterActive &&
      !advancedFilterActive &&
      !quickFilterAppliedParsed.listProvided
    );

  const advancedDraftSummaryItems = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    const accountNameLabel = formatTextFilterSummary("Account name", advancedDraft.accountName, accountNameDraftMode);
    if (accountNameLabel) items.push({ id: "draft-accountName", label: accountNameLabel });
    const emailLabel = formatTextFilterSummary("Email", advancedDraft.email, emailDraftMode);
    if (emailLabel) items.push({ id: "draft-email", label: emailLabel });
    items.push(
      ...buildNumericFilterSummaryItems(
        advancedDraft,
        canViewMetrics ? [...numericFields, ...usageNumericFields] : numericFields,
        "draft-",
      ).map(({ id, label }) => ({ id, label })),
    );
    return items;
  }, [advancedDraft, accountNameDraftMode, emailDraftMode, numericFields, canViewMetrics, usageNumericFields]);

  const advancedDraftTextCount = Number(accountNameDraftValue.length > 0) + Number(emailDraftValue.length > 0);
  const advancedDraftNumericCount =
    numericFields.filter(({ key }) => (advancedDraft[key] as string).trim().length > 0).length +
    (canViewMetrics
      ? usageNumericFields.filter(({ key }) => (advancedDraft[key] as string).trim().length > 0).length
      : 0);
  const advancedDraftActiveCount = advancedDraftTextCount + advancedDraftNumericCount;
  const advancedDraftGlobalCostLevel: FilterCostLevel = useMemo(() => {
    if (advancedDraftNumericCount >= 6) return "high";
    if (advancedDraftNumericCount > 0) return "medium";
    if (advancedDraftTextCount > 0) return "medium";
    return "none";
  }, [advancedDraftNumericCount, advancedDraftTextCount]);
  const advancedDraftGlobalCostTooltip = useMemo(() => {
    if (advancedDraftGlobalCostLevel === "high") {
      return `${FILTER_COST_LABEL.high}: many numeric filters are active and may require heavier stats filtering.`;
    }
    if (advancedDraftGlobalCostLevel === "medium") {
      if (advancedDraftTextCount > 0 && advancedDraftNumericCount === 0) {
        return `${FILTER_COST_LABEL.medium}: account profile filters may require per-account detail lookups.`;
      }
      return `${FILTER_COST_LABEL.medium}: numeric filters are active and rely on usage/quota counters.`;
    }
    return FILTER_COST_LABEL.none;
  }, [advancedDraftGlobalCostLevel, advancedDraftNumericCount, advancedDraftTextCount]);

  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const current = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !current.has(column));
  }, [visibleColumns]);

  const detailPlaceholder = loadingDetails ? "Loading..." : "-";

  const applyUpdatedAccount = (updated: CephAdminRgwAccountDetail) => {
    updateEntity(updated.account_id, (account) => ({
      ...account,
      account_name: updated.account_name ?? null,
      email: updated.email ?? null,
      max_users: updated.max_users ?? null,
      max_buckets: updated.max_buckets ?? null,
      quota_max_size_bytes: updated.quota?.max_size_bytes ?? null,
      quota_max_objects: updated.quota?.max_objects ?? null,
      bucket_count: updated.bucket_count ?? null,
      user_count: updated.user_count ?? null,
    }));
  };

  type ColumnDef = DataTableColumn<CephAdminRgwAccount, SortField>;

  const accountTableColumns: ColumnDef[] = (() => {
    const visible = new Set(visibleColumns);
    const cols: ColumnDef[] = [
      {
        id: "account_id",
        label: "Account ID",
        field: "account_id",
        primary: true,
        headerClassName: "min-w-[12rem] max-w-[20rem]",
        cellClassName: "min-w-[12rem] max-w-[20rem]",
        render: (account) => account.account_id,
      },
    ];

    if (visible.has("account_name")) {
      cols.push({
        id: "account_name",
        label: "Name",
        field: "account_name",
        headerClassName: "min-w-[12rem] max-w-[18rem]",
        cellClassName: "min-w-[12rem] max-w-[18rem]",
        render: (account) => account.account_name ?? detailPlaceholder,
      });
    }
    if (visible.has("email")) {
      cols.push({
        id: "email",
        label: "Email",
        field: "email",
        headerClassName: "min-w-[14rem] max-w-[22rem]",
        cellClassName: "min-w-[14rem] max-w-[22rem]",
        render: (account) => account.email ?? detailPlaceholder,
      });
    }
    if (visible.has("max_users")) {
      cols.push({
        id: "max_users",
        label: "Max users",
        field: "max_users",
        align: "right",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (account) => (account.max_users == null ? detailPlaceholder : formatNumber(account.max_users)),
      });
    }
    if (visible.has("max_buckets")) {
      cols.push({
        id: "max_buckets",
        label: "Max buckets",
        field: "max_buckets",
        align: "right",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (account) => (account.max_buckets == null ? detailPlaceholder : formatNumber(account.max_buckets)),
      });
    }
    if (visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: "Quota (size)",
        field: "quota_max_size_bytes",
        align: "right",
        headerClassName: "min-w-[9rem]",
        cellClassName: "min-w-[9rem]",
        render: (account) =>
          account.quota_max_size_bytes == null ? detailPlaceholder : formatBytes(account.quota_max_size_bytes),
      });
    }
    if (visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: "Quota (objects)",
        field: "quota_max_objects",
        align: "right",
        headerClassName: "min-w-[10rem]",
        cellClassName: "min-w-[10rem]",
        render: (account) =>
          account.quota_max_objects == null ? detailPlaceholder : formatNumber(account.quota_max_objects),
      });
    }
    if (visible.has("bucket_count")) {
      cols.push({
        id: "bucket_count",
        label: "Buckets",
        field: "bucket_count",
        align: "right",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (account) => (account.bucket_count == null ? detailPlaceholder : formatNumber(account.bucket_count)),
      });
    }
    if (visible.has("user_count")) {
      cols.push({
        id: "user_count",
        label: "Users",
        field: "user_count",
        align: "right",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (account) => (account.user_count == null ? detailPlaceholder : formatNumber(account.user_count)),
      });
    }

    cols.push({
      id: "actions",
      label: "Act.",
      field: null,
      align: "right",
      mobileRole: "actions",
      headerClassName: "w-16",
      cellClassName: "!py-1.5",
      render: (account) => (
        <ListActions>
          <ListActionButton {...dataTableDefaultActionProps} onClick={() => setEditingAccountId(account.account_id)}>
            Configure
          </ListActionButton>
          <UiActionMenu
            ariaLabel={`More actions for RGW account ${account.account_id}`}
            trigger={<span aria-hidden="true">⋮</span>}
            triggerClassName={tableCompactIconActionButtonClasses}
            sections={[
              { id: "navigation", items: [{
                id: "owner-buckets",
                label: "Owner buckets",
                onSelect: () => navigate(`/ceph-admin/buckets?owner=${encodeURIComponent(account.account_id)}`),
              }] },
              { id: "destructive", items: [{
                id: "delete",
                label: "Delete account",
                danger: true,
                onSelect: () => setDeletingAccount(account),
              }] },
            ]}
          />
        </ListActions>
      ),
    });

    return cols;
  })();
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: items.length,
  });

  return (
    <div className={workflowPageHostClass(showCreateModal || Boolean(editingAccountId))}>
      <PageHeader actionPresentation="listing"
        title="RGW Accounts"
        description="Complete list of RGW accounts (admin ops)."
        breadcrumbs={cephAdminPageBreadcrumbs("accounts")}
        actions={
          selectedEndpointId
            ? [
                {
                  label: "Create account",
                  onClick: () => setShowCreateModal(true),
                },
              ]
            : []
        }
      />
      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!selectedEndpointId ? (
        <PageEmptyState
          title="Select a Ceph endpoint before listing RGW accounts"
          description="RGW account administration is endpoint-scoped. Choose an endpoint to load account inventory, quotas, and owner navigation."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : (
        <ListPageSection
          variant="page"
          mobileSort={<TableSortControls columns={SORT_COLUMNS} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }} />}
            title="Accounts"
            countLabel={`${total} result(s)`}
            search={
              <ToolbarSearchTextarea
                label="Quick filter"
                value={filter}
                onChange={setFilter}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Account ID(s)"
                inputClassName={quickFilterFieldState.fieldClass}
                trailingControl={
                  <ToolbarMatchModeButton
                    mode={quickFilterModeForDisplay}
                    pending={quickFilterPending}
                    locked={quickFilterDraftForcesExact}
                    onClick={toggleQuickFilterMode}
                    aria-label="Toggle quick filter match mode"
                  />
                }
              />
            }
            filters={
              <ToolbarAdvancedFilterButton
                active={showAdvancedFilter || advancedFilterActive}
                onClick={() => setShowAdvancedFilter(true)}
              >
                Advanced filter{advancedFilterActive ? " · Active" : ""}
              </ToolbarAdvancedFilterButton>
            }
            columns={
              <ColumnVisibilityMenu
                selectedCount={visibleColumns.length}
                onReset={resetColumns}
                resetDisabled={!columnsCustomized}
                coreGroups={ACCOUNT_COLUMN_GROUPS.map((group) => ({
                  id: group.id,
                  label: group.label,
                  options: group.options.map((option) => ({
                    id: option.id,
                    label: option.label,
                    checked: visibleColumns.includes(option.id),
                    onToggle: () => toggleColumn(option.id),
                  })),
                }))}
              />
            }
            secondaryContent={
              showActiveFiltersCard || showAdvancedFilter ? (
              <>
                <ActiveFiltersBar
                  items={
                    showActiveFiltersCard
                      ? activeFilterSummaryItems.map((item) => ({
                          id: item.id,
                          label: item.label,
                          onRemove: () => removeActiveFilterItem(item.remove),
                          removeLabel: `Remove ${item.label}`,
                        }))
                      : []
                  }
                  onClearAll={resetAllFilters}
                />

                {showAdvancedFilter && (
                  <AdvancedFilterDrawerShell
                    title="Advanced filter"
                    subtitle="RGW Accounts listing"
                    badges={
                      <>
                        {renderAdvancedFilterRuleCountBadge(advancedDraftActiveCount)}
                        {renderAdvancedFilterCostBadge(advancedDraftGlobalCostLevel, advancedDraftGlobalCostTooltip)}
                        <span className={advancedFilterSyncBadgeClass(hasPendingAdvancedChanges)}>
                          {formatAdvancedFilterSyncLabel(hasPendingAdvancedChanges)}
                        </span>
                      </>
                    }
                    onClose={advancedFilterCloseGuard.requestClose}
                    footer={
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <ListActionButton
                          variant="secondary"
                          onClick={resetAdvancedFilter}
                          disabled={!hasAnyAdvancedToClear}
                        >
                          Clear
                        </ListActionButton>
                        <ListActionButton variant="primary" onClick={applyAdvancedFilter}>
                          Apply filter
                        </ListActionButton>
                      </div>
                    }
                  >
                    <div className="space-y-4">
                          {renderAdvancedFilterDraftSummary(advancedDraftSummaryItems)}

                          <section className={advancedFilterSectionClass}>
                            <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Identity
                            </p>
                            <div className="grid gap-3 md:grid-cols-2">
                              <AdvancedFilterTextMatchField
                                label="Account name"
                                costLevel="medium"
                                costTooltip="Medium cost: account name filters may require per-account profile lookups."
                                fieldState={accountNameFieldState}
                                forcesExact={accountNameDraftForcesExact}
                                matchMode={accountNameDraftMode}
                                onChange={(value) => updateAdvancedField("accountName", value)}
                                onMatchModeChange={(value) => updateAdvancedMatchMode("accountNameMatchMode", value)}
                                placeholder="account-a, account-b"
                                value={advancedDraft.accountName}
                              />

                              <AdvancedFilterTextMatchField
                                label="Email"
                                costLevel="medium"
                                costTooltip="Medium cost: email filters may require per-account profile lookups."
                                fieldState={emailFieldState}
                                forcesExact={emailDraftForcesExact}
                                matchMode={emailDraftMode}
                                onChange={(value) => updateAdvancedField("email", value)}
                                onMatchModeChange={(value) => updateAdvancedMatchMode("emailMatchMode", value)}
                                placeholder="ops@example.com"
                                value={advancedDraft.email}
                              />
                            </div>
                          </section>

                          <section className={advancedFilterSectionClass}>
                            <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Limits and Quotas
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {numericRangeFields.map((field) => (
                                <AdvancedFilterNumberRangeField
                                  key={`${field.minKey}:${field.maxKey}`}
                                  label={field.label}
                                  costLevel="medium"
                                  costTooltip="Medium cost: numeric filters rely on counters/stats."
                                  fieldState={numericRangeFieldState(field.minKey, field.maxKey)}
                                  minFieldState={numericFieldStates[field.minKey]}
                                  maxFieldState={numericFieldStates[field.maxKey]}
                                  minValue={advancedDraft[field.minKey]}
                                  maxValue={advancedDraft[field.maxKey]}
                                  onMinChange={(value) => updateAdvancedField(field.minKey, value)}
                                  onMaxChange={(value) => updateAdvancedField(field.maxKey, value)}
                                />
                              ))}
                            </div>
                            {canViewMetrics && (
                              <div className="mt-4">
                                <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Quota usage %
                                </p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {usageNumericRangeFields.map((field) => (
                                    <AdvancedFilterNumberRangeField
                                      key={`${field.minKey}:${field.maxKey}`}
                                      label={field.label}
                                      costLevel="medium"
                                      costTooltip="Medium cost: usage percentage filters require bucket metrics aggregation."
                                      fieldState={numericRangeFieldState(field.minKey, field.maxKey)}
                                      minFieldState={numericFieldStates[field.minKey]}
                                      maxFieldState={numericFieldStates[field.maxKey]}
                                      minValue={advancedDraft[field.minKey]}
                                      maxValue={advancedDraft[field.maxKey]}
                                      inputMin={0}
                                      onMinChange={(value) => updateAdvancedField(field.minKey, value)}
                                      onMaxChange={(value) => updateAdvancedField(field.maxKey, value)}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </section>
                    </div>
                  </AdvancedFilterDrawerShell>
                )}
              </>
              ) : null
            }
        >

          {renderAdvancedSearchProgress(advancedProgress)}

          <DataTableShell
            columns={accountTableColumns}
            rows={items}
            rowKey={rowKey}
            status={tableStatus}
            loadingMessage="Loading accounts..."
            errorMessage="Unable to load accounts."
            emptyMessage="No accounts."
            primaryColumnId="account_id"
            overflowXHidden={showAdvancedFilter}
            responsiveCards
            sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
            pagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size);
                setPage(1);
              },
              disabled: loading || !selectedEndpointId,
            }}
          />
        </ListPageSection>
      )}

      {selectedEndpointId && editingAccountId && (
        <CephAdminAccountEditModal
          endpointId={selectedEndpointId}
          accountId={editingAccountId}
          canViewMetrics={canViewMetrics}
          onClose={() => setEditingAccountId(null)}
          onSaved={applyUpdatedAccount}
        />
      )}
      {selectedEndpointId && showCreateModal && (
        <CephAdminAccountCreateModal
          endpointId={selectedEndpointId}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setReloadNonce((prev) => prev + 1);
          }}
        />
      )}
      {selectedEndpointId && deletingAccount && (
        <CephAdminAdminOpsModal
          endpointId={selectedEndpointId}
          endpointName={selectedEndpoint?.name}
          action={{ kind: "delete-account", account: deletingAccount }}
          canAccounts={Boolean(selectedEndpointAccess?.can_accounts)}
          onClose={() => setDeletingAccount(null)}
          onSuccess={() => setReloadNonce((prev) => prev + 1)}
        />
      )}
      {advancedFilterCloseGuard.confirmationDialog}
    </div>
  );
}
