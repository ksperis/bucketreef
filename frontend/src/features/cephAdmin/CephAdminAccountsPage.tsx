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
  advancedFilterSectionClass,
  advancedFilterSyncBadgeClass,
  buildQuickTextFilterRules,
  buildTextFieldRules,
  formatAdvancedFilterSyncLabel,
  formatTextFilterSummary,
  resolveTextFilterFieldState,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterCostBadge,
  renderAdvancedFilterRuleCountBadge,
  renderAdvancedSearchProgress,
  serializeAdvancedFilterRules,
  shouldShowActiveFilterSummary,
  type FilterCostLevel,
  type TextMatchMode,
} from "../shared/advancedFilterShared";
import {
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
  resolveCephAdminQuickFilterState,
} from "./listing/cephAdminListingViewState";
import { useCephAdminListingTableState } from "./listing/useCephAdminListingTableState";
import { formatBytes, formatNumber } from "../../utils/format";
import { useCephAdminI18n } from "./cephAdminI18n";
import { useCephAdminAccountConfigurationNavigation } from "./useCephAdminEntityConfigurationNavigation";
import {
  appendQuotaAdvancedFilterRules,
  defaultQuotaAdvancedFilter,
  hasQuotaAdvancedFilters,
  type QuotaAdvancedFilterState,
  type QuotaAdvancedNumericField,
} from "../shared/quotaAdvancedFilterModel";

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

