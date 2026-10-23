/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useEffect, useMemo, useRef } from "react";

import type { S3ConnectionAdminItem } from "../../api/s3ConnectionsAdmin";
import type { StorageEndpoint } from "../../api/storageEndpoints";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  ListActions,
  ListBadge,
  ListActionButton,
  ListActionLink,
  ListSelectionCheckbox,
} from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UserAvatar from "../../components/UserAvatar";
import type { TextMatchMode } from "../../utils/textMatch";
import { buildUiTagItems } from "../../utils/uiTags";
import {
  AssociationPrincipalStack,
  type AssociationPrincipalItem,
} from "./AssociationSummary";
import { buildAccessAuditHref } from "./accessAuditLink";
import { useAdminI18n } from "./adminI18n";

type Props = {
  items: S3ConnectionAdminItem[];
  storageEndpoints: StorageEndpoint[];
  loading: boolean;
  error: string | null;
  total: number;
  filter: string;
  quickFilterMode: TextMatchMode;
  page: number;
  pageSize: number;
  selectedIds: number[];
  resolvedFilteredSelectableIds: number[] | null;
  statusBusyId: number | null;
  selectAllFilteredBusy: boolean;
  bulkActivateBusy: boolean;
  bulkDisableBusy: boolean;
  bulkDeleteBusy: boolean;
  onFilterChange: (value: string) => void;
  onQuickFilterModeChange: (mode: TextMatchMode) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onToggleRowSelection: (connectionId: number) => void;
  onSelectAllFiltered: (checked: boolean) => void | Promise<void>;
  onToggleStatus: (connection: S3ConnectionAdminItem) => void | Promise<void>;
  onEdit: (connection: S3ConnectionAdminItem) => void;
  onDelete: (connection: S3ConnectionAdminItem) => void;
  onBulkActivate: () => void | Promise<void>;
  onBulkDisable: () => void | Promise<void>;
  onBulkDelete: () => void;
};

