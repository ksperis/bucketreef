/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ToolbarSearchTextarea } from "../../components/ToolbarSearchInput";
import { ToolbarAdvancedFilterButton, ToolbarMatchModeButton } from "../../components/ToolbarFilterControls";
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
  buildNumericFilterFields,
  buildNumericFilterFieldStates,
  buildNumericFilterSummaryItems,
  numericFilterRangeFieldHighlight,
  type NumericFilterRangeField,
} from "./filtering/advancedFilterModel";
import { useCephAdminListingFilters } from "./filtering/useCephAdminListingFilters";
import { useCephAdminEntityListing } from "./listing/useCephAdminEntityListing";
import {
  loadCephAdminVisibleColumns,
  persistCephAdminVisibleColumns,
  resolveCephAdminQuickFilterState,
} from "./listing/cephAdminListingViewState";
import { formatBytes, formatNumber } from "../../utils/format";
import { nextSortState } from "../../utils/sortValues";
import { useCephAdminI18n } from "./cephAdminI18n";
import { useCephAdminUserConfigurationNavigation } from "./useCephAdminEntityConfigurationNavigation";

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
const USER_COLUMN_IDS = USER_COLUMN_GROUPS.flatMap((group) => group.options.map((option) => option.id));

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

const rowKey = (user: CephAdminRgwUser) => `${user.tenant ?? ""}:${user.uid}`;
const bucketOwnerFilterForUser = (user: CephAdminRgwUser) => {
  const uid = user.uid.trim();
  if (!uid) return null;
  const tenant = (user.tenant ?? "").trim();
  return tenant ? `${tenant}$${uid}` : uid;
};

