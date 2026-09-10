/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditLogEntry, listAuditLogs } from "../../api/audit";
import ListPageSection from "../../components/list/ListPageSection";
import PageShell from "../../components/PageShell";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import UiBadge from "../../components/ui/UiBadge";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { extractApiError } from "../../utils/apiError";

type RoleFilter = "all" | "ui_superadmin" | "ui_admin" | "ui_user" | "ui_none";
type ScopeFilter = "all" | "admin" | "manager" | "portal";

const roleLabels: Record<RoleFilter, string> = {
  all: "All actors",
  ui_superadmin: "Superadmin",
  ui_admin: "Admin",
  ui_user: "User",
  ui_none: "No access",
};

const scopeLabels: Record<ScopeFilter, string> = {
  all: "All scopes",
  admin: "Admin area",
  manager: "Manager area",
  portal: "Portal area",
};

function RoleBadge({ role }: { role: string }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold";
  if (role === "ui_superadmin") {
    return (
      <span className={`${base} bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200`}>
        Superadmin
      </span>
    );
  }
  if (role === "ui_admin") {
    return <span className={`${base} bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200`}>Admin</span>;
  }
  if (role === "ui_user") {
    return (
      <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100`}>User</span>
    );
  }
  if (role === "ui_none") {
    return (
      <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200`}>No access</span>
    );
  }
  return <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200`}>{role}</span>;
}

function ScopeBadge({ scope }: { scope: string }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold";
  let styles = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100";
  let label = "Manager UI";
  if (scope === "admin") {
    styles = "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200";
    label = "Admin UI";
  } else if (scope === "portal") {
    styles = "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100";
    label = "Portal UI";
  }
  return <span className={`${base} ${styles}`}>{label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "success" ? "success" : status === "failure" || status === "failed" ? "danger" : "neutral";
  return <UiBadge tone={tone}>{status.charAt(0).toUpperCase() + status.slice(1)}</UiBadge>;
}

function formatAuditDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function MetadataPreview({ metadata }: { metadata?: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
  }
  return (
    <pre className="max-h-36 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-3 py-2 ui-caption leading-relaxed text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  );
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchLogs = useCallback(
    async ({ append = false, cursor }: { append?: boolean; cursor?: number | null } = {}) => {
      const params = {
        limit: 100,
        role: roleFilter !== "all" ? roleFilter : undefined,
        scope: scopeFilter !== "all" ? scopeFilter : undefined,
        search: searchTerm.trim() || undefined,
        cursor: cursor ?? undefined,
      };
      const response = await listAuditLogs(params);
      if (append) {
        setLogs((prev) => [...prev, ...response.logs]);
      } else {
        setLogs(response.logs);
      }
      setNextCursor(response.next_cursor ?? null);
    },
    [roleFilter, scopeFilter, searchTerm]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await fetchLogs({ append: false });
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError(extractApiError(err, "Unable to load audit logs."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchLogs]);

  const handleRefresh = async () => {
    try {
      setLoading(true);
      setError(null);
      await fetchLogs({ append: false });
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to refresh audit logs."));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    try {
      setLoadingMore(true);
      await fetchLogs({ append: true, cursor: nextCursor });
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to load older logs."));
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = Boolean(nextCursor);
  const actionOptions = useMemo(() => {
    const actions = Array.from(new Set(logs.map((log) => log.action).filter(Boolean)));
    actions.sort((a, b) => a.localeCompare(b));
    return actions;
  }, [logs]);
  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set(logs.map((log) => log.status).filter(Boolean)));
    statuses.sort((a, b) => a.localeCompare(b));
    return statuses;
  }, [logs]);
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false;
      if (actionFilter !== "all" && log.action !== actionFilter) return false;
      return true;
    });
  }, [actionFilter, logs, statusFilter]);
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredLogs.length,
  });
  const hasActiveFilters =
    roleFilter !== "all" ||
    scopeFilter !== "all" ||
    statusFilter !== "all" ||
    actionFilter !== "all" ||
    searchTerm.trim().length > 0;

  const filters = useMemo(
    () => (
      <>
        <UiSelect
          label="Action"
          aria-label="Filter by action"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          size="compact"
        >
          <option value="all">All actions</option>
          {actionOptions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </UiSelect>
        <UiSelect
          label="Status"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          size="compact"
        >
          <option value="all">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </option>
          ))}
        </UiSelect>
        <UiSelect
          label="Role"
          aria-label="Filter by actor role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          size="compact"
        >
          {Object.entries(roleLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </UiSelect>
        <UiSelect
          label="Workspace"
          aria-label="Filter by workspace scope"
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
          size="compact"
        >
          {Object.entries(scopeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </UiSelect>
      </>
    ),
    [actionFilter, actionOptions, roleFilter, scopeFilter, statusFilter, statusOptions]
  );
  const auditTableColumns = useMemo<Array<DataTableColumn<AuditLogEntry>>>(
    () => [
      {
        id: "time",
        label: "Time",
        cellClassName: "whitespace-nowrap ui-caption text-slate-500 dark:text-slate-400",
        render: (log) => formatAuditDate(log.created_at),
      },
      {
        id: "actor",
        label: "Actor",
        cellClassName: "min-w-[12rem]",
        render: (log) => (
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{log.user_email}</span>
            <RoleBadge role={log.user_role} />
          </div>
        ),
      },
      {
        id: "scope",
        label: "Scope",
        render: (log) => <ScopeBadge scope={log.scope} />,
      },
      {
        id: "action",
        label: "Action",
        primary: true,
        cellClassName: "font-mono ui-caption",
        render: (log) => log.action,
      },
      {
        id: "status",
        label: "Status",
        render: (log) => <StatusBadge status={log.status} />,
      },
      {
        id: "target",
        label: "Target",
        cellClassName: "min-w-[8rem]",
        render: (log) => (
          <>
            <div className="ui-caption text-slate-600 dark:text-slate-300">{log.entity_type || "-"}</div>
            <div className="ui-body font-medium text-slate-900 dark:text-white">{log.entity_id || "-"}</div>
          </>
        ),
      },
      {
        id: "account",
        label: "S3 Account/User",
        cellClassName: "min-w-[10rem]",
        render: (log) =>
          log.account_name ? (
            <div className="font-medium text-slate-900 dark:text-white">{log.account_name}</div>
          ) : log.account_id ? (
            <div className="text-slate-600 dark:text-slate-300">S3Account #{log.account_id}</div>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">-</span>
          ),
      },
      {
        id: "details",
        label: "Details",
        cellClassName: "min-w-[18rem] max-w-[28rem]",
        render: (log) => <MetadataPreview metadata={log.metadata as Record<string, unknown> | undefined} />,
      },
    ],
    []
  );

  return (
    <PageShell actionPresentation="listing"
      title="Audit trail"
      description="Control-plane and security events. Object operations belong in provider S3 access logs."
      breadcrumbs={adminPageBreadcrumbs("audit")}
    >
      {error && <PageBanner tone="error">{error}</PageBanner>}

      <ListPageSection variant="page"
        className="bg-white/95 dark:bg-slate-900/60"
        title="Audit trail"
        countLabel={`${filteredLogs.length} of ${logs.length} loaded entries`}
        search={
          <UiInput
            aria-label="Search audit logs"
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by actor, action, target, or message"
            fieldClassName="min-w-[220px] flex-1"
            size="compact"
          />
        }
        filters={filters}
        actions={<ListActionButton onClick={handleRefresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</ListActionButton>}
        secondaryContent={<p className="text-[var(--ui-text-muted)]">Action and status filters apply to loaded entries. Load older entries to extend the results.</p>}
      >

        <DataTableShell
          columns={auditTableColumns}
          rows={filteredLogs}
          rowKey={(log) => log.id}
          status={tableStatus}
          loadingMessage="Loading audit data..."
          errorMessage="Unable to load audit logs."
          emptyMessage={
            logs.length === 0 && !hasActiveFilters ? "No audit entries." : "No audit entries match the current filters."
          }
          primaryColumnId="action"
          responsiveCards
          tableClassName="ui-data-table"
          rowClassName="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
        />

        <div className="ui-list-pagination flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ui-border-soft)]">
          <ListActionButton
            type="button"
            onClick={handleLoadMore}
            disabled={!hasMore || loadingMore}
          >
            {loadingMore ? "Loading…" : hasMore ? "Load older" : "No more"}
          </ListActionButton>
        </div>
      </ListPageSection>
    </PageShell>
  );
}