export default function AdminS3ConnectionsList({
  items,
  storageEndpoints,
  loading,
  error,
  total,
  filter,
  quickFilterMode,
  page,
  pageSize,
  selectedIds,
  resolvedFilteredSelectableIds,
  statusBusyId,
  selectAllFilteredBusy,
  bulkActivateBusy,
  bulkDisableBusy,
  bulkDeleteBusy,
  onFilterChange,
  onQuickFilterModeChange,
  onPageChange,
  onPageSizeChange,
  onToggleRowSelection,
  onSelectAllFiltered,
  onToggleStatus,
  onEdit,
  onDelete,
  onBulkActivate,
  onBulkDisable,
  onBulkDelete,
}: Props) {
  const { text: adminText } = useAdminI18n();
  const selectionHeaderRef = useRef<HTMLInputElement | null>(null);
  const quickFilterActive = filter.trim().length > 0;
  const status = resolveListTableStatus({ loading, error, rowCount: items.length });
  const endpointNameById = useMemo(() => {
    const map = new Map<number, string>();
    storageEndpoints.forEach((endpoint) => map.set(endpoint.id, endpoint.name));
    return map;
  }, [storageEndpoints]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectableOnPageIds = useMemo(() => items.map((item) => item.id), [items]);
  const selectedOnPageIds = useMemo(
    () => selectableOnPageIds.filter((connectionId) => selectedIdSet.has(connectionId)),
    [selectableOnPageIds, selectedIdSet],
  );
  const allSelectedOnPage =
    selectableOnPageIds.length > 0 && selectedOnPageIds.length === selectableOnPageIds.length;
  const selectedOnFilteredCount = resolvedFilteredSelectableIds
    ? resolvedFilteredSelectableIds.reduce(
        (count, connectionId) => count + (selectedIdSet.has(connectionId) ? 1 : 0),
        0,
      )
    : selectedOnPageIds.length;
  const allSelectedOnFiltered =
    resolvedFilteredSelectableIds !== null &&
    resolvedFilteredSelectableIds.length > 0 &&
    selectedOnFilteredCount === resolvedFilteredSelectableIds.length;
  const hiddenSelectedCount = Math.max(selectedIds.length - selectedOnPageIds.length, 0);
  const headerChecked =
    resolvedFilteredSelectableIds !== null ? allSelectedOnFiltered : allSelectedOnPage;
  const headerIndeterminate = resolvedFilteredSelectableIds !== null
    ? selectedOnFilteredCount > 0 && !allSelectedOnFiltered
    : selectedOnPageIds.length > 0 && !allSelectedOnPage;
  const bulkBusy = bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy;

  useEffect(() => {
    if (!selectionHeaderRef.current) return;
    selectionHeaderRef.current.indeterminate = headerIndeterminate;
  }, [headerIndeterminate]);

  const renderConnectionAssociations = (connection: S3ConnectionAdminItem) => {
    const userItems: AssociationPrincipalItem[] = connection.user_details.map((user) => ({
      id: user.id,
      kind: "user",
      label: user.full_name || user.email || `User #${user.id}`,
      email: user.email,
      avatar: user.avatar,
    }));
    const groupItems: AssociationPrincipalItem[] = connection.group_details.map((group) => ({
      id: group.id,
      kind: "group",
      label: group.name,
      avatar: group.avatar,
    }));
    return <AssociationPrincipalStack items={[...userItems, ...groupItems]} />;
  };

  const columns: Array<DataTableColumn<S3ConnectionAdminItem>> = [
    {
      id: "select",
      label: "Select",
      headerClassName: "w-10 px-3",
      cellClassName: "w-10 px-3 py-4",
      header: (
        <ListSelectionCheckbox
          ref={selectionHeaderRef}
          aria-label={adminText("Select all filtered connections")}
          checked={headerChecked}
          onChange={(event) => void onSelectAllFiltered(event.target.checked)}
          disabled={loading || selectAllFilteredBusy || total === 0 || bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy}
        />
      ),
      render: (connection) => (
        <ListSelectionCheckbox
          aria-label={`Select connection ${connection.name}`}
          checked={selectedIdSet.has(connection.id)}
          onChange={() => onToggleRowSelection(connection.id)}
          disabled={bulkBusy}
        />
      ),
    },
    {
      id: "name",
      label: "Name",
      primary: true,
      cellClassName: "min-w-[240px]",
      render: (connection) => {
        const tagItems = buildUiTagItems(connection.tags);
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 flex-1 truncate">{connection.name}</p>
            {tagItems.length > 0 && (
              <UiTagBadgeList
                items={tagItems}
                variant="listing-compact"
                layout="inline-compact"
                className="ml-auto max-w-full"
                maxVisible={4}
              />
            )}
          </div>
        );
      },
    },
    {
      id: "endpoint",
      label: "Endpoint",
      cellClassName: "min-w-[220px]",
      render: (connection) =>
        connection.storage_endpoint_id != null ? (
          <span>
            {endpointNameById.get(connection.storage_endpoint_id) ||
              `Endpoint #${connection.storage_endpoint_id}`}
          </span>
        ) : (
          <span className="ui-mono">{connection.endpoint_url || "-"}</span>
        ),
    },
    {
      id: "status",
      label: "Status",
      render: (connection) => {
        const remediationRequired = connection.execution_status === "remediation_required";
        const isActive = connection.is_active && !remediationRequired;
        return (
          <ListBadge tone={remediationRequired ? "warning" : isActive ? "success" : "neutral"}>
            {remediationRequired ? "Remediation required" : isActive ? "Active" : "Inactive"}
          </ListBadge>
        );
      },
    },
    {
      id: "created-by",
      label: "Created by",
      render: (connection) => (
        <UserAvatar
          avatar={connection.created_by_avatar}
          name={
            connection.created_by_full_name ||
            connection.created_by_email ||
            `User #${connection.created_by_user_id}`
          }
          email={connection.created_by_email}
          size="sm"
          title={
            [connection.created_by_full_name, connection.created_by_email].filter(Boolean).join(" · ") ||
            `User #${connection.created_by_user_id}`
          }
        />
      ),
    },
    {
      id: "associations",
      label: "UI Users / Groups",
      cellClassName: "min-w-[180px] max-w-[240px] align-middle",
      render: renderConnectionAssociations,
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "min-w-[344px]",
      render: (connection) => {
        const remediationRequired = connection.execution_status === "remediation_required";
        const isActive = connection.is_active;
        return (
          <ListActions>
            <ListActionButton
              type="button"
              onClick={() => void onToggleStatus(connection)}
              disabled={statusBusyId === connection.id || bulkBusy}
            >
              {statusBusyId === connection.id
                ? "Saving..."
                : remediationRequired
                  ? "Activate in Manager"
                  : isActive
                    ? "Deactivate"
                    : "Activate"}
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={() => onEdit(connection)}
              {...dataTableDefaultActionProps}
            >
              {adminText("Edit")}
            </ListActionButton>
            <ListActionLink
              to={buildAccessAuditHref({
                scope: "s3_connection",
                targetId: connection.id,
              })}
            >
              {adminText("Review access")}
            </ListActionLink>
            <ListActionButton type="button" variant="danger" onClick={() => onDelete(connection)}>
              {adminText("Delete")}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <ListPageSection
      variant="page"
      title={adminText("S3 Connections")}
      countLabel={`${total} entr${total === 1 ? "y" : "ies"}`}
      search={
        <ToolbarSearchInput
          value={filter}
          onChange={onFilterChange}
          placeholder={adminText("Search name, endpoint, created by, group, or tag...")}
          className="w-full sm:w-64"
          active={quickFilterActive}
          matchMode={quickFilterMode}
          onToggleMatchMode={() =>
            onQuickFilterModeChange(quickFilterMode === "contains" ? "exact" : "contains")
          }
        />
      }
      secondaryContent={
        quickFilterActive ? (
          <ActiveFiltersBar
            label={adminText("Active filters summary")}
            items={[
              {
                id: "search",
                label: `Search ${quickFilterMode === "exact" ? "exact" : "contains"}: ${filter.trim()}`,
              },
            ]}
            onClearAll={() => {
              onFilterChange("");
              onQuickFilterModeChange("contains");
            }}
          />
        ) : null
      }
    >
      {selectedIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
          <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
            {selectedIds.length} {adminText("selected")}
            {hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} not visible)` : ""}
          </span>
          <ListActions>
            <ListActionButton type="button" onClick={() => void onBulkActivate()} disabled={bulkBusy}>
              {bulkActivateBusy ? "Activating..." : "Activate selected"}
            </ListActionButton>
            <ListActionButton type="button" onClick={() => void onBulkDisable()} disabled={bulkBusy}>
              {bulkDisableBusy ? "Disabling..." : "Disable selected"}
            </ListActionButton>
            <ListActionButton type="button" variant="danger" onClick={onBulkDelete} disabled={bulkBusy}>
              {adminText("Delete selected")}
            </ListActionButton>
          </ListActions>
        </div>
      )}
      <DataTableShell
        columns={columns}
        rows={items}
        rowKey={(connection) => connection.id}
        status={status}
        loadingMessage={adminText("Loading connections...")}
        errorMessage={adminText("Unable to load connections.")}
        emptyMessage={adminText("No connections.")}
        primaryColumnId="name"
        responsiveCards
        tableClassName="ui-data-table"
        pagination={{
          page,
          pageSize,
          total,
          onPageChange,
          onPageSizeChange,
          disabled: loading,
        }}
      />
    </ListPageSection>
  );
}
