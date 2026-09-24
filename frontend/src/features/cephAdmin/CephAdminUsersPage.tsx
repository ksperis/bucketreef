/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ToolbarSearchTextarea } from "../../components/ToolbarSearchInput";
import { toolbarMatchModeButtonClasses } from "../../components/toolbarControlClasses";
import { ListActionButton, ListActions, ListBadge } from "../../components/list/ListControls";
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
  CephAdminRgwUser,
  CephAdminRgwUserDetail,
  listCephAdminUsers,
  streamCephAdminUsers,
} from "../../api/cephAdminUsers";
import { tableCompactIconActionButtonClasses } from "../../components/tableActionClasses";
import CephAdminAdminOpsModal from "./CephAdminAdminOpsModal";
import CephAdminUserCreateModal from "./CephAdminUserCreateModal";
import CephAdminUserEditModal from "./CephAdminUserEditModal";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import AdvancedFilterDrawerShell from "../shared/AdvancedFilterDrawerShell";
import AdvancedFilterNumberRangeField from "../shared/AdvancedFilterNumberRangeField";
import AdvancedFilterSelectField from "../shared/AdvancedFilterSelectField";
import AdvancedFilterTextMatchField from "../shared/AdvancedFilterTextMatchField";
import {
  FILTER_COST_LABEL,
  advancedFilterSectionClass,
  advancedFilterSyncBadgeClass,
  advancedFilterToolbarButtonClass,
  buildTextFieldRules,
  formatAdvancedFilterSyncLabel,
  formatQuickFilterMatchModeTitle,
  formatTextMatchModeSymbol,
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
  | "tenant"
  | "account_name"
  | "full_name"
  | "email"
  | "suspended"
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects";

type SortField =
  | "uid"
  | "tenant"
  | "account_name"
  | "full_name"
  | "email"
  | "suspended"
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects";

type AdvancedStatusFilter = "any" | "active" | "suspended";

type AdvancedFilterState = {
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
  minQuotaBytes: string;
  maxQuotaBytes: string;
  minQuotaObjects: string;
  maxQuotaObjects: string;
  minQuotaUsageSizePercent: string;
  maxQuotaUsageSizePercent: string;
  minQuotaUsageObjectPercent: string;
  maxQuotaUsageObjectPercent: string;
  suspended: AdvancedStatusFilter;
};

type AdvancedTextField = "tenant" | "accountId" | "accountName" | "fullName" | "email";
type AdvancedNumericField =
  | "minMaxBuckets"
  | "maxMaxBuckets"
  | "minQuotaBytes"
  | "maxQuotaBytes"
  | "minQuotaObjects"
  | "maxQuotaObjects"
  | "minQuotaUsageSizePercent"
  | "maxQuotaUsageSizePercent"
  | "minQuotaUsageObjectPercent"
  | "maxQuotaUsageObjectPercent";
type AdvancedNumericRangeField = {
  label: string;
  minKey: AdvancedNumericField;
  maxKey: AdvancedNumericField;
};
type AdvancedField = AdvancedTextField | AdvancedNumericField | "suspended";
type ActiveFilterRemoveAction = { type: "quick" } | { type: "advanced"; field: AdvancedField };
type ActiveFilterSummaryItem = {
  id: string;
  label: string;
  remove: ActiveFilterRemoveAction;
};

const COLUMNS_STORAGE_KEY = "ceph-admin.user_list.columns.v2";
const defaultVisibleColumns: ColumnId[] = ["tenant"];
const DEFAULT_SORT: { field: SortField; direction: "asc" | "desc" } = { field: "uid", direction: "asc" };
const USER_COLUMN_GROUPS: Array<{ id: string; label: string; options: Array<{ id: ColumnId; label: string }> }> = [
  {
    id: "identity",
    label: "Identity",
    options: [
      { id: "tenant", label: "Tenant" },
      { id: "account_name", label: "Account name" },
      { id: "full_name", label: "Full name" },
      { id: "email", label: "Email" },
      { id: "suspended", label: "Suspended" },
    ],
  },
  {
    id: "limits_quotas",
    label: "Limits & quotas",
    options: [
      { id: "max_buckets", label: "Max buckets" },
      { id: "quota_max_size_bytes", label: "Quota (size)" },
      { id: "quota_max_objects", label: "Quota (objects)" },
    ],
  },
];

// Sort choices remain stable when optional table columns are hidden.
const SORT_COLUMNS: Array<{ field: SortField; label: string }> = [
  { field: "uid", label: "UID" },
  ...USER_COLUMN_GROUPS.flatMap(group => group.options.map(option => ({ field: option.id, label: option.label }))),
];

const defaultAdvancedFilter: AdvancedFilterState = {
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
  minQuotaBytes: "",
  maxQuotaBytes: "",
  minQuotaObjects: "",
  maxQuotaObjects: "",
  minQuotaUsageSizePercent: "",
  maxQuotaUsageSizePercent: "",
  minQuotaUsageObjectPercent: "",
  maxQuotaUsageObjectPercent: "",
  suspended: "any",
};

const hasAdvancedFilters = (advanced: AdvancedFilterState | null, allowUsageFilters: boolean) => {
  if (!advanced) return false;
  return Boolean(
    advanced.tenant.trim() ||
      advanced.accountId.trim() ||
      advanced.accountName.trim() ||
      advanced.fullName.trim() ||
      advanced.email.trim() ||
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
      advanced.suspended !== "any"
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
    rules.push(...buildTextFieldRules("uid", quickSearch, "exact"));
  }

  if (advanced) {
    rules.push(...buildTextFieldRules("tenant", advanced.tenant, advanced.tenantMatchMode));
    rules.push(...buildTextFieldRules("account_id", advanced.accountId, advanced.accountIdMatchMode));
    rules.push(...buildTextFieldRules("account_name", advanced.accountName, advanced.accountNameMatchMode));
    rules.push(...buildTextFieldRules("full_name", advanced.fullName, advanced.fullNameMatchMode));
    rules.push(...buildTextFieldRules("email", advanced.email, advanced.emailMatchMode));
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

    if (advanced.suspended === "active") {
      rules.push({ field: "suspended", op: "eq", value: false });
    } else if (advanced.suspended === "suspended") {
      rules.push({ field: "suspended", op: "eq", value: true });
    }
  }

  if (rules.length === 0) return undefined;
  return JSON.stringify({ match: "all", rules });
};

const loadVisibleColumns = (): ColumnId[] => {
  const parsed = readClientJsonFromKey<unknown>(COLUMNS_STORAGE_KEY);
  if (!Array.isArray(parsed)) return defaultVisibleColumns;
  const allowed = new Set<ColumnId>([
    "tenant",
    "account_name",
    "full_name",
    "email",
    "suspended",
    "max_buckets",
    "quota_max_size_bytes",
    "quota_max_objects",
  ]);
  const cleaned = parsed.filter((v) => typeof v === "string" && allowed.has(v as ColumnId)) as ColumnId[];
  return cleaned.length > 0 ? cleaned : defaultVisibleColumns;
};

const persistVisibleColumns = (value: ColumnId[]) => {
  writeClientJsonToKey(COLUMNS_STORAGE_KEY, value);
};

const rowKey = (user: CephAdminRgwUser) => `${user.tenant ?? ""}:${user.uid}`;
const bucketOwnerFilterForUser = (user: CephAdminRgwUser) => {
  const uid = user.uid.trim();
  if (!uid) return null;
  const tenant = (user.tenant ?? "").trim();
  return tenant ? `${tenant}$${uid}` : uid;
};

export default function CephAdminUsersPage() {
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint, selectedEndpointAccess } = useCephAdminEndpoint();
  const canViewMetrics = Boolean(selectedEndpointAccess?.can_metrics) && (selectedEndpoint?.capabilities?.metrics !== false);
  const [editingTarget, setEditingTarget] = useState<CephAdminRgwUser | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<CephAdminRgwUser | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>(DEFAULT_SORT);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadVisibleColumns);
  const [showCreateModal, setShowCreateModal] = useState(false);
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
    setSort(DEFAULT_SORT);
    setShowCreateModal(false);
    setEditingTarget(null);
  }, [selectedEndpointId]);

  const includeParams = useMemo(() => {
    const include = new Set<string>();
    if (visibleColumns.includes("account_name")) include.add("account");
    if (visibleColumns.includes("full_name") || visibleColumns.includes("email")) include.add("profile");
    if (visibleColumns.includes("suspended")) include.add("status");
    if (visibleColumns.includes("max_buckets")) include.add("limits");
    if (visibleColumns.includes("quota_max_size_bytes") || visibleColumns.includes("quota_max_objects")) include.add("quota");
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
    useCephAdminEntityListing<CephAdminRgwUser>({
      endpointId: selectedEndpointId,
      page,
      pageSize,
      search: effectiveSearchValue,
      advancedFilter: advancedFilterParam,
      sortBy: sort.field,
      sortDirection: sort.direction,
      includes: includeParams,
      reloadNonce,
      listEntities: listCephAdminUsers,
      streamEntities: streamCephAdminUsers,
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

  const tenantAppliedValue = (advancedApplied?.tenant ?? "").trim();
  const accountIdAppliedValue = (advancedApplied?.accountId ?? "").trim();
  const accountNameAppliedValue = (advancedApplied?.accountName ?? "").trim();
  const fullNameAppliedValue = (advancedApplied?.fullName ?? "").trim();
  const emailAppliedValue = (advancedApplied?.email ?? "").trim();
  const tenantDraftValue = advancedDraft.tenant.trim();
  const accountIdDraftValue = advancedDraft.accountId.trim();
  const accountNameDraftValue = advancedDraft.accountName.trim();
  const fullNameDraftValue = advancedDraft.fullName.trim();
  const emailDraftValue = advancedDraft.email.trim();

  const tenantAppliedParsed = parseExactListInput(advancedApplied?.tenant ?? "");
  const tenantDraftParsed = parseExactListInput(advancedDraft.tenant);
  const accountIdAppliedParsed = parseExactListInput(advancedApplied?.accountId ?? "");
  const accountIdDraftParsed = parseExactListInput(advancedDraft.accountId);
  const accountNameAppliedParsed = parseExactListInput(advancedApplied?.accountName ?? "");
  const accountNameDraftParsed = parseExactListInput(advancedDraft.accountName);
  const fullNameAppliedParsed = parseExactListInput(advancedApplied?.fullName ?? "");
  const fullNameDraftParsed = parseExactListInput(advancedDraft.fullName);
  const emailAppliedParsed = parseExactListInput(advancedApplied?.email ?? "");
  const emailDraftParsed = parseExactListInput(advancedDraft.email);

  const tenantDraftForcesExact = tenantDraftParsed.listProvided && tenantDraftParsed.values.length > 0;
  const accountIdDraftForcesExact = accountIdDraftParsed.listProvided && accountIdDraftParsed.values.length > 0;
  const accountNameDraftForcesExact = accountNameDraftParsed.listProvided && accountNameDraftParsed.values.length > 0;
  const fullNameDraftForcesExact = fullNameDraftParsed.listProvided && fullNameDraftParsed.values.length > 0;
  const emailDraftForcesExact = emailDraftParsed.listProvided && emailDraftParsed.values.length > 0;

  const tenantAppliedMode: TextMatchMode = tenantAppliedParsed.listProvided && tenantAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.tenantMatchMode ?? "contains");
  const accountIdAppliedMode: TextMatchMode =
    accountIdAppliedParsed.listProvided && accountIdAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.accountIdMatchMode ?? "contains");
  const accountNameAppliedMode: TextMatchMode =
    accountNameAppliedParsed.listProvided && accountNameAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.accountNameMatchMode ?? "contains");
  const fullNameAppliedMode: TextMatchMode =
    fullNameAppliedParsed.listProvided && fullNameAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.fullNameMatchMode ?? "contains");
  const emailAppliedMode: TextMatchMode = emailAppliedParsed.listProvided && emailAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.emailMatchMode ?? "contains");
  const tenantDraftMode: TextMatchMode = tenantDraftForcesExact ? "exact" : advancedDraft.tenantMatchMode;
  const accountIdDraftMode: TextMatchMode = accountIdDraftForcesExact ? "exact" : advancedDraft.accountIdMatchMode;
  const accountNameDraftMode: TextMatchMode = accountNameDraftForcesExact ? "exact" : advancedDraft.accountNameMatchMode;
  const fullNameDraftMode: TextMatchMode = fullNameDraftForcesExact ? "exact" : advancedDraft.fullNameMatchMode;
  const emailDraftMode: TextMatchMode = emailDraftForcesExact ? "exact" : advancedDraft.emailMatchMode;

  const tenantPending = tenantDraftValue !== tenantAppliedValue || (tenantDraftValue.length > 0 && tenantDraftMode !== tenantAppliedMode);
  const accountIdPending =
    accountIdDraftValue !== accountIdAppliedValue || (accountIdDraftValue.length > 0 && accountIdDraftMode !== accountIdAppliedMode);
  const accountNamePending =
    accountNameDraftValue !== accountNameAppliedValue || (accountNameDraftValue.length > 0 && accountNameDraftMode !== accountNameAppliedMode);
  const fullNamePending = fullNameDraftValue !== fullNameAppliedValue || (fullNameDraftValue.length > 0 && fullNameDraftMode !== fullNameAppliedMode);
  const emailPending = emailDraftValue !== emailAppliedValue || (emailDraftValue.length > 0 && emailDraftMode !== emailAppliedMode);

  const tenantFieldState = advancedFilterFieldHighlight(Boolean(tenantAppliedValue), tenantPending);
  const accountIdFieldState = advancedFilterFieldHighlight(Boolean(accountIdAppliedValue), accountIdPending);
  const accountNameFieldState = advancedFilterFieldHighlight(Boolean(accountNameAppliedValue), accountNamePending);
  const fullNameFieldState = advancedFilterFieldHighlight(Boolean(fullNameAppliedValue), fullNamePending);
  const emailFieldState = advancedFilterFieldHighlight(Boolean(emailAppliedValue), emailPending);

  const suspendedAppliedValue = advancedApplied?.suspended ?? "any";
  const suspendedDraftValue = advancedDraft.suspended;
  const suspendedPending = suspendedDraftValue !== suspendedAppliedValue;
  const suspendedFieldState = advancedFilterFieldHighlight(suspendedAppliedValue !== "any", suspendedPending);

  const numericRangeFields = useMemo<AdvancedNumericRangeField[]>(() => [
    { label: "Max buckets", minKey: "minMaxBuckets", maxKey: "maxMaxBuckets" },
    { label: "Quota bytes", minKey: "minQuotaBytes", maxKey: "maxQuotaBytes" },
    { label: "Quota objects", minKey: "minQuotaObjects", maxKey: "maxQuotaObjects" },
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
      states[key] = advancedFilterFieldHighlight(Boolean(applied), draft !== applied);
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
  const updateAdvancedMatchMode = (
    field:
      | "tenantMatchMode"
      | "accountIdMatchMode"
      | "accountNameMatchMode"
      | "fullNameMatchMode"
      | "emailMatchMode",
    value: TextMatchMode
  ) => {
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
      const label = formatTextFilterSummary("UID", searchValue, effectiveQuickFilterMode);
      if (label) items.push({ id: "quick", label, remove: { type: "quick" } });
    }
    if (advancedApplied && hasAdvancedFilters(advancedApplied, canViewMetrics)) {
      const tenantLabel = formatTextFilterSummary("Tenant", advancedApplied.tenant, tenantAppliedMode);
      if (tenantLabel) items.push({ id: "tenant", label: tenantLabel, remove: { type: "advanced", field: "tenant" } });
      const accountIdLabel = formatTextFilterSummary("Account ID", advancedApplied.accountId, accountIdAppliedMode);
      if (accountIdLabel) items.push({ id: "accountId", label: accountIdLabel, remove: { type: "advanced", field: "accountId" } });
      const accountNameLabel = formatTextFilterSummary("Account name", advancedApplied.accountName, accountNameAppliedMode);
      if (accountNameLabel) items.push({ id: "accountName", label: accountNameLabel, remove: { type: "advanced", field: "accountName" } });
      const fullNameLabel = formatTextFilterSummary("Full name", advancedApplied.fullName, fullNameAppliedMode);
      if (fullNameLabel) items.push({ id: "fullName", label: fullNameLabel, remove: { type: "advanced", field: "fullName" } });
      const emailLabel = formatTextFilterSummary("Email", advancedApplied.email, emailAppliedMode);
      if (emailLabel) items.push({ id: "email", label: emailLabel, remove: { type: "advanced", field: "email" } });
      if (advancedApplied.suspended !== "any") {
        items.push({
          id: "suspended",
          label: `Status: ${advancedApplied.suspended === "active" ? "Active" : "Suspended"}`,
          remove: { type: "advanced", field: "suspended" },
        });
      }
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
    tenantAppliedMode,
    accountIdAppliedMode,
    accountNameAppliedMode,
    fullNameAppliedMode,
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
    const tenantLabel = formatTextFilterSummary("Tenant", advancedDraft.tenant, tenantDraftMode);
    if (tenantLabel) items.push({ id: "draft-tenant", label: tenantLabel });
    const accountIdLabel = formatTextFilterSummary("Account ID", advancedDraft.accountId, accountIdDraftMode);
    if (accountIdLabel) items.push({ id: "draft-accountId", label: accountIdLabel });
    const accountNameLabel = formatTextFilterSummary("Account name", advancedDraft.accountName, accountNameDraftMode);
    if (accountNameLabel) items.push({ id: "draft-accountName", label: accountNameLabel });
    const fullNameLabel = formatTextFilterSummary("Full name", advancedDraft.fullName, fullNameDraftMode);
    if (fullNameLabel) items.push({ id: "draft-fullName", label: fullNameLabel });
    const emailLabel = formatTextFilterSummary("Email", advancedDraft.email, emailDraftMode);
    if (emailLabel) items.push({ id: "draft-email", label: emailLabel });
    if (advancedDraft.suspended !== "any") {
      items.push({
        id: "draft-suspended",
        label: `Status: ${advancedDraft.suspended === "active" ? "Active" : "Suspended"}`,
      });
    }
    items.push(
      ...buildNumericFilterSummaryItems(
        advancedDraft,
        canViewMetrics ? [...numericFields, ...usageNumericFields] : numericFields,
        "draft-",
      ).map(({ id, label }) => ({ id, label })),
    );
    return items;
  }, [
    advancedDraft,
    canViewMetrics,
    tenantDraftMode,
    accountIdDraftMode,
    accountNameDraftMode,
    fullNameDraftMode,
    emailDraftMode,
    numericFields,
    usageNumericFields,
  ]);

  const advancedDraftTextCount =
    Number(tenantDraftValue.length > 0) +
    Number(accountIdDraftValue.length > 0) +
    Number(accountNameDraftValue.length > 0) +
    Number(fullNameDraftValue.length > 0) +
    Number(emailDraftValue.length > 0) +
    Number(suspendedDraftValue !== "any");
  const advancedDraftDirectTextCount = Number(tenantDraftValue.length > 0);
  const advancedDraftEnrichedTextCount =
    Number(accountIdDraftValue.length > 0) +
    Number(accountNameDraftValue.length > 0) +
    Number(fullNameDraftValue.length > 0) +
    Number(emailDraftValue.length > 0) +
    Number(suspendedDraftValue !== "any");
  const advancedDraftNumericCount =
    numericFields.filter(({ key }) => (advancedDraft[key] as string).trim().length > 0).length +
    (canViewMetrics
      ? usageNumericFields.filter(({ key }) => (advancedDraft[key] as string).trim().length > 0).length
      : 0);
  const advancedDraftActiveCount = advancedDraftTextCount + advancedDraftNumericCount;
  const advancedDraftGlobalCostLevel: FilterCostLevel = useMemo(() => {
    if (advancedDraftNumericCount >= 4) return "high";
    if (advancedDraftNumericCount > 0) return "medium";
    if (advancedDraftEnrichedTextCount > 0) return "medium";
    if (advancedDraftDirectTextCount > 0) return "low";
    return "none";
  }, [advancedDraftDirectTextCount, advancedDraftEnrichedTextCount, advancedDraftNumericCount]);
  const advancedDraftGlobalCostTooltip = useMemo(() => {
    if (advancedDraftGlobalCostLevel === "high") {
      return `${FILTER_COST_LABEL.high}: many numeric filters are active and may increase stats processing.`;
    }
    if (advancedDraftGlobalCostLevel === "medium") {
      if (advancedDraftEnrichedTextCount > 0 && advancedDraftNumericCount === 0) {
        return `${FILTER_COST_LABEL.medium}: enriched identity/status filters require per-user detail lookups.`;
      }
      return `${FILTER_COST_LABEL.medium}: numeric filters are active and rely on limits/quota counters.`;
    }
    if (advancedDraftGlobalCostLevel === "low") {
      return `${FILTER_COST_LABEL.low}: direct metadata filters are active.`;
    }
    return FILTER_COST_LABEL.none;
  }, [advancedDraftEnrichedTextCount, advancedDraftGlobalCostLevel, advancedDraftNumericCount]);

  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const current = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !current.has(column));
  }, [visibleColumns]);

  const renderSuspended = (value?: boolean | null) => {
    if (value === null || value === undefined) {
      return <span className="ui-body text-slate-500 dark:text-slate-400">{loadingDetails ? "Loading..." : "-"}</span>;
    }
    return (
      <ListBadge
        disableToneStyles className={`${
          value
            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-100"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
        }`}
      >
        {value ? "Suspended" : "Active"}
      </ListBadge>
    );
  };

  const applyUpdatedUser = (updated: CephAdminRgwUserDetail) => {
    const updatedKey = String(updated.tenant ?? "") + ":" + updated.uid;
    updateEntity(updatedKey, (user) => ({
      ...user,
      account_id: updated.account_id ?? null,
      account_name: updated.account_name ?? null,
      full_name: updated.display_name ?? null,
      email: updated.email ?? null,
      suspended: updated.suspended ?? null,
      max_buckets: updated.max_buckets ?? null,
      quota_max_size_bytes: updated.quota?.max_size_bytes ?? null,
      quota_max_objects: updated.quota?.max_objects ?? null,
    }));
  };

  type ColumnDef = DataTableColumn<CephAdminRgwUser, SortField>;

  const detailPlaceholder = loadingDetails ? "Loading..." : "-";
  const activeRgwUserId = selectedEndpointAccess?.active_rgw_uid
    ? `${selectedEndpointAccess.active_rgw_tenant ? `${selectedEndpointAccess.active_rgw_tenant}$` : ""}${selectedEndpointAccess.active_rgw_uid}`
    : null;

  const userTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
      {
        id: "uid",
        label: "UID",
        field: "uid",
        primary: true,
        headerClassName: "min-w-[12rem] max-w-[20rem]",
        cellClassName: "min-w-[12rem] max-w-[20rem]",
        render: (user) => user.uid,
      },
    ];

    const visible = new Set(visibleColumns);
    if (visible.has("tenant")) {
      cols.push({
        id: "tenant",
        label: "Tenant",
        field: "tenant",
        headerClassName: "min-w-[10rem] max-w-[16rem]",
        cellClassName: "min-w-[10rem] max-w-[16rem]",
        render: (user) => user.tenant ?? "-",
      });
    }
    if (visible.has("account_name")) {
      cols.push({
        id: "account_name",
        label: "Account",
        field: "account_name",
        headerClassName: "min-w-[12rem] max-w-[18rem]",
        cellClassName: "min-w-[12rem] max-w-[18rem]",
        render: (user) => user.account_name ?? user.account_id ?? detailPlaceholder,
      });
    }
    if (visible.has("full_name")) {
      cols.push({
        id: "full_name",
        label: "Full name",
        field: "full_name",
        headerClassName: "min-w-[12rem] max-w-[18rem]",
        cellClassName: "min-w-[12rem] max-w-[18rem]",
        render: (user) => user.full_name ?? detailPlaceholder,
      });
    }
    if (visible.has("email")) {
      cols.push({
        id: "email",
        label: "Email",
        field: "email",
        headerClassName: "min-w-[14rem] max-w-[22rem]",
        cellClassName: "min-w-[14rem] max-w-[22rem]",
        render: (user) => user.email ?? detailPlaceholder,
      });
    }
    if (visible.has("suspended")) {
      cols.push({
        id: "suspended",
        label: "Suspended",
        field: "suspended",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (user) => renderSuspended(user.suspended),
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
        render: (user) => (user.max_buckets == null ? detailPlaceholder : formatNumber(user.max_buckets)),
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
        render: (user) => (user.quota_max_size_bytes == null ? detailPlaceholder : formatBytes(user.quota_max_size_bytes)),
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
        render: (user) => (user.quota_max_objects == null ? detailPlaceholder : formatNumber(user.quota_max_objects)),
      });
    }

    cols.push({
      id: "actions",
      label: "Act.",
      field: null,
      align: "right",
      mobileRole: "actions",
      headerClassName: "w-16",

      render: (user) => {
        const owner = bucketOwnerFilterForUser(user);
        const isActiveIdentity = owner === activeRgwUserId;
        return (
          <ListActions>
            <ListActionButton {...dataTableDefaultActionProps} onClick={() => setEditingTarget(user)}>
              Configure
            </ListActionButton>
            <UiActionMenu
              ariaLabel={`More actions for RGW user ${owner ?? user.uid}`}
              trigger={<span aria-hidden="true">⋮</span>}
              triggerClassName={tableCompactIconActionButtonClasses}
              sections={[
                { id: "navigation", items: [{
                  id: "owner-buckets",
                  label: "Owner buckets",
                  disabled: !owner,
                  disabledReason: "No RGW owner identity is available for this user.",
                  onSelect: () => { if (owner) navigate(`/ceph-admin/buckets?owner=${encodeURIComponent(owner)}`); },
                }] },
                { id: "destructive", items: [{
                  id: "delete",
                  label: "Delete user",
                  danger: true,
                  disabled: isActiveIdentity,
                  disabledReason: "The active Ceph Admin service identity cannot delete itself",
                  onSelect: () => { if (!isActiveIdentity) setDeletingTarget(user); },
                }] },
              ]}
            />
          </ListActions>
        );
      },
    });

    return cols;
  })();
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: items.length,
  });

  return (
    <div className={workflowPageHostClass(showCreateModal || Boolean(editingTarget))}>
      <PageHeader actionPresentation="listing"
        title="RGW Users"
        description="Complete list of RGW users (admin ops)."
        breadcrumbs={cephAdminPageBreadcrumbs("users")}
        actions={
          selectedEndpointId
            ? [
                {
                  label: "Create user",
                  onClick: () => setShowCreateModal(true),
                },
              ]
            : []
        }
      />
      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!selectedEndpointId ? (
        <PageEmptyState
          title="Select a Ceph endpoint before listing RGW users"
          description="RGW user administration is endpoint-scoped. Choose an endpoint to load users, filters, and identity details."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : (
        <ListPageSection
          variant="page"
          mobileSort={<TableSortControls columns={SORT_COLUMNS} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }} />}
            title="Users"
            countLabel={`${total} result(s)`}
            search={
              <ToolbarSearchTextarea
                label="Quick filter"
                value={filter}
                onChange={setFilter}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="UID(s)"
                inputClassName={quickFilterFieldState.fieldClass}
                trailingControl={
                  <button
                    type="button"
                    onClick={toggleQuickFilterMode}
                    disabled={quickFilterDraftForcesExact}
                    className={toolbarMatchModeButtonClasses(
                      quickFilterModeForDisplay,
                      quickFilterPending,
                      quickFilterDraftForcesExact
                    )}
                    title={formatQuickFilterMatchModeTitle(quickFilterModeForDisplay, quickFilterDraftForcesExact)}
                    aria-label="Toggle quick filter match mode"
                  >
                    {formatTextMatchModeSymbol(quickFilterModeForDisplay)}
                  </button>
                }
              />
            }
            filters={
              <button
                type="button"
                onClick={() => setShowAdvancedFilter(true)}
                className={advancedFilterToolbarButtonClass(showAdvancedFilter || advancedFilterActive)}
              >
                Advanced filter{advancedFilterActive ? " · Active" : ""}
              </button>
            }
            columns={
              <ColumnVisibilityMenu
                selectedCount={visibleColumns.length}
                onReset={resetColumns}
                resetDisabled={!columnsCustomized}
                coreGroups={USER_COLUMN_GROUPS.map((group) => ({
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
                    subtitle="RGW Users listing"
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
                              {[
                                {
                                  id: "tenant" as const,
                                  label: "Tenant",
                                  value: advancedDraft.tenant,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("tenantMatchMode", value),
                                  mode: tenantDraftMode,
                                  locked: tenantDraftForcesExact,
                                  fieldState: tenantFieldState,
                                  placeholder: "tenant-a, tenant-b",
                                  costLevel: "low" as const,
                                  costTooltip: "Low cost: tenant filters run on direct user metadata.",
                                },
                                {
                                  id: "accountId" as const,
                                  label: "Account ID",
                                  value: advancedDraft.accountId,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("accountIdMatchMode", value),
                                  mode: accountIdDraftMode,
                                  locked: accountIdDraftForcesExact,
                                  fieldState: accountIdFieldState,
                                  placeholder: "RGW123..., RGW456...",
                                  costLevel: "medium" as const,
                                  costTooltip: "Medium cost: account ID filters require per-user account details.",
                                },
                                {
                                  id: "accountName" as const,
                                  label: "Account name",
                                  value: advancedDraft.accountName,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("accountNameMatchMode", value),
                                  mode: accountNameDraftMode,
                                  locked: accountNameDraftForcesExact,
                                  fieldState: accountNameFieldState,
                                  placeholder: "Backup, Analytics",
                                  costLevel: "medium" as const,
                                  costTooltip: "Medium cost: account name filters require account lookups.",
                                },
                                {
                                  id: "fullName" as const,
                                  label: "Full name",
                                  value: advancedDraft.fullName,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("fullNameMatchMode", value),
                                  mode: fullNameDraftMode,
                                  locked: fullNameDraftForcesExact,
                                  fieldState: fullNameFieldState,
                                  placeholder: "John Doe",
                                  costLevel: "medium" as const,
                                  costTooltip: "Medium cost: full name filters require per-user profile lookups.",
                                },
                                {
                                  id: "email" as const,
                                  label: "Email",
                                  value: advancedDraft.email,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("emailMatchMode", value),
                                  mode: emailDraftMode,
                                  locked: emailDraftForcesExact,
                                  fieldState: emailFieldState,
                                  placeholder: "user@example.com",
                                  costLevel: "medium" as const,
                                  costTooltip: "Medium cost: email filters require per-user profile lookups.",
                                },
                              ].map((field) => (
                                <AdvancedFilterTextMatchField
                                  key={field.id}
                                  label={field.label}
                                  costLevel={field.costLevel}
                                  costTooltip={field.costTooltip}
                                  fieldState={field.fieldState}
                                  forcesExact={field.locked}
                                  matchMode={field.mode}
                                  onChange={(value) => updateAdvancedField(field.id, value)}
                                  onMatchModeChange={field.setMode}
                                  placeholder={field.placeholder}
                                  value={field.value}
                                />
                              ))}

                              <AdvancedFilterSelectField
                                label="Status"
                                costLevel="medium"
                                costTooltip="Medium cost: status filters require per-user status details."
                                fieldState={suspendedFieldState}
                                value={advancedDraft.suspended}
                                onChange={(value) => updateAdvancedField("suspended", value as AdvancedStatusFilter)}
                              >
                                <option value="any">Any</option>
                                <option value="active">Active</option>
                                <option value="suspended">Suspended</option>
                              </AdvancedFilterSelectField>
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
                                  costTooltip="Medium cost: numeric filters rely on limits/quota counters."
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
            columns={userTableColumns}
            rows={items}
            rowKey={rowKey}
            status={tableStatus}
            loadingMessage="Loading users..."
            errorMessage="Unable to load users."
            emptyMessage="No users."
            primaryColumnId="uid"
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

      {selectedEndpointId && editingTarget && (
        <CephAdminUserEditModal
          endpointId={selectedEndpointId}
          endpointUrl={selectedEndpoint?.endpoint_url ?? null}
          uid={editingTarget.uid}
          tenant={editingTarget.tenant}
          canViewMetrics={canViewMetrics}
          onClose={() => setEditingTarget(null)}
          onSaved={applyUpdatedUser}
        />
      )}
      {selectedEndpointId && showCreateModal && (
        <CephAdminUserCreateModal
          endpointId={selectedEndpointId}
          endpointUrl={selectedEndpoint?.endpoint_url ?? null}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setReloadNonce((prev) => prev + 1);
          }}
        />
      )}
      {selectedEndpointId && deletingTarget && (
        <CephAdminAdminOpsModal
          endpointId={selectedEndpointId}
          endpointName={selectedEndpoint?.name}
          action={{ kind: "delete-user", user: deletingTarget }}
          canAccounts={Boolean(selectedEndpointAccess?.can_accounts)}
          onClose={() => setDeletingTarget(null)}
          onSuccess={() => setReloadNonce((prev) => prev + 1)}
        />
      )}
      {advancedFilterCloseGuard.confirmationDialog}
    </div>
  );
}
