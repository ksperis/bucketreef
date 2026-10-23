/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useMemo } from "react";

import type { S3AccountSummary } from "../../api/accounts";
import type { UiGroup } from "../../api/groups";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  ListActionButton,
  ListActionLink,
  ListActions,
  ListBadge,
} from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import TableSortControls from "../../components/list/TableSortControls";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import GroupAvatar from "../../components/GroupAvatar";
import {
  AssociationPrincipalStack,
  CompactAssociationSummary,
  accountAssociationRoleLabels,
  uiPrincipalRoleLabel,
  type AssociationAccountItem,
  type AssociationPrincipalItem,
  type CompactAssociationCategory,
} from "./AssociationSummary";
import { buildAccessAuditHref } from "./accessAuditLink";
import { useGroupsI18n } from "./groupsMessage";

export type GroupSortField = "name" | "created_at" | "updated_at";

type AdminGroupsListProps = {
  groups: UiGroup[];
  loading: boolean;
  error: string | null;
  filter: string;
  sort: { field: GroupSortField; direction: "asc" | "desc" };
  page: number;
  pageSize: number;
  total: number;
  busyId: number | null;
  accountOptionsById: ReadonlyMap<number, S3AccountSummary>;
  s3UserLabelById: ReadonlyMap<number, string>;
  connectionLabelById: ReadonlyMap<number, string>;
  onFilterChange: (value: string) => void;
  onSort: (field: GroupSortField) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onEdit: (group: UiGroup) => void;
  onDelete: (group: UiGroup) => void;
};

