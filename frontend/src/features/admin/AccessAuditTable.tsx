/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  AccessAuditRow,
  AccessAuditScope,
  AccessAuditSortBy,
  AccessAuditSortDir,
} from "../../api/accessAudit";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import type { ListTableStatus } from "../../components/list/listTableStatus";
import UiBadge from "../../components/ui/UiBadge";

const scopeLabels: Record<AccessAuditScope, string> = {
  platform: "Platform",
  rgw_account: "RGW Account",
  rgw_user: "RGW User",
  s3_connection: "S3 Connection",
};

function PrincipalCell({ row }: { row: AccessAuditRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-[var(--ui-text)]">{row.principal.full_name || row.principal.email}</div>
      {row.principal.full_name ? (
        <div className="truncate ui-caption text-[var(--ui-text-muted)]">{row.principal.email}</div>
      ) : null}
      {!row.principal.is_active ? <UiBadge className="mt-1">Inactive</UiBadge> : null}
    </div>
  );
}

function TargetCell({ row }: { row: AccessAuditRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-[var(--ui-text)]" title={row.target.name}>{row.target.name}</div>
      {row.target.identifier ? (
        <div className="truncate ui-caption text-[var(--ui-text-muted)]" title={row.target.identifier}>{row.target.identifier}</div>
      ) : null}
    </div>
  );
}

function RightsCell({ row }: { row: AccessAuditRow }) {
  const visible = row.rights.slice(0, 3);
  return (
    <div className="flex max-w-[34rem] flex-wrap gap-1" title={row.rights.map((right) => right.label).join(", ")}>
      {visible.map((right) => <UiBadge key={right.code}>{right.label}</UiBadge>)}
      {row.rights.length > visible.length ? <UiBadge>+{row.rights.length - visible.length}</UiBadge> : null}
    </div>
  );
}

function sourceLabel(source: AccessAuditRow["rights"][number]["sources"][number]) {
  return source.kind === "direct" ? "Direct" : source.group_name || `Group #${source.group_id}`;
}

function GrantedViaCell({ row }: { row: AccessAuditRow }) {
  const visible = row.rights.slice(0, 3);
  return (
    <div className="max-w-[34rem] space-y-1 ui-caption">
      {visible.map((right) => (
        <div key={right.code} className="min-w-0" title={`${right.label}: ${right.sources.map(sourceLabel).join(", ")}`}>
          <span className="font-medium text-[var(--ui-text)]">{right.label}:</span>{" "}
          <span className="text-[var(--ui-text-muted)]">{right.sources.map(sourceLabel).join(", ") || "—"}</span>
        </div>
      ))}
      {row.rights.length > visible.length ? (
        <div className="text-[var(--ui-text-muted)]">+{row.rights.length - visible.length} more rights</div>
      ) : null}
    </div>
  );
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
  const columns: Array<DataTableColumn<AccessAuditRow, AccessAuditSortBy>> = [
    ...(showUserColumn ? [{
      id: "user",
      label: "UI User",
      field: "user" as const,
      primary: true,
      render: (row: AccessAuditRow) => <PrincipalCell row={row} />,
    }] : []),
    {
      id: "scope",
      label: "Scope",
      field: "scope",
      render: (row) => <UiBadge>{scopeLabels[row.scope]}</UiBadge>,
    },
    {
      id: "target",
      label: "Target",
      field: "target",
      primary: !showUserColumn,
      render: (row) => <TargetCell row={row} />,
    },
    {
      id: "rights",
      label: "Effective rights",
      header: "Effective rights",
      render: (row) => <RightsCell row={row} />,
    },
    {
      id: "sources",
      label: "Granted via",
      header: "Granted via",
      render: (row) => <GrantedViaCell row={row} />,
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      status={status}
      loadingMessage="Loading effective access..."
      errorMessage="Unable to load effective access."
      emptyMessage={emptyMessage}
      primaryColumnId={showUserColumn ? "user" : "target"}
      responsiveCards
      sort={sortBy && sortDir && onSort ? { field: sortBy, direction: sortDir, onSort } : undefined}
      pagination={pagination}
    />
  );
}
