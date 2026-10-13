/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  AccessAuditRow,
  AccessAuditSortBy,
  AccessAuditSortDir,
} from "../../api/accessAudit";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import type { ListTableStatus } from "../../components/list/listTableStatus";
import UiBadge from "../../components/ui/UiBadge";
import type { UiTone } from "../../components/ui/styles";
import { AssociationRoleTooltip } from "./AssociationSummary";
import { useAccessAuditI18n, type AccessAuditText } from "./accessAuditMessage";

const rightTones: Record<AccessAuditRow["rights"][number]["code"], UiTone> = {
  ceph_admin: "warning",
  storage_ops: "info",
  manager_bucket_compare: "primary",
  manager_bucket_integrity_check: "primary",
  manager_bucket_migration: "primary",
  manager_feature_rules: "primary",
  manager_bucket_purge: "primary",
  private_connection_create: "success",
  managed_private_connection_provision: "success",
  browser_advanced_features: "success",
  account_administrator: "warning",
  portal_manager: "info",
  portal_user: "info",
  manager_browser_data_access: "success",
  rgw_user_access: "neutral",
  shared_connection_access: "success",
};

function PrincipalCell({ row }: { row: AccessAuditRow }) {
  const { text } = useAccessAuditI18n();
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-[var(--ui-text)]">{row.principal.full_name || row.principal.email}</div>
      {row.principal.full_name ? (
        <div className="truncate ui-caption text-[var(--ui-text-muted)]">{row.principal.email}</div>
      ) : null}
      {!row.principal.is_active ? <UiBadge className="mt-1">{text("inactive")}</UiBadge> : null}
    </div>
  );
}

function TargetCell({ row }: { row: AccessAuditRow }) {
  const { text } = useAccessAuditI18n();
  const name = row.scope === "platform" && row.target.name === "Platform" ? text("platform") : row.target.name;
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-[var(--ui-text)]" title={name}>{name}</div>
      {row.target.identifier ? (
        <div className="truncate ui-caption text-[var(--ui-text-muted)]" title={row.target.identifier}>{row.target.identifier}</div>
      ) : null}
    </div>
  );
}

function RightsCell({ row }: { row: AccessAuditRow }) {
  const { text, rightLabel } = useAccessAuditI18n();
  const visible = row.rights.slice(0, 3);
  const entries = row.rights.map((right) => ({
    key: right.code,
    identity: rightLabel(right.code, right.label),
    roles: right.sources.map((source) => sourceLabel(source, text)),
  }));
  return (
    <AssociationRoleTooltip
      label={text("effectiveRights")}
      entries={entries}
      ariaLabel={text(row.rights.length === 1 ? "effectiveRightCount" : "effectiveRightsCount", { count: row.rights.length })}
      focusable
      detailLabel={text("sources")}
      detailTone="neutral"
    >
      <span className="inline-flex max-w-full flex-wrap gap-1">
        {visible.map((right) => (
          <UiBadge key={right.code} tone={rightTones[right.code]}>{rightLabel(right.code, right.label)}</UiBadge>
        ))}
        {row.rights.length > visible.length ? <UiBadge>+{row.rights.length - visible.length}</UiBadge> : null}
      </span>
    </AssociationRoleTooltip>
  );
}

function sourceLabel(source: AccessAuditRow["rights"][number]["sources"][number], text: AccessAuditText) {
  if (source.kind === "direct") return text("direct");
  return source.group_name
    ? text("uiGroupContext", { name: source.group_name })
    : text("uiGroupNumber", { id: String(source.group_id) });
}

type Props = {
  rows: AccessAuditRow[];
  status: ListTableStatus;
  emptyMessage: string;
  showUserColumn?: boolean;
  sortBy?: AccessAuditSortBy;
  sortDir?: AccessAuditSortDir;
  onSort?: (field: AccessAuditSortBy) => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    disabled?: boolean;
  };
};

export default function AccessAuditTable({
  rows,
  status,
  emptyMessage,
  showUserColumn = true,
  sortBy,
  sortDir,
  onSort,
  pagination,
}: Props) {
  const { text, scopeLabel } = useAccessAuditI18n();
  const columns: Array<DataTableColumn<AccessAuditRow, AccessAuditSortBy>> = [
    ...(showUserColumn ? [{
      id: "user",
      label: text("uiUser"),
      field: "user" as const,
      primary: true,
      render: (row: AccessAuditRow) => <PrincipalCell row={row} />,
    }] : []),
    {
      id: "scope",
      label: text("scope"),
      field: "scope",
      headerClassName: "w-px whitespace-nowrap",
      cellClassName: "w-px whitespace-nowrap",
      render: (row) => <UiBadge>{scopeLabel(row.scope)}</UiBadge>,
    },
    {
      id: "target",
      label: text("target"),
      field: "target",
      primary: !showUserColumn,
      render: (row) => <TargetCell row={row} />,
    },
    {
      id: "rights",
      label: text("effectiveRights"),
      header: text("effectiveRights"),
      cellClassName: "w-full",
      render: (row) => <RightsCell row={row} />,
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      status={status}
      loadingMessage={text("loadingAccess")}
      errorMessage={text("loadAccessError")}
      emptyMessage={emptyMessage}
      primaryColumnId={showUserColumn ? "user" : "target"}
      responsiveCards
      sort={sortBy && sortDir && onSort ? { field: sortBy, direction: sortDir, onSort } : undefined}
      pagination={pagination}
    />
  );
}