export default function CephAdminUsersPage() {
  const { text: surfaceText } = useCephAdminI18n();
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint, selectedEndpointAccess } = useCephAdminEndpoint();
  const canViewMetrics = Boolean(selectedEndpointAccess?.can_metrics) && (selectedEndpoint?.capabilities?.metrics !== false);
  const [deletingTarget, setDeletingTarget] = useState<CephAdminRgwUser | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>(DEFAULT_SORT);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() =>
    loadCephAdminVisibleColumns(COLUMNS_STORAGE_KEY, USER_COLUMN_IDS, defaultVisibleColumns),
  );
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
    persistCephAdminVisibleColumns(COLUMNS_STORAGE_KEY, visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    setSort(DEFAULT_SORT);
    setShowCreateModal(false);
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

  const {
    active: quickFilterActive,
    appliedParsed: quickFilterAppliedParsed,
    draftForcesExact: quickFilterDraftForcesExact,
    effectiveMode: effectiveQuickFilterMode,
    effectiveSearchValue,
    fieldState: quickFilterFieldState,
    modeForDisplay: quickFilterModeForDisplay,
    pending: quickFilterPending,
  } = resolveCephAdminQuickFilterState(filter, searchValue, quickFilterMode);
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
  const accountScopeLoaded = includeParams.includes("account") && !loadingDetails;
  const {
    closeConfiguration,
    configurationNavigation,
    configurationTarget,
    openConfiguration,
    viewedRowKey,
  } = useCephAdminUserConfigurationNavigation({
    items,
    selectedEndpointId,
    accountScopeLoaded,
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

  const numericRangeFields = useMemo<NumericFilterRangeField<AdvancedNumericField>[]>(() => [
    { label: surfaceText("Max buckets"), minKey: "minMaxBuckets", maxKey: "maxMaxBuckets" },
    { label: surfaceText("Quota bytes"), minKey: "minQuotaBytes", maxKey: "maxQuotaBytes" },
    { label: surfaceText("Quota objects"), minKey: "minQuotaObjects", maxKey: "maxQuotaObjects" },
  ], [surfaceText]);
  const usageNumericRangeFields = useMemo<NumericFilterRangeField<AdvancedNumericField>[]>(() => [
    { label: surfaceText("Quota usage size %"), minKey: "minQuotaUsageSizePercent", maxKey: "maxQuotaUsageSizePercent" },
    { label: surfaceText("Quota usage objects %"), minKey: "minQuotaUsageObjectPercent", maxKey: "maxQuotaUsageObjectPercent" },
  ], [surfaceText]);
  const numericFields = useMemo(
    () => buildNumericFilterFields(numericRangeFields),
    [numericRangeFields],
  );
  const usageNumericFields = useMemo(
    () => buildNumericFilterFields(usageNumericRangeFields, "percent"),
    [usageNumericRangeFields],
  );
  const numericFieldStates = useMemo(
    () => buildNumericFilterFieldStates(advancedDraft, advancedApplied, [...numericFields, ...usageNumericFields]),
    [advancedDraft, advancedApplied, numericFields, usageNumericFields],
  );
  const numericRangeFieldState = (minKey: AdvancedNumericField, maxKey: AdvancedNumericField) =>
    numericFilterRangeFieldHighlight(advancedDraft, advancedApplied, minKey, maxKey);

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
  const activeFilterSummaryItems = useMemo(() => {
    const items: ActiveFilterSummaryItem[] = [];
    if (quickFilterActive) {
      const label = formatTextFilterSummary(surfaceText("UID"), searchValue, effectiveQuickFilterMode);
      if (label) items.push({ id: "quick", label, remove: { type: "quick" } });
    }
    if (advancedApplied && hasAdvancedFilters(advancedApplied, canViewMetrics)) {
      const tenantLabel = formatTextFilterSummary(surfaceText("Tenant"), advancedApplied.tenant, tenantAppliedMode);
      if (tenantLabel) items.push({ id: "tenant", label: tenantLabel, remove: { type: "advanced", field: "tenant" } });
      const accountIdLabel = formatTextFilterSummary(surfaceText("Account ID"), advancedApplied.accountId, accountIdAppliedMode);
      if (accountIdLabel) items.push({ id: "accountId", label: accountIdLabel, remove: { type: "advanced", field: "accountId" } });
      const accountNameLabel = formatTextFilterSummary(surfaceText("Account name"), advancedApplied.accountName, accountNameAppliedMode);
      if (accountNameLabel) items.push({ id: "accountName", label: accountNameLabel, remove: { type: "advanced", field: "accountName" } });
      const fullNameLabel = formatTextFilterSummary(surfaceText("Full name"), advancedApplied.fullName, fullNameAppliedMode);
      if (fullNameLabel) items.push({ id: "fullName", label: fullNameLabel, remove: { type: "advanced", field: "fullName" } });
      const emailLabel = formatTextFilterSummary(surfaceText("Email"), advancedApplied.email, emailAppliedMode);
      if (emailLabel) items.push({ id: "email", label: emailLabel, remove: { type: "advanced", field: "email" } });
      if (advancedApplied.suspended !== "any") {
        items.push({
          id: "suspended",
          label: `${surfaceText("Status")}: ${advancedApplied.suspended === "active" ? surfaceText("Active") : surfaceText("Suspended")}`,
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
    surfaceText,
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
    const tenantLabel = formatTextFilterSummary(surfaceText("Tenant"), advancedDraft.tenant, tenantDraftMode);
    if (tenantLabel) items.push({ id: "draft-tenant", label: tenantLabel });
    const accountIdLabel = formatTextFilterSummary(surfaceText("Account ID"), advancedDraft.accountId, accountIdDraftMode);
    if (accountIdLabel) items.push({ id: "draft-accountId", label: accountIdLabel });
    const accountNameLabel = formatTextFilterSummary(surfaceText("Account name"), advancedDraft.accountName, accountNameDraftMode);
    if (accountNameLabel) items.push({ id: "draft-accountName", label: accountNameLabel });
    const fullNameLabel = formatTextFilterSummary(surfaceText("Full name"), advancedDraft.fullName, fullNameDraftMode);
    if (fullNameLabel) items.push({ id: "draft-fullName", label: fullNameLabel });
    const emailLabel = formatTextFilterSummary(surfaceText("Email"), advancedDraft.email, emailDraftMode);
    if (emailLabel) items.push({ id: "draft-email", label: emailLabel });
    if (advancedDraft.suspended !== "any") {
      items.push({
        id: "draft-suspended",
        label: `${surfaceText("Status")}: ${advancedDraft.suspended === "active" ? surfaceText("Active") : surfaceText("Suspended")}`,
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
    surfaceText,
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
      return surfaceText("High cost: many numeric filters are active and may increase stats processing.");
    }
    if (advancedDraftGlobalCostLevel === "medium") {
      if (advancedDraftEnrichedTextCount > 0 && advancedDraftNumericCount === 0) {
        return surfaceText("Medium cost: enriched identity/status filters require per-user detail lookups.");
      }
      return surfaceText("Medium cost: numeric filters are active and rely on limits/quota counters.");
    }
    if (advancedDraftGlobalCostLevel === "low") {
      return surfaceText("Low cost: direct metadata filters are active.");
    }
    return surfaceText("No additional filter cost.");
  }, [advancedDraftEnrichedTextCount, advancedDraftGlobalCostLevel, advancedDraftNumericCount, surfaceText]);

  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const current = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !current.has(column));
  }, [visibleColumns]);

  const renderSuspended = (value?: boolean | null) => {
    if (value === null || value === undefined) {
      return <span className="ui-body text-slate-500 dark:text-slate-400">{loadingDetails ? surfaceText("Loading...") : "-"}</span>;
    }
    return (
      <ListBadge
        disableToneStyles className={`${
          value
            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-100"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
        }`}
      >
        {value ? surfaceText("Suspended") : surfaceText("Active")}
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

  const detailPlaceholder = loadingDetails ? surfaceText("Loading...") : "-";
  const activeRgwUserId = selectedEndpointAccess?.active_rgw_uid
    ? `${selectedEndpointAccess.active_rgw_tenant ? `${selectedEndpointAccess.active_rgw_tenant}$` : ""}${selectedEndpointAccess.active_rgw_uid}`
    : null;

  const userTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
      {
        id: "uid",
        label: surfaceText("UID"),
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
        label: surfaceText("Tenant"),
        field: "tenant",
        headerClassName: "min-w-[10rem] max-w-[16rem]",
        cellClassName: "min-w-[10rem] max-w-[16rem]",
        render: (user) => user.tenant ?? "-",
      });
    }
    if (visible.has("account_name")) {
      cols.push({
        id: "account_name",
        label: surfaceText("Account"),
        field: "account_name",
        headerClassName: "min-w-[12rem] max-w-[18rem]",
        cellClassName: "min-w-[12rem] max-w-[18rem]",
        render: (user) => user.account_name ?? user.account_id ?? detailPlaceholder,
      });
    }
    if (visible.has("full_name")) {
      cols.push({
        id: "full_name",
        label: surfaceText("Full name"),
        field: "full_name",
        headerClassName: "min-w-[12rem] max-w-[18rem]",
        cellClassName: "min-w-[12rem] max-w-[18rem]",
        render: (user) => user.full_name ?? detailPlaceholder,
      });
    }
    if (visible.has("email")) {
      cols.push({
        id: "email",
        label: surfaceText("Email"),
        field: "email",
        headerClassName: "min-w-[14rem] max-w-[22rem]",
        cellClassName: "min-w-[14rem] max-w-[22rem]",
        render: (user) => user.email ?? detailPlaceholder,
      });
    }
    if (visible.has("suspended")) {
      cols.push({
        id: "suspended",
        label: surfaceText("Suspended"),
        field: "suspended",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (user) => renderSuspended(user.suspended),
      });
    }
    if (visible.has("max_buckets")) {
      cols.push({
        id: "max_buckets",
        label: surfaceText("Max buckets"),
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
        label: surfaceText("Quota (size)"),
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
        label: surfaceText("Quota (objects)"),
        field: "quota_max_objects",
        align: "right",
        headerClassName: "min-w-[10rem]",
        cellClassName: "min-w-[10rem]",
        render: (user) => (user.quota_max_objects == null ? detailPlaceholder : formatNumber(user.quota_max_objects)),
      });
    }

    cols.push({
      id: "actions",
      label: surfaceText("Act."),
      field: null,
      align: "right",
      mobileRole: "actions",
      headerClassName: "w-16",

      render: (user) => {
        const owner = bucketOwnerFilterForUser(user);
        const isActiveIdentity = owner === activeRgwUserId;
        return (
          <ListActions>
            <ListActionButton
              {...dataTableDefaultActionProps}
              data-ceph-admin-configure-row-key={rowKey(user)}
              aria-current={viewedRowKey === rowKey(user) ? "true" : undefined}
              onClick={() => openConfiguration(user)}
            >
              {surfaceText("Configure")}</ListActionButton>
            <UiActionMenu
              ariaLabel={surfaceText("More actions for RGW user {uid}", { uid: owner ?? user.uid })}
              trigger={<span aria-hidden="true">⋮</span>}
              triggerClassName={tableCompactIconActionButtonClasses}
              sections={[
                { id: "navigation", items: [{
                  id: "owner-buckets",
                  label: surfaceText("Owner buckets"),
                  disabled: !owner,
                  disabledReason: surfaceText("No RGW owner identity is available for this user."),
                  onSelect: () => { if (owner) navigate(`/ceph-admin/buckets?owner=${encodeURIComponent(owner)}`); },
                }] },
                { id: "destructive", items: [{
                  id: "delete",
                  label: surfaceText("Delete user"),
                  danger: true,
                  disabled: isActiveIdentity,
                  disabledReason: surfaceText("The active Ceph Admin service identity cannot delete itself"),
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
    <div className={workflowPageHostClass(showCreateModal)}>
      <PageHeader actionPresentation="listing"
        title={surfaceText("RGW Users")}
        description={surfaceText("Complete list of RGW users (admin ops).")}
        breadcrumbs={cephAdminPageBreadcrumbs("users")}
        actions={
          selectedEndpointId
            ? [
                {
                  label: surfaceText("Create user"),
                  onClick: () => setShowCreateModal(true),
                },
              ]
            : []
        }
      />
      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!selectedEndpointId ? (
        <PageEmptyState
          title={surfaceText("Select a Ceph endpoint before listing RGW users")}
          description={surfaceText("RGW user administration is endpoint-scoped. Choose an endpoint to load users, filters, and identity details.")}
          primaryAction={{ label: surfaceText("Return to Ceph Admin"), to: "/ceph-admin" }}
          tone="warning"
        />
      ) : (
        <ListPageSection
          variant="page"
          mobileSort={<TableSortControls columns={SORT_COLUMNS.map((column) => ({ ...column, label: surfaceText(column.label) }))} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }} />}
            title={surfaceText("Users")}
            countLabel={surfaceText(total === 1 ? "{count} result" : "{count} results", { count: total })}
            search={
              <ToolbarSearchTextarea
                label={surfaceText("Quick filter")}
                value={filter}
                onChange={setFilter}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder={surfaceText("UID(s)")}
                inputClassName={quickFilterFieldState.fieldClass}
                trailingControl={
                  <ToolbarMatchModeButton
                    mode={quickFilterModeForDisplay}
                    pending={quickFilterPending}
                    locked={quickFilterDraftForcesExact}
                    onClick={toggleQuickFilterMode}
                    aria-label={surfaceText("Toggle quick filter match mode")}
                  />
                }
              />
            }
            filters={
              <ToolbarAdvancedFilterButton
                active={showAdvancedFilter || advancedFilterActive}
                onClick={() => setShowAdvancedFilter(true)}
              >
                {surfaceText("Advanced filter")}{advancedFilterActive ? ` · ${surfaceText("Active")}` : ""}
              </ToolbarAdvancedFilterButton>
            }
            columns={
              <ColumnVisibilityMenu
                selectedCount={visibleColumns.length}
                onReset={resetColumns}
                resetDisabled={!columnsCustomized}
                coreGroups={USER_COLUMN_GROUPS.map((group) => ({
                  id: group.id,
                  label: surfaceText(group.label),
                  options: group.options.map((option) => ({
                    id: option.id,
                    label: surfaceText(option.label),
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
                          removeLabel: surfaceText("Remove {label}", { label: item.label }),
                        }))
                      : []
                  }
                  onClearAll={resetAllFilters}
                />

                {showAdvancedFilter && (
                  <AdvancedFilterDrawerShell
                    title={surfaceText("Advanced filter")}
                    subtitle={surfaceText("RGW Users listing")}
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
                          {surfaceText("Clear")}</ListActionButton>
                        <ListActionButton variant="primary" onClick={applyAdvancedFilter}>
                          {surfaceText("Apply filter")}</ListActionButton>
                      </div>
                    }
                  >
                    <div className="space-y-4">
                          {renderAdvancedFilterDraftSummary(advancedDraftSummaryItems)}

                          <section className={advancedFilterSectionClass}>
                            <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {surfaceText("Identity")}</p>
                            <div className="grid gap-3 md:grid-cols-2">
                              {[
                                {
                                  id: "tenant" as const,
                                  label: surfaceText("Tenant"),
                                  value: advancedDraft.tenant,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("tenantMatchMode", value),
                                  mode: tenantDraftMode,
                                  locked: tenantDraftForcesExact,
                                  fieldState: tenantFieldState,
                                  placeholder: "tenant-a, tenant-b",
                                  costLevel: "low" as const,
                                  costTooltip: surfaceText("Low cost: tenant filters run on direct user metadata."),
                                },
                                {
                                  id: "accountId" as const,
                                  label: surfaceText("Account ID"),
                                  value: advancedDraft.accountId,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("accountIdMatchMode", value),
                                  mode: accountIdDraftMode,
                                  locked: accountIdDraftForcesExact,
                                  fieldState: accountIdFieldState,
                                  placeholder: "RGW123..., RGW456...",
                                  costLevel: "medium" as const,
                                  costTooltip: surfaceText("Medium cost: account ID filters require per-user account details."),
                                },
                                {
                                  id: "accountName" as const,
                                  label: surfaceText("Account name"),
                                  value: advancedDraft.accountName,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("accountNameMatchMode", value),
                                  mode: accountNameDraftMode,
                                  locked: accountNameDraftForcesExact,
                                  fieldState: accountNameFieldState,
                                  placeholder: "Backup, Analytics",
                                  costLevel: "medium" as const,
                                  costTooltip: surfaceText("Medium cost: account name filters require account lookups."),
                                },
                                {
                                  id: "fullName" as const,
                                  label: surfaceText("Full name"),
                                  value: advancedDraft.fullName,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("fullNameMatchMode", value),
                                  mode: fullNameDraftMode,
                                  locked: fullNameDraftForcesExact,
                                  fieldState: fullNameFieldState,
                                  placeholder: "John Doe",
                                  costLevel: "medium" as const,
                                  costTooltip: surfaceText("Medium cost: full name filters require per-user profile lookups."),
                                },
                                {
                                  id: "email" as const,
                                  label: surfaceText("Email"),
                                  value: advancedDraft.email,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("emailMatchMode", value),
                                  mode: emailDraftMode,
                                  locked: emailDraftForcesExact,
                                  fieldState: emailFieldState,
                                  placeholder: "user@example.com",
                                  costLevel: "medium" as const,
                                  costTooltip: surfaceText("Medium cost: email filters require per-user profile lookups."),
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
                                label={surfaceText("Status")}
                                costLevel="medium"
                                costTooltip={surfaceText("Medium cost: status filters require per-user status details.")}
                                fieldState={suspendedFieldState}
                                value={advancedDraft.suspended}
                                onChange={(value) => updateAdvancedField("suspended", value as AdvancedStatusFilter)}
                              >
                                <option value="any">{surfaceText("Any")}</option>
                                <option value="active">{surfaceText("Active")}</option>
                                <option value="suspended">{surfaceText("Suspended")}</option>
                              </AdvancedFilterSelectField>
                            </div>
                          </section>

                          <section className={advancedFilterSectionClass}>
                            <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {surfaceText("Limits and Quotas")}</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {numericRangeFields.map((field) => (
                                <AdvancedFilterNumberRangeField
                                  key={`${field.minKey}:${field.maxKey}`}
                                  label={field.label}
                                  costLevel="medium"
                                  costTooltip={surfaceText("Medium cost: numeric filters rely on limits/quota counters.")}
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
                                  {surfaceText("Quota usage %")}</p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {usageNumericRangeFields.map((field) => (
                                    <AdvancedFilterNumberRangeField
                                      key={`${field.minKey}:${field.maxKey}`}
                                      label={field.label}
                                      costLevel="medium"
                                      costTooltip={surfaceText("Medium cost: usage percentage filters require bucket metrics aggregation.")}
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
            rowClassName="ui-current-item"
            rowAttributes={(user) => ({
              "data-viewed": viewedRowKey === rowKey(user) || undefined,
            })}
            status={tableStatus}
            loadingMessage="Loading users..."
            errorMessage="Unable to load users."
            emptyMessage={quickFilterActive || advancedFilterActive
              ? surfaceText("No users match the current filters.")
              : surfaceText("No users.")}
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

      {selectedEndpointId && configurationTarget && (
        <CephAdminUserEditModal
          endpointId={selectedEndpointId}
          endpointUrl={selectedEndpoint?.endpoint_url ?? null}
          uid={configurationTarget.uid}
          tenant={configurationTarget.tenant}
          expectedAccountId={configurationTarget.expectedAccountId}
          canViewMetrics={canViewMetrics}
          navigation={configurationNavigation}
          onClose={closeConfiguration}
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