export default function AdminGroupsList({
  groups,
  loading,
  error,
  filter,
  sort,
  page,
  pageSize,
  total,
  busyId,
  accountOptionsById,
  s3UserLabelById,
  connectionLabelById,
  onFilterChange,
  onSort,
  onPageChange,
  onPageSizeChange,
  onEdit,
  onDelete,
}: AdminGroupsListProps) {
  const { text } = useGroupsI18n();
  const status = resolveListTableStatus({
    loading,
    error,
    rowCount: groups.length,
  });
  const columns = useMemo<Array<DataTableColumn<UiGroup, GroupSortField>>>(
    () => [
      {
        id: "name",
        label: text("name"),
        field: "name",
        primary: true,
        cellClassName: "min-w-[14rem]",
        render: (group) => (
          <div className="flex w-full items-center gap-2">
            <GroupAvatar avatar={group.avatar} name={group.name} size="md" decorative />
            <span className="min-w-0">
              <span className="block truncate">{group.name}</span>
              {group.description && (
                <span className="mt-0.5 block truncate ui-caption font-normal text-slate-500 dark:text-slate-400">
                  {group.description}
                </span>
              )}
            </span>
          </div>
        ),
      },
      {
        id: "rights",
        label: text("rights"),
        cellClassName: "min-w-[12rem]",
        render: (group) => {
          const access = group.manager_tool_access;
          const toolCount =
            Object.values(access).filter(Boolean).length +
            Number(group.can_provision_managed_private_connections);
          return (
            <div className="flex flex-wrap gap-2">
              {group.can_access_ceph_admin && (
                <ListBadge tone="warning">{text("cephAdmin")}</ListBadge>
              )}
              {group.can_access_storage_ops && (
                <ListBadge tone="info">{text("storageOps")}</ListBadge>
              )}
              {group.can_create_manual_private_connections && (
                <ListBadge tone="success">{text("connections")}</ListBadge>
              )}
              {toolCount > 0 && (
                <ListBadge tone="neutral">
                  {text("managerPermissionsCount", { count: toolCount })}
                </ListBadge>
              )}
              {!group.can_access_ceph_admin &&
                !group.can_access_storage_ops &&
                !group.can_create_manual_private_connections &&
                toolCount === 0 && (
                  <span className="ui-caption text-slate-500 dark:text-slate-400">
                    {text("noWorkspaceToolRights")}
                  </span>
                )}
            </div>
          );
        },
      },
      {
        id: "members",
        label: text("members"),
        cellClassName: "min-w-[10rem]",
        render: (group) => {
          const items: AssociationPrincipalItem[] = group.user_details.map(
            (user) => {
              const id = Number(user.id);
              return {
                id,
                kind: "user",
                label: user.full_name || user.email || text("userNumber", { id }),
                email: user.email,
                avatar: user.avatar,
                role_labels: [uiPrincipalRoleLabel(user.role)],
              };
            },
          );
          return <AssociationPrincipalStack items={items} maxVisible={5} />;
        },
      },
      {
        id: "associations",
        label: text("storageAssociations"),
        cellClassName: "min-w-[18rem]",
        render: (group) => {
          const accountDetailsById = new Map(
            group.account_details.map((account) => [account.id, account]),
          );
          const s3UserDetailsById = new Map(
            group.s3_user_details.map((user) => [Number(user.id), user]),
          );
          const accountItems: AssociationAccountItem[] = group.account_links.map(
            (link) => {
              const accountId = Number(link.account_id);
              return {
                id: accountId,
                label:
                  accountDetailsById.get(accountId)?.name ??
                  accountOptionsById.get(accountId)?.name ??
                  text("accountNumber", { id: link.account_id }),
                manager_role: link.manager_role,
                portal_role: link.portal_role,
              };
            },
          );
          const s3UserItems = group.s3_user_links.map((link) => {
            const s3UserId = Number(link.s3_user_id);
            return {
              id: s3UserId,
              label:
                s3UserDetailsById.get(s3UserId)?.name ??
                s3UserLabelById.get(s3UserId) ??
                text("s3UserNumber", { id: s3UserId }),
            };
          });
          const connectionItems = group.s3_connection_details.map((details) => {
            const connectionId = Number(details.id);
            return {
              id: connectionId,
              label:
                details.name ??
                connectionLabelById.get(connectionId) ??
                text("connectionNumber", { id: connectionId }),
            };
          });
          const categories: CompactAssociationCategory[] = [
            {
              id: "accounts",
              label: text("accounts"),
              itemLabel: text("rgwAccount"),
              items: accountItems.map((account) => ({
                id: account.id,
                label: account.label,
                role_labels: accountAssociationRoleLabels(account),
              })),
            },
            {
              id: "s3_users",
              label: text("rgwUsers"),
              itemLabel: text("rgwUser"),
              items: s3UserItems,
            },
            {
              id: "connections",
              label: text("s3Connections"),
              itemLabel: text("s3Connection"),
              items: connectionItems,
            },
          ];
          return <CompactAssociationSummary categories={categories} />;
        },
      },
      {
        id: "actions",
        label: text("actions"),
        align: "right",
        mobileRole: "actions",
        cellClassName: "min-w-[220px]",
        render: (group) => (
          <ListActions>
            <ListActionButton
              type="button"
              onClick={() => onEdit(group)}
              {...dataTableDefaultActionProps}
            >
              {text("edit")}
            </ListActionButton>
            <ListActionLink to={buildAccessAuditHref({ groupId: group.id })}>
              {text("reviewAccess")}
            </ListActionLink>
            <ListActionButton
              type="button"
              onClick={() => onDelete(group)}
              disabled={busyId === group.id}
              variant="danger"
            >
              {busyId === group.id ? text("deleting") : text("delete")}
            </ListActionButton>
          </ListActions>
        ),
      },
    ],
    [
      accountOptionsById,
      busyId,
      connectionLabelById,
      onDelete,
      onEdit,
      s3UserLabelById,
      text,
    ],
  );

  return (
    <ListPageSection
      variant="page"
      mobileSort={
        <TableSortControls
          columns={columns}
          labels={{
            sortBy: text("sortBy"),
            direction: text("direction"),
            ascending: text("ascending"),
            descending: text("descending"),
          }}
          sort={{ field: sort.field, direction: sort.direction, onSort }}
        />
      }
      title={text("groups")}
      countLabel={text(total === 1 ? "entryCount" : "entriesCount", { count: total })}
      search={
        <ToolbarSearchInput
          value={filter}
          onChange={onFilterChange}
          placeholder={text("searchPlaceholder")}
          className="w-full sm:w-64 md:w-80"
        />
      }
    >
      <DataTableShell
        columns={columns}
        rows={groups}
        rowKey={(group) => group.id}
        status={status}
        loadingMessage={text("loadingGroups")}
        errorMessage={text("loadGroupsError")}
        emptyMessage={text("noGroups")}
        sort={{ field: sort.field, direction: sort.direction, onSort }}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange,
          onPageSizeChange,
          disabled: loading,
        }}
        primaryColumnId="name"
        responsiveCards
        tableClassName="ui-data-table"
      />
    </ListPageSection>
  );
}
