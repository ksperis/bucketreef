/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditLogEntry, listAuditLogs, type AuditStatus } from "../../api/audit";
import ListPageSection from "../../components/list/ListPageSection";
import PageShell from "../../components/PageShell";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import UiSelect from "../../components/ui/UiSelect";
import { intlLocale } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime } from "../../utils/dateTime";
import { useAuditLogsI18n, type AuditLogsText } from "./auditLogsMessage";
import type { UiLanguage } from "../../components/language";

type RoleFilter = "all" | "ui_superadmin" | "ui_admin" | "ui_user" | "ui_none";
type ScopeFilter = "all" | "admin" | "manager" | "portal";

const roleLabelKeys = {
  all: "allActors",
  ui_superadmin: "superadmin",
  ui_admin: "admin",
  ui_user: "user",
  ui_none: "noAccess",
} as const;

const scopeLabelKeys = {
  all: "allScopes",
  admin: "adminArea",
  manager: "managerArea",
  portal: "portalArea",
} as const;

function RoleBadge({ role, text }: { role: string; text: AuditLogsText }) {
  if (role === "ui_superadmin") {
    return (
      <ListBadge disableToneStyles className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
        {text("superadmin")}
      </ListBadge>
    );
  }
  if (role === "ui_admin") {
    return (
      <ListBadge disableToneStyles className="bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
        {text("admin")}
      </ListBadge>
    );
  }
  if (role === "ui_user") {
    return (
      <ListBadge disableToneStyles className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
        {text("user")}
      </ListBadge>
    );
  }
  if (role === "ui_none") {
    return (
      <ListBadge disableToneStyles className="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200">
        {text("noAccess")}
      </ListBadge>
    );
  }
  return (
    <ListBadge disableToneStyles className="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200">
      {role}
    </ListBadge>
  );
}

function ScopeBadge({ scope, text }: { scope: string; text: AuditLogsText }) {
  let styles = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100";
  let label = text("managerUi");
  if (scope === "admin") {
    styles = "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200";
    label = text("adminUi");
  } else if (scope === "portal") {
    styles = "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100";
    label = text("portalUi");
  }
  return <ListBadge disableToneStyles className={styles}>{label}</ListBadge>;
}

function formatAuditStatus(status: AuditStatus, text: AuditLogsText) {
  return text(status);
}

function StatusBadge({ status, text }: { status: AuditStatus; text: AuditLogsText }) {
  const tone = status === "success" ? "success" : status === "failure" ? "danger" : "neutral";
  return <ListBadge tone={tone}>{formatAuditStatus(status, text)}</ListBadge>;
}

function formatAuditDate(value: string, locale: UiLanguage) {
  return formatLocalDateTime(value, intlLocale(locale));
}

