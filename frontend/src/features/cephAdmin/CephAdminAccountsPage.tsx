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
import AdvancedFilterTextMatchField from "../shared/AdvancedFilterTextMatchField";
import {
  advancedFilterSectionClass,
  advancedFilterSyncBadgeClass,
  formatAdvancedFilterSyncLabel,
  formatTextFilterSummary,
  resolveTextFilterFieldState,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterCostBadge,
  renderAdvancedFilterRuleCountBadge,
  renderAdvancedSearchProgress,
  shouldShowActiveFilterSummary,
  type TextMatchMode,
} from "../shared/advancedFilterShared";
import {
  buildNumericFilterFields,
  buildNumericFilterSummaryItems,
  type NumericFilterRangeField,
} from "./filtering/advancedFilterModel";
import AdvancedFilterNumericRangesSection from "./filtering/AdvancedFilterNumericRangesSection";
import {
  buildAccountAdvancedFilterPayload,
  defaultAccountAdvancedFilter,
  hasAccountAdvancedFilters,
  resolveAccountAdvancedFilterCost,
  type AccountActiveFilterSummaryItem,
  type AccountAdvancedFilterState,
  type AccountAdvancedNumericField,
} from "./filtering/accountAdvancedFilterModel";
import { useCephAdminFilteredEntityListing } from "./listing/useCephAdminFilteredEntityListing";
import { useCephAdminListingTableState } from "./listing/useCephAdminListingTableState";
import { formatBytes, formatNumber } from "../../utils/format";
import { useCephAdminI18n } from "./cephAdminI18n";
import { useCephAdminAccountConfigurationNavigation } from "./useCephAdminEntityConfigurationNavigation";

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
    filter,
    setFilter,
    searchValue,
    quickFilterActive,
    quickFilterAppliedParsed,
    quickFilterDraftForcesExact,
    effectiveQuickFilterMode,
    quickFilterFieldState,
    quickFilterModeForDisplay,
    quickFilterPending,
    toggleQuickFilterMode,
    showAdvancedFilter,
    setShowAdvancedFilter,
    advancedDraft,
    advancedApplied,
    hasPendingAdvancedChanges,
    hasAnyAdvancedToClear,
    advancedFilterCloseGuard,
    updateAdvancedField,
    applyAdvancedFilter,
    resetAdvancedFilter,
    resetAllFilters,
    removeActiveFilterItem,
    items,
    total,
    loading,
    loadingDetails,
    advancedProgress,
    error,
    updateEntity,
  } = useCephAdminFilteredEntityListing<CephAdminRgwAccount, AccountAdvancedFilterState>({
    endpointId: selectedEndpointId,
    page,
    setPage,
    pageSize,
    sortBy: sort.field,
    sortDirection: sort.direction,
    includes: includeParams,
    reloadNonce,
    defaultAdvancedFilter: defaultAccountAdvancedFilter,
    buildAdvancedFilter: (state, quickSearch, quickMatchMode) =>
      buildAccountAdvancedFilterPayload(state, quickSearch, quickMatchMode, canViewMetrics),
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

  const numericRangeFields = useMemo<NumericFilterRangeField<AccountAdvancedNumericField>[]>(() => [
    { label: surfaceText("Max users"), minKey: "minMaxUsers", maxKey: "maxMaxUsers" },
    { label: surfaceText("Max buckets"), minKey: "minMaxBuckets", maxKey: "maxMaxBuckets" },
    { label: surfaceText("Quota bytes"), minKey: "minQuotaBytes", maxKey: "maxQuotaBytes" },
    { label: surfaceText("Quota objects"), minKey: "minQuotaObjects", maxKey: "maxQuotaObjects" },
    { label: surfaceText("Bucket count"), minKey: "minBucketCount", maxKey: "maxBucketCount" },
    { label: surfaceText("User count"), minKey: "minUserCount", maxKey: "maxUserCount" },
  ], [surfaceText]);
  const usageNumericRangeFields = useMemo<NumericFilterRangeField<AccountAdvancedNumericField>[]>(() => [
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

  const updateAdvancedMatchMode = (field: "accountNameMatchMode" | "emailMatchMode", value: TextMatchMode) => {
    updateAdvancedField(field, value);
  };

  const advancedFilterActive = hasAccountAdvancedFilters(advancedApplied, canViewMetrics);
  const activeFilterSummaryItems = useMemo(() => {
    const items: AccountActiveFilterSummaryItem[] = [];
    if (quickFilterActive) {
      const label = formatTextFilterSummary(surfaceText("Account ID"), searchValue, effectiveQuickFilterMode);
      if (label) items.push({ id: "quick", label, remove: { type: "quick" } });
    }
    if (advancedApplied && hasAccountAdvancedFilters(advancedApplied, canViewMetrics)) {
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

  const advancedDraftCost = useMemo(
    () => resolveAccountAdvancedFilterCost(advancedDraft, canViewMetrics),
    [advancedDraft, canViewMetrics],
  );
  const advancedDraftActiveCount = advancedDraftCost.activeCount;
  const advancedDraftGlobalCostLevel = advancedDraftCost.level;
  const advancedDraftGlobalCostTooltip = useMemo(() => {
    if (advancedDraftGlobalCostLevel === "high") {
      return surfaceText("High cost: many numeric filters are active and may require heavier stats filtering.");
    }
    if (advancedDraftGlobalCostLevel === "medium") {
      if (advancedDraftCost.textCount > 0 && advancedDraftCost.numericCount === 0) {
        return surfaceText("Medium cost: account profile filters may require per-account detail lookups.");
      }
      return surfaceText("Medium cost: numeric filters are active and rely on usage/quota counters.");
    }
    return surfaceText("No additional filter cost.");
  }, [advancedDraftCost.numericCount, advancedDraftCost.textCount, advancedDraftGlobalCostLevel, surfaceText]);

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

                          <AdvancedFilterNumericRangesSection
                            applied={advancedApplied}
                            canViewUsage={canViewMetrics}
                            draft={advancedDraft}
                            onChange={updateAdvancedField}
                            rangeCostTooltip={surfaceText("Medium cost: numeric filters rely on counters/stats.")}
                            ranges={numericRangeFields}
                            usageRanges={usageNumericRangeFields}
                          />
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