type AdvancedFilterState = QuotaAdvancedFilterState & {
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

type AdvancedTextField = "accountName" | "email";
type AdvancedNumericField =
  | "minMaxUsers"
  | "maxMaxUsers"
  | "minMaxBuckets"
  | "maxMaxBuckets"
  | QuotaAdvancedNumericField
  | "minBucketCount"
  | "maxBucketCount"
  | "minUserCount"
  | "maxUserCount";
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
const ACCOUNT_COLUMN_IDS = ACCOUNT_COLUMN_GROUPS.flatMap((group) => group.options.map((option) => option.id));

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
  ...defaultQuotaAdvancedFilter,
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
      hasQuotaAdvancedFilters(advanced, allowUsageFilters) ||
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

const rowKey = (account: CephAdminRgwAccount) => account.account_id;

export default function CephAdminAccountsPage() {
  const { text: surfaceText } = useCephAdminI18n();
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint, selectedEndpointAccess } = useCephAdminEndpoint();
  const canViewMetrics = Boolean(selectedEndpointAccess?.can_metrics) && (selectedEndpoint?.capabilities?.metrics !== false);
  const {
    page,
    setPage,
    pageSize,
    sort,
    visibleColumns,
    toggleColumn,
    resetColumns,
    toggleSort,
    changePageSize,
    resetSort,
    resetPageSize,
    columnsCustomized,
  } = useCephAdminListingTableState<ColumnId, SortField>({
    storageKey: COLUMNS_STORAGE_KEY,
    allowedColumns: ACCOUNT_COLUMN_IDS,
    defaultVisibleColumns,
    defaultSort: DEFAULT_SORT,
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
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
    resetPageSize();
    resetSort();
    setShowCreateModal(false);
  }, [resetPageSize, resetSort, selectedEndpointId]);

  const includeParams = useMemo(() => {
    const include = new Set<string>();
    // Base listing response is already enriched with profile/limits/quota values.
    // Request extra enrichment only for live stats fields.
    if (visibleColumns.includes("bucket_count") || visibleColumns.includes("user_count")) include.add("stats");
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
  const {
    closeConfiguration,
    configurationNavigation,
    configurationTarget,
    openConfiguration,
    viewedRowKey,
  } = useCephAdminAccountConfigurationNavigation({
    items,
    selectedEndpointId,
  });

  const accountNameFilter = resolveTextFilterFieldState({
    draftValue: advancedDraft.accountName,
    draftMode: advancedDraft.accountNameMatchMode,
    appliedValue: advancedApplied?.accountName,
    appliedMode: advancedApplied?.accountNameMatchMode,
  });
  const emailFilter = resolveTextFilterFieldState({
    draftValue: advancedDraft.email,
    draftMode: advancedDraft.emailMatchMode,
    appliedValue: advancedApplied?.email,
    appliedMode: advancedApplied?.emailMatchMode,
  });

  const numericRangeFields = useMemo<NumericFilterRangeField<AdvancedNumericField>[]>(() => [
    { label: surfaceText("Max users"), minKey: "minMaxUsers", maxKey: "maxMaxUsers" },
    { label: surfaceText("Max buckets"), minKey: "minMaxBuckets", maxKey: "maxMaxBuckets" },
    { label: surfaceText("Quota bytes"), minKey: "minQuotaBytes", maxKey: "maxQuotaBytes" },
    { label: surfaceText("Quota objects"), minKey: "minQuotaObjects", maxKey: "maxQuotaObjects" },
    { label: surfaceText("Bucket count"), minKey: "minBucketCount", maxKey: "maxBucketCount" },
    { label: surfaceText("User count"), minKey: "minUserCount", maxKey: "maxUserCount" },
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
  const activeFilterSummaryItems = useMemo(() => {
    const items: ActiveFilterSummaryItem[] = [];
    if (quickFilterActive) {
      const label = formatTextFilterSummary(surfaceText("Account ID"), searchValue, effectiveQuickFilterMode);
      if (label) items.push({ id: "quick", label, remove: { type: "quick" } });
    }
    if (advancedApplied && hasAdvancedFilters(advancedApplied, canViewMetrics)) {
      const accountNameLabel = formatTextFilterSummary(surfaceText("Account name"), advancedApplied.accountName, accountNameFilter.appliedMode);
      if (accountNameLabel) items.push({ id: "accountName", label: accountNameLabel, remove: { type: "advanced", field: "accountName" } });
      const emailLabel = formatTextFilterSummary(surfaceText("Email"), advancedApplied.email, emailFilter.appliedMode);
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
    accountNameFilter.appliedMode,
    emailFilter.appliedMode,
    numericFields,
    usageNumericFields,
    surfaceText,
  ]);
  const showActiveFiltersCard = shouldShowActiveFilterSummary({
    itemCount: activeFilterSummaryItems.length,
    quickFilterActive,
    hasNonQuickFilters: advancedFilterActive,
    quickFilterListProvided: quickFilterAppliedParsed.listProvided,
  });

  const advancedDraftSummaryItems = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    const accountNameLabel = formatTextFilterSummary(surfaceText("Account name"), advancedDraft.accountName, accountNameFilter.draftMode);
    if (accountNameLabel) items.push({ id: "draft-accountName", label: accountNameLabel });
    const emailLabel = formatTextFilterSummary(surfaceText("Email"), advancedDraft.email, emailFilter.draftMode);
    if (emailLabel) items.push({ id: "draft-email", label: emailLabel });
    items.push(
      ...buildNumericFilterSummaryItems(
        advancedDraft,
        canViewMetrics ? [...numericFields, ...usageNumericFields] : numericFields,
        "draft-",
      ).map(({ id, label }) => ({ id, label })),
    );
    return items;
  }, [advancedDraft, accountNameFilter.draftMode, emailFilter.draftMode, numericFields, canViewMetrics, usageNumericFields, surfaceText]);

  const advancedDraftTextCount =
    Number(accountNameFilter.draftValue.length > 0) +
    Number(emailFilter.draftValue.length > 0);
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
      return surfaceText("High cost: many numeric filters are active and may require heavier stats filtering.");
    }
    if (advancedDraftGlobalCostLevel === "medium") {
      if (advancedDraftTextCount > 0 && advancedDraftNumericCount === 0) {
        return surfaceText("Medium cost: account profile filters may require per-account detail lookups.");
      }
      return surfaceText("Medium cost: numeric filters are active and rely on usage/quota counters.");
    }
    return surfaceText("No additional filter cost.");
  }, [advancedDraftGlobalCostLevel, advancedDraftNumericCount, advancedDraftTextCount, surfaceText]);

  const detailPlaceholder = loadingDetails ? surfaceText("Loading...") : "-";

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
        label: surfaceText("Account ID"),
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
        label: surfaceText("Name"),
        field: "account_name",
        headerClassName: "min-w-[12rem] max-w-[18rem]",
        cellClassName: "min-w-[12rem] max-w-[18rem]",
        render: (account) => account.account_name ?? detailPlaceholder,
      });
    }
    if (visible.has("email")) {
      cols.push({
        id: "email",
        label: surfaceText("Email"),
        field: "email",
        headerClassName: "min-w-[14rem] max-w-[22rem]",
        cellClassName: "min-w-[14rem] max-w-[22rem]",
        render: (account) => account.email ?? detailPlaceholder,
      });
    }
    if (visible.has("max_users")) {
      cols.push({
        id: "max_users",
        label: surfaceText("Max users"),
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
        label: surfaceText("Max buckets"),
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
        label: surfaceText("Quota (size)"),
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
        label: surfaceText("Quota (objects)"),
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
        label: surfaceText("Buckets"),
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
        label: surfaceText("Users"),
        field: "user_count",
        align: "right",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (account) => (account.user_count == null ? detailPlaceholder : formatNumber(account.user_count)),
      });
    }

    cols.push({
      id: "actions",
      label: surfaceText("Act."),
      field: null,
      align: "right",
      mobileRole: "actions",
      headerClassName: "w-16",
      cellClassName: "!py-1.5",
      render: (account) => (
        <ListActions>
          <ListActionButton
            {...dataTableDefaultActionProps}
            data-ceph-admin-configure-row-key={rowKey(account)}
            aria-current={viewedRowKey === rowKey(account) ? "true" : undefined}
            onClick={() => openConfiguration(account)}
          >
            {surfaceText("Configure")}</ListActionButton>
          <UiActionMenu
            ariaLabel={surfaceText("More actions for RGW account {id}", { id: account.account_id })}
            trigger={<span aria-hidden="true">⋮</span>}
            triggerClassName={tableCompactIconActionButtonClasses}
            sections={[
              { id: "navigation", items: [{
                id: "owner-buckets",
                label: surfaceText("Owner buckets"),
                onSelect: () => navigate(`/ceph-admin/buckets?owner=${encodeURIComponent(account.account_id)}`),
              }] },
              { id: "destructive", items: [{
                id: "delete",
                label: surfaceText("Delete account"),
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
    <div className={workflowPageHostClass(showCreateModal)}>
      <PageHeader actionPresentation="listing"
        title={surfaceText("RGW Accounts")}
        description={surfaceText("Complete list of RGW accounts (admin ops).")}
        breadcrumbs={cephAdminPageBreadcrumbs("accounts")}
        actions={
          selectedEndpointId
            ? [
                {
                  label: surfaceText("Create account"),
                  onClick: () => setShowCreateModal(true),
                },
              ]
            : []
        }
      />
      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!selectedEndpointId ? (
        <PageEmptyState
          title={surfaceText("Select a Ceph endpoint before listing RGW accounts")}
          description={surfaceText("RGW account administration is endpoint-scoped. Choose an endpoint to load account inventory, quotas, and owner navigation.")}
          primaryAction={{ label: surfaceText("Return to Ceph Admin"), to: "/ceph-admin" }}
          tone="warning"
        />
      ) : (
        <ListPageSection
          variant="page"
          mobileSort={<TableSortControls columns={SORT_COLUMNS.map((column) => ({ ...column, label: surfaceText(column.label) }))} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }} />}
            title={surfaceText("Accounts")}
            countLabel={surfaceText(total === 1 ? "{count} result" : "{count} results", { count: total })}
            search={
              <ToolbarSearchTextarea
                label={surfaceText("Quick filter")}
                value={filter}
                onChange={setFilter}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder={surfaceText("Account ID(s)")}
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
                coreGroups={ACCOUNT_COLUMN_GROUPS.map((group) => ({
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
                    subtitle={surfaceText("RGW Accounts listing")}
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
                              <AdvancedFilterTextMatchField
                                label={surfaceText("Account name")}
                                costLevel="medium"
                                costTooltip={surfaceText("Medium cost: account name filters may require per-account profile lookups.")}
                                fieldState={accountNameFilter.fieldState}
                                forcesExact={accountNameFilter.draftForcesExact}
                                matchMode={accountNameFilter.draftMode}
                                onChange={(value) => updateAdvancedField("accountName", value)}
                                onMatchModeChange={(value) => updateAdvancedMatchMode("accountNameMatchMode", value)}
                                placeholder={surfaceText("account-a, account-b")}
                                value={advancedDraft.accountName}
                              />

                              <AdvancedFilterTextMatchField
                                label={surfaceText("Email")}
                                costLevel="medium"
                                costTooltip={surfaceText("Medium cost: email filters may require per-account profile lookups.")}
                                fieldState={emailFilter.fieldState}
                                forcesExact={emailFilter.draftForcesExact}
                                matchMode={emailFilter.draftMode}
                                onChange={(value) => updateAdvancedField("email", value)}
                                onMatchModeChange={(value) => updateAdvancedMatchMode("emailMatchMode", value)}
                                placeholder="ops@example.com"
                                value={advancedDraft.email}
                              />
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
                                  costTooltip={surfaceText("Medium cost: numeric filters rely on counters/stats.")}
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
            columns={accountTableColumns}
            rows={items}
            rowKey={rowKey}
            rowClassName="ui-current-item"
            rowAttributes={(account) => ({
              "data-viewed": viewedRowKey === rowKey(account) || undefined,
            })}
            status={tableStatus}
            loadingMessage="Loading accounts..."
            errorMessage="Unable to load accounts."
            emptyMessage={surfaceText("No accounts.")}
            primaryColumnId="account_id"
            overflowXHidden={showAdvancedFilter}
            responsiveCards
            sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
            pagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: changePageSize,
              disabled: loading || !selectedEndpointId,
            }}
          />
        </ListPageSection>
      )}

      {selectedEndpointId && configurationTarget && (
        <CephAdminAccountEditModal
          endpointId={selectedEndpointId}
          accountId={configurationTarget.accountId}
          canViewMetrics={canViewMetrics}
          navigation={configurationNavigation}
          onClose={closeConfiguration}
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