function executionContextKindLabel(kind: string | null | undefined, text: AuditLogsText): string {
  if (kind === "account" || kind === "portal_account") return text("rgwAccount");
  if (kind === "s3_user") return text("rgwUser");
  if (kind === "connection") return text("s3Connection");
  if (kind === "ceph_admin") return text("cephAdmin");
  if (kind === "session") return text("managerSession");
  return kind || text("executionContext");
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
  const { locale, text } = useAuditLogsI18n();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    fallback: "loadError" | "refreshError" | "olderError";
  } | null>(null);
  const errorMessage = error ? error.message || text(error.fallback) : null;
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AuditStatus>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadGeneration = useRef(0);

  const fetchLogs = useCallback(
    async ({ append = false, cursor }: { append?: boolean; cursor?: number | null } = {}) => {
      const generation = ++loadGeneration.current;
      const params = {
        limit: 100,
        role: roleFilter !== "all" ? roleFilter : undefined,
        scope: scopeFilter !== "all" ? scopeFilter : undefined,
        search: searchTerm.trim() || undefined,
        cursor: cursor ?? undefined,
      };
      let response;
      try {
        response = await listAuditLogs(params);
      } catch (cause) {
        if (generation !== loadGeneration.current) return false;
        throw cause;
      }
      if (generation !== loadGeneration.current) return false;
      if (append) {
        setLogs((prev) => [...prev, ...response.logs]);
      } else {
        setLogs(response.logs);
      }
      setNextCursor(response.next_cursor ?? null);
      return true;
    },
    [roleFilter, scopeFilter, searchTerm]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let currentRequest = true;
      try {
        setLoading(true);
        setLoadingMore(false);
        setError(null);
        currentRequest = await fetchLogs({ append: false });
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError({ message: extractApiError(err, ""), fallback: "loadError" });
        }
      } finally {
        if (!cancelled && currentRequest) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      loadGeneration.current += 1;
    };
  }, [fetchLogs]);

  const handleRefresh = async () => {
    let currentRequest = true;
    try {
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      currentRequest = await fetchLogs({ append: false });
    } catch (err) {
      console.error(err);
      setError({ message: extractApiError(err, ""), fallback: "refreshError" });
    } finally {
      if (currentRequest) setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loading || loadingMore) return;
    let currentRequest = true;
    try {
      setLoadingMore(true);
      currentRequest = await fetchLogs({ append: true, cursor: nextCursor });
    } catch (err) {
      console.error(err);
      setError({ message: extractApiError(err, ""), fallback: "olderError" });
    } finally {
      if (currentRequest) setLoadingMore(false);
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
    error: errorMessage,
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
          label={text("action")}
          aria-label={text("filterByAction")}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          size="compact"
        >
          <option value="all">{text("allActions")}</option>
          {actionOptions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </UiSelect>
        <UiSelect
          label={text("status")}
          aria-label={text("filterByStatus")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | AuditStatus)}
          size="compact"
        >
          <option value="all">{text("allStatuses")}</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {formatAuditStatus(status, text)}
            </option>
          ))}
        </UiSelect>
        <UiSelect
          label={text("role")}
          aria-label={text("filterByRole")}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          size="compact"
        >
          {Object.entries(roleLabelKeys).map(([value, key]) => (
            <option key={value} value={value}>
              {text(key)}
            </option>
          ))}
        </UiSelect>
        <UiSelect
          label={text("workspace")}
          aria-label={text("filterByScope")}
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
          size="compact"
        >
          {Object.entries(scopeLabelKeys).map(([value, key]) => (
            <option key={value} value={value}>
              {text(key)}
            </option>
          ))}
        </UiSelect>
      </>
    ),
    [actionFilter, actionOptions, roleFilter, scopeFilter, statusFilter, statusOptions, text]
  );
  const auditTableColumns = useMemo<Array<DataTableColumn<AuditLogEntry>>>(
    () => [
      {
        id: "time",
        label: text("time"),
        cellClassName: "whitespace-nowrap ui-caption text-slate-500 dark:text-slate-400",
        render: (log) => formatAuditDate(log.created_at, locale),
      },
      {
        id: "actor",
        label: text("actor"),
        cellClassName: "min-w-[12rem]",
        render: (log) => (
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{log.user_email}</span>
            <RoleBadge role={log.user_role} text={text} />
          </div>
        ),
      },
      {
        id: "scope",
        label: text("scope"),
        render: (log) => <ScopeBadge scope={log.scope} text={text} />,
      },
      {
        id: "action",
        label: text("action"),
        primary: true,
        cellClassName: "font-mono ui-caption",
        render: (log) => log.action,
      },
      {
        id: "status",
        label: text("status"),
        render: (log) => <StatusBadge status={log.status} text={text} />,
      },
      {
        id: "target",
        label: text("target"),
        cellClassName: "min-w-[8rem]",
        render: (log) => (
          <>
            <div className="ui-caption text-slate-600 dark:text-slate-300">{log.entity_type || "-"}</div>
            <div className="ui-body font-medium text-slate-900 dark:text-white">{log.entity_id || "-"}</div>
          </>
        ),
      },
      {
        id: "context",
        label: text("executionContext"),
        cellClassName: "min-w-[10rem]",
        render: (log) => {
          const name = log.context_name;
          const id = log.context_id;
          const kind = log.context_kind;
          if (!name && !id) return <span className="text-slate-500 dark:text-slate-400">-</span>;
          return (
            <div className="min-w-0">
              <div className="font-medium text-slate-900 dark:text-white">{name || id}</div>
              <div className="ui-caption text-slate-500 dark:text-slate-400">
                {executionContextKindLabel(kind, text)}{name && id ? ` · ${id}` : ""}
              </div>
            </div>
          );
        },
      },
      {
        id: "details",
        label: text("details"),
        cellClassName: "min-w-[18rem] max-w-[28rem]",
        render: (log) => <MetadataPreview metadata={log.metadata as Record<string, unknown> | undefined} />,
      },
    ],
    [locale, text]
  );

  return (
    <PageShell actionPresentation="listing"
      title={text("title")}
      description={text("description")}
      breadcrumbs={adminPageBreadcrumbs("audit").map((breadcrumb, index) => ({
        ...breadcrumb,
        label: index === 0 ? text("adminBreadcrumb") : text("title"),
      }))}
    >
      {errorMessage && <PageBanner tone="error">{errorMessage}</PageBanner>}

      <ListPageSection variant="page"
        title={text("title")}
        countLabel={text("loadedCount", { filtered: filteredLogs.length, total: logs.length })}
        search={
          <ToolbarSearchInput
            label={text("search")}
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder={text("searchPlaceholder")}
            className="min-w-0 flex-1 sm:w-64 md:w-72"
          />
        }
        filters={filters}
        actions={<ListActionButton onClick={handleRefresh} disabled={loading}>{text(loading ? "refreshing" : "refresh")}</ListActionButton>}
        secondaryContent={<p className="text-[var(--ui-text-muted)]">{text("filterHelp")}</p>}
      >

        <DataTableShell
          columns={auditTableColumns}
          rows={filteredLogs}
          rowKey={(log) => log.id}
          status={tableStatus}
          loadingMessage={text("loadingAudit")}
          errorMessage={text("loadError")}
          emptyMessage={
            text(logs.length === 0 && !hasActiveFilters ? "noEntries" : "noMatches")
          }
          primaryColumnId="action"
          responsiveCards
          tableClassName="ui-data-table"
        />

        <div className="ui-list-pagination flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ui-border-soft)]">
          <ListActionButton
            type="button"
            onClick={handleLoadMore}
            disabled={!hasMore || loading || loadingMore}
          >
            {text(loadingMore ? "loading" : hasMore ? "loadOlder" : "noMore")}
          </ListActionButton>
        </div>
      </ListPageSection>
    </PageShell>
  );
}
