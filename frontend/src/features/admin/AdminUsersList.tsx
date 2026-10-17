/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { S3AccountSummary } from "../../api/accounts";
import type { User } from "../../api/users";
import UserAvatar from "../../components/UserAvatar";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import { ListActions, ListActionButton, ListActionLink, ListBadge } from "../../components/list/ListControls";
import TableSortControls from "../../components/list/TableSortControls";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { isAdminLikeRole } from "../../utils/workspaces";
import {
  CompactAssociationSummary,
  accountAssociationRoleLabels,
  type CompactAssociationCategory,
} from "./AssociationSummary";
import { buildAccessAuditHref } from "./accessAuditLink";
import type { UsersText } from "./usersMessage";
import type { UiLanguage } from "../../components/language";
import { adminIntlLocale } from "./adminI18n";

export type AdminUsersSortField = "name" | "role" | "accounts" | "last_login_at";

type Props = {
  users: User[];
  accountOptionsById: ReadonlyMap<number, S3AccountSummary>;
  locale: UiLanguage;
  text: UsersText;
  roleLabel: (role: User["role"]) => string;
  cephAdminFeatureEnabled: boolean;
  currentUserId: number | null;
  currentIsSuperAdmin: boolean;
  busyId: number | null;
  loading: boolean;
  error: string | null;
  totalUsers: number;
  filter: string;
  onFilterChange: (value: string) => void;
  sort: { field: AdminUsersSortField; direction: "asc" | "desc" };
  onSort: (field: AdminUsersSortField) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
};

export default function AdminUsersList({
  users,
  accountOptionsById,
  locale,
  text,
  roleLabel,
  cephAdminFeatureEnabled,
  currentUserId,
  currentIsSuperAdmin,
  busyId,
  loading,
  error,
  totalUsers,
  filter,
  onFilterChange,
  sort,
  onSort,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onEdit,
  onDelete,
}: Props) {
  const formatLastLogin = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(adminIntlLocale(locale));
  };

  const renderAssociationSummary = (user: User) => {
    const accountItems = (user.effective_access?.account_links ?? []).map((link) => {
      const id = Number(link.account_id);
      const label = accountOptionsById.get(id)?.name ?? text("accountFallback", { id });
      return {
        id,
        label,
        role_labels: accountAssociationRoleLabels({
          id,
          label,
          manager_role: link.manager_role,
          portal_role: link.portal_role,
        }),
      };
    });
    const s3UserItems = (user.effective_access?.s3_user_details ?? []).map((entry) => ({
      id: entry.id,
      label: entry.name || text("userFallback", { id: entry.id }),
    }));
    const connectionItems = (user.effective_access?.s3_connection_details ?? []).map((entry) => ({
      id: entry.id,
      label: entry.name || text("connectionFallback", { id: entry.id }),
    }));
    const categories: CompactAssociationCategory[] = [
      {
        id: "accounts",
        label: text("accounts"),
        itemLabel: text("rgwAccount"),
        items: accountItems,
      },
      { id: "s3_users", label: text("rgwUsers"), itemLabel: text("rgwUser"), items: s3UserItems },
      { id: "connections", label: text("s3Connections"), itemLabel: text("s3Connection"), items: connectionItems },
    ];
    return <CompactAssociationSummary categories={categories} />;
  };

  const columns: Array<DataTableColumn<User, AdminUsersSortField>> = [
    {
      id: "user",
      label: text("user"),
      field: "name",
      primary: true,
      render: (user) => {
        const fullName = user.full_name?.trim();
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <UserAvatar avatar={user.avatar} name={fullName || user.email} email={user.email} size="md" decorative />
            <span className="min-w-0">
              <span className="block break-words">{fullName || user.email}</span>
              {fullName && (
                <span className={cx("block break-all text-[11px] font-medium", uiMutedTextClass)}>
                  {user.email}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      id: "role",
      label: text("role"),
      field: "role",
      render: (user) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{roleLabel(user.role)}</span>
          {cephAdminFeatureEnabled &&
            isAdminLikeRole(user.role) &&
            user.can_access_ceph_admin && (
              <ListBadge tone="warning" className="uppercase tracking-wide">
                {text("cephAdmin")}
              </ListBadge>
            )}
        </div>
      ),
    },
    {
      id: "last_login_at",
      label: text("lastLogin"),
      field: "last_login_at",
      render: (user) => formatLastLogin(user.last_login_at),
    },
    {
      id: "associations",
      label: text("storageAssociations"),
      field: "accounts",
      mobileLabel: text("links"),
      render: renderAssociationSummary,
    },
    {
      id: "actions",
      label: text("actions"),
      align: "right",
      field: null,
      mobileRole: "actions",
      cellClassName: "min-w-[220px]",
      render: (user) => {
        const isCurrentUser = currentUserId !== null && user.id === currentUserId;
        const canManage = currentIsSuperAdmin || (user.role !== "ui_admin" && user.role !== "ui_superadmin");
        return (
          <ListActions>
            <ListActionButton type="button" onClick={() => onEdit(user)} disabled={!canManage} {...dataTableDefaultActionProps}>
              {text("edit")}
            </ListActionButton>
            <ListActionLink to={buildAccessAuditHref({ userId: user.id })}>{text("reviewAccess")}</ListActionLink>
            <ListActionButton
              type="button"
              onClick={() => onDelete(user)}
              variant="danger"
              disabled={busyId === user.id || isCurrentUser || !canManage}
              title={isCurrentUser ? text("cannotDeleteSelf") : !canManage ? text("standardUsersOnly") : undefined}
            >
              {busyId === user.id ? text("deleting") : text("delete")}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: users.length });

  return (
    <ListPageSection
      variant="page"
      mobileSort={(
        <TableSortControls
          columns={columns}
          sort={{ field: sort.field, direction: sort.direction, onSort }}
          labels={{
            sortBy: text("sortBy"),
            direction: text("direction"),
            ascending: text("ascending"),
            descending: text("descending"),
          }}
        />
      )}
      title={text("users")}
      countLabel={text(totalUsers === 1 ? "entryCount" : "entriesCount", { count: totalUsers })}
      search={(
        <ToolbarSearchInput
          value={filter}
          onChange={onFilterChange}
          placeholder={text("searchPlaceholder")}
          className="min-w-0 flex-1 sm:w-64 md:w-72"
        />
      )}
    >
      <DataTableShell
        columns={columns}
        rows={users}
        rowKey={(user) => user.id}
        status={tableStatus}
        loadingMessage={text("loadingUsers")}
        errorMessage={text("loadError")}
        emptyMessage={filter.trim() ? text("noMatches") : text("noUsers")}
        primaryColumnId="user"
        responsiveCards
        tableClassName="ui-data-table"
        sort={{ field: sort.field, direction: sort.direction, onSort }}
        pagination={{
          page,
          pageSize,
          total: totalUsers,
          onPageChange,
          onPageSizeChange,
          disabled: loading,
        }}
      />
    </ListPageSection>
  );
}
