/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  ListActions,
  ListBadge,
  ListActionButton,
  ListSelectionCheckbox,
} from "../../components/list/ListControls";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import type { S3Connection } from "../../api/connections";
import { formatLocalDateTime } from "../../utils/dateTime";
import { buildUiTagItems } from "../../utils/uiTags";
import { useSharedI18n } from "./sharedI18n";

type PrivateS3ConnectionsTableProps = {
  connectionsLoading: boolean;
  pagedConnections: S3Connection[];
  filteredConnectionCount: number;
  filteredConnectionIds: number[];
  selectedFilteredConnectionIdSet: Set<number>;
  allFilteredConnectionsSelected: boolean;
  storageEndpointLabelById: Map<number, string>;
  deletingConnectionBusyId: number | null;
  togglingConnectionBusyId: number | null;
  bulkActivatingConnections: boolean;
  bulkDisablingConnections: boolean;
  bulkDeletingConnections: boolean;
  page: number;
  pageSize: number;
  onToggleSelectAll: () => void;
  onToggleSelection: (connectionId: number) => void;
  onRetryCleanup: (connectionId: number) => void | Promise<void>;
  onToggleStatus: (connection: S3Connection) => void | Promise<void>;
  onEdit: (connection: S3Connection) => void;
  onDelete: (connection: S3Connection) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export default function PrivateS3ConnectionsTable({
  connectionsLoading,
  pagedConnections,
  filteredConnectionCount,
  filteredConnectionIds,
  selectedFilteredConnectionIdSet,
  allFilteredConnectionsSelected,
  storageEndpointLabelById,
  deletingConnectionBusyId,
  togglingConnectionBusyId,
  bulkActivatingConnections,
  bulkDisablingConnections,
  bulkDeletingConnections,
  page,
  pageSize,
  onToggleSelectAll,
  onToggleSelection,
  onRetryCleanup,
  onToggleStatus,
  onEdit,
  onDelete,
  onPageChange,
  onPageSizeChange,
}: PrivateS3ConnectionsTableProps) {
  const { text: surfaceText } = useSharedI18n();
  const busy = bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections;
  const status = connectionsLoading ? "loading" : pagedConnections.length === 0 ? "empty" : "ready";
  const columns: Array<DataTableColumn<S3Connection>> = [
    {
      id: "select",
      label: surfaceText("Select"),
      headerClassName: "w-10",
      cellClassName: "w-10",
      header: (
        <ListSelectionCheckbox
          aria-label={surfaceText("Select all filtered private connections")}
          checked={allFilteredConnectionsSelected}
          onChange={onToggleSelectAll}
          disabled={filteredConnectionIds.length === 0 || busy}
        />
      ),
      render: (connection) => (
        <ListSelectionCheckbox
          aria-label={surfaceText("Select private connection {connection}", {
            connection: connection.name || connection.id,
          })}
          checked={selectedFilteredConnectionIdSet.has(connection.id)}
          onChange={() => onToggleSelection(connection.id)}
          disabled={busy}
        />
      ),
    },
    {
      id: "connection",
      label: surfaceText("Connection"),
      primary: true,
      render: (connection) => {
        const connectionTagItems = buildUiTagItems(connection.tags);
        return (
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="truncate">{connection.name || "-"}</p>
              {connection.server_managed && (
                <ListBadge tone="primary" className="mt-1">
                  {surfaceText("Personal access")}
                  {connection.managed_access_state === "cleanup_pending"
                    ? ` - ${surfaceText("cleanup required")}`
                    : ""}
                </ListBadge>
              )}
              <p className="ui-caption font-normal text-slate-500 dark:text-slate-400">
                {surfaceText("Access Key:")}
                {connection.access_key_id || "-"}
              </p>
            </div>
            {connectionTagItems.length > 0 && (
              <UiTagBadgeList
                items={connectionTagItems}
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
      label: surfaceText("Endpoint"),
      render: (connection) => {
        const endpointLabel = connection.storage_endpoint_id
          ? storageEndpointLabelById.get(connection.storage_endpoint_id) ||
            surfaceText("Managed endpoint #{id}", { id: connection.storage_endpoint_id })
          : connection.endpoint_url || "-";
        return connection.storage_endpoint_id ? (
          <ListBadge tone="neutral">{endpointLabel}</ListBadge>
        ) : (
          <span className="ui-mono">{endpointLabel}</span>
        );
      },
    },
    {
      id: "provider",
      label: surfaceText("Provider"),
      render: (connection) => connection.provider_hint || "-",
    },
    {
      id: "status",
      label: surfaceText("Status"),
      render: (connection) => (
        <ListBadge tone={connection.is_active ? "success" : "neutral"}>
          {surfaceText(connection.is_active ? "Active" : "Inactive")}
        </ListBadge>
      ),
    },
    {
      id: "updated-at",
      label: surfaceText("Last update"),
      render: (connection) => formatLocalDateTime(connection.updated_at ?? connection.created_at),
    },
    {
      id: "last-used-at",
      label: surfaceText("Last used"),
      render: (connection) => formatLocalDateTime(connection.last_used_at),
    },
    {
      id: "actions",
      label: surfaceText("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (connection) => (
        <ListActions>
          {connection.managed_access_state === "cleanup_pending" && (
            <ListActionButton
              type="button"
              disabled={deletingConnectionBusyId === connection.id}
              onClick={() => void onRetryCleanup(connection.id)}
            >
              {surfaceText(deletingConnectionBusyId === connection.id ? "Retrying..." : "Retry cleanup")}
            </ListActionButton>
          )}
          <ListActionButton
            type="button"
            disabled={togglingConnectionBusyId === connection.id || busy}
            onClick={() => void onToggleStatus(connection)}
          >
            {surfaceText(
              togglingConnectionBusyId === connection.id
                ? "Saving..."
                : connection.is_active
                  ? "Deactivate"
                  : "Activate",
            )}
          </ListActionButton>
          <ListActionButton type="button" onClick={() => onEdit(connection)} disabled={busy}>
            {surfaceText("Edit")}
          </ListActionButton>
          <ListActionButton
            type="button"
            variant="danger"
            disabled={deletingConnectionBusyId === connection.id || busy}
            onClick={() => onDelete(connection)}
          >
            {surfaceText(deletingConnectionBusyId === connection.id ? "Deleting..." : "Delete")}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={connectionsLoading ? [] : pagedConnections}
      rowKey={(connection) => connection.id}
      status={status}
      loadingMessage={surfaceText("Loading connections...")}
      errorMessage={surfaceText("Unable to load private S3 connections.")}
      emptyMessage={surfaceText("No private S3 connection configured.")}
      responsiveCards
      pagination={
        !connectionsLoading && filteredConnectionCount > 0
          ? {
              page,
              pageSize,
              total: filteredConnectionCount,
              onPageChange,
              onPageSizeChange,
              pageSizeOptions: [10, 25, 50, 100],
            }
          : undefined
      }
    />
  );
}
