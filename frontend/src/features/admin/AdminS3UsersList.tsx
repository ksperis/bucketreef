/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useMemo } from "react";

import type { S3User } from "../../api/s3Users";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  ListActionButton,
  ListActionLink,
  ListActions,
} from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import TableSortControls from "../../components/list/TableSortControls";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import type { TextMatchMode } from "../../utils/textMatch";
import { buildUiTagItems } from "../../utils/uiTags";
import {
  AssociationPrincipalStack,
  type AssociationPrincipalItem,
} from "./AssociationSummary";
import { buildAccessAuditHref } from "./accessAuditLink";
import { useAdminI18n } from "./adminI18n";

export type AdminS3UsersSortField = "name" | "uid";

type AdminS3UsersListProps = {
  users: S3User[];
  loading: boolean;
  error: string | null;
  filter: string;
  quickFilterMode: TextMatchMode;
  sort: { field: AdminS3UsersSortField; direction: "asc" | "desc" };
  page: number;
  pageSize: number;
  total: number;
  deleteBusyId: number | null;
  onFilterChange: (value: string) => void;
  onQuickFilterModeChange: (mode: TextMatchMode) => void;
  onSort: (field: AdminS3UsersSortField) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onEdit: (user: S3User) => void;
  onDelete: (user: S3User) => void;
};

export default function AdminS3UsersList({
  users,
  loading,
  error,
  filter,
  quickFilterMode,
  sort,
  page,
  pageSize,
  total,
  deleteBusyId,
  onFilterChange,
  onQuickFilterModeChange,
  onSort,
  onPageChange,
  onPageSizeChange,
  onEdit,
  onDelete,
}: AdminS3UsersListProps) {
  const { text: adminText } = useAdminI18n();
  const quickFilterActive = filter.trim().length > 0;
  const status = resolveListTableStatus({
    loading,
    error,
    rowCount: users.length,
  });
  const columns = useMemo<Array<DataTableColumn<S3User, AdminS3UsersSortField>>>(
    () => [
      {
        id: "name",
        label: "Name",
        field: "name",
        primary: true,
        cellClassName: "min-w-[280px] max-w-[420px]",
        render: (user) => {
          const tagItems = buildUiTagItems(user.tags);
          return (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="min-w-0 truncate">{user.name}</span>
                {user.rgw_tenant && (
                  <span className="ui-caption shrink-0 text-[var(--ui-text-muted)]">
                    ({user.rgw_tenant})
                  </span>
                )}
              </div>
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
        id: "uid",
        label: "UID",
        field: "uid",
        cellClassName: "min-w-[190px]",
        render: (user) => user.rgw_user_uid,
      },
      {
        id: "endpoint",
        label: "Endpoint",
        cellClassName: "min-w-[180px]",
        render: (user) => (
          <span title={user.storage_endpoint_url || undefined}>
            {user.storage_endpoint_name}
          </span>
        ),
      },
      {
        id: "associations",
        label: "UI Users / Groups",
        cellClassName: "min-w-[200px] max-w-[260px] align-middle",
        render: (user) => {
          const userItems: AssociationPrincipalItem[] = (user.user_links ?? []).map((link) => ({
            id: link.user_id,
            kind: "user",
            label: link.user_full_name || link.user_email || `User #${link.user_id}`,
            email: link.user_email,
            avatar: link.user_avatar,
          }));
          const groupItems: AssociationPrincipalItem[] = (user.group_links ?? []).map((link) => ({
            id: link.group_id,
            kind: "group",
            label: link.group_name || `Group #${link.group_id}`,
            avatar: link.group_avatar,
          }));
          return <AssociationPrincipalStack items={[...userItems, ...groupItems]} />;
        },
      },
      {
        id: "actions",
        label: "Actions",
        align: "right",
        mobileRole: "actions",
        cellClassName: "min-w-[272px]",
        render: (user) => {
          const deleteBusy = deleteBusyId === user.id;
          return (
            <ListActions>
              <ListActionButton
                type="button"
                onClick={() => onEdit(user)}
                {...dataTableDefaultActionProps}
              >
                {adminText("Edit")}
              </ListActionButton>
              <ListActionLink
                to={buildAccessAuditHref({
                  scope: "rgw_user",
                  targetId: user.id,
                })}
              >
                {adminText("Review access")}
              </ListActionLink>
              <ListActionLink to={`/admin/s3-users/${user.id}/keys`}>
                {adminText("Keys")}
              </ListActionLink>
              <ListActionButton
                type="button"
                onClick={() => onDelete(user)}
                variant="danger"
                disabled={deleteBusy}
              >
                {deleteBusy ? "Deleting..." : "Delete"}
              </ListActionButton>
            </ListActions>
          );
        },
      },
    ],
    [adminText, deleteBusyId, onDelete, onEdit],
  );

  return (
    <ListPageSection
      variant="page"
      mobileSort={
        <TableSortControls
          columns={columns}
          sort={{ field: sort.field, direction: sort.direction, onSort }}
        />
      }
      title={adminText("RGW Users")}
      countLabel={`${total} entr${total === 1 ? "y" : "ies"}`}
      search={
        <ToolbarSearchInput
          value={filter}
          onChange={onFilterChange}
          placeholder={adminText("Search by name, UID, email, group, or tag")}
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
      <DataTableShell
        columns={columns}
        rows={users}
        rowKey={(user) => user.id}
        status={status}
        loadingMessage={adminText("Loading users...")}
        errorMessage={adminText("Unable to load users.")}
        emptyMessage={adminText("No users.")}
        sort={{ field: sort.field, direction: sort.direction, onSort }}
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
