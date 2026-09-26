/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ACCESS_AUDIT_RIGHTS,
  ACCESS_AUDIT_SCOPES,
  downloadAccessAuditCsv,
  listAccessAudit,
  type AccessAuditRightCode,
  type AccessAuditRow,
  type AccessAuditScope,
  type AccessAuditSortBy,
  type AccessAuditSortDir,
  type AccessAuditSourceKind,
} from "../../api/accessAudit";
import ListPageSection from "../../components/list/ListPageSection";
import { ListActionButton } from "../../components/list/ListControls";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PageShell from "../../components/PageShell";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { extractApiError } from "../../utils/apiError";
import { triggerBlobDownload } from "../../utils/download";
import AccessAuditTable from "./AccessAuditTable";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";

type AllOr<T extends string> = "all" | T;

function positiveInt(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default function AccessAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialScope = searchParams.get("scope") as AccessAuditScope | null;
  const initialRight = searchParams.get("right") as AccessAuditRightCode | null;
  const initialSource = searchParams.get("source") as AccessAuditSourceKind | null;
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [scope, setScope] = useState<AllOr<AccessAuditScope>>(initialScope && ACCESS_AUDIT_SCOPES.some((item) => item.value === initialScope) ? initialScope : "all");
  const [right, setRight] = useState<AllOr<AccessAuditRightCode>>(initialRight && ACCESS_AUDIT_RIGHTS.some((item) => item.value === initialRight) ? initialRight : "all");
  const [source, setSource] = useState<AllOr<AccessAuditSourceKind>>(initialSource === "direct" || initialSource === "group" ? initialSource : "all");
  const [userId, setUserId] = useState<number | undefined>(() => positiveInt(searchParams.get("user_id")));
  const [targetId, setTargetId] = useState<number | undefined>(() => positiveInt(searchParams.get("target_id")));
  const [sortBy, setSortBy] = useState<AccessAuditSortBy>("user");
  const [sortDir, setSortDir] = useState<AccessAuditSortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<AccessAuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => ({
    search: search.trim() || undefined,
    scope: scope === "all" ? undefined : scope,
    right: right === "all" ? undefined : right,
    source: source === "all" ? undefined : source,
    user_id: userId,
    target_id: targetId,
    sort_by: sortBy,
    sort_dir: sortDir,
  }), [right, scope, search, sortBy, sortDir, source, targetId, userId]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.scope) params.set("scope", query.scope);
    if (query.right) params.set("right", query.right);
    if (query.source) params.set("source", query.source);
    if (query.user_id) params.set("user_id", String(query.user_id));
    if (query.target_id) params.set("target_id", String(query.target_id));
    setSearchParams(params, { replace: true });
  }, [query, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAccessAudit({ ...query, page, page_size: pageSize })
      .then((response) => {
        if (cancelled) return;
        setRows(response.items);
        setTotal(response.total);
      })
      .catch((cause) => {
        if (cancelled) return;
        setRows([]);
        setTotal(0);
        setError(extractApiError(cause, "Unable to load effective access audit."));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, pageSize, query]);

  function updateFilter(action: () => void) {
    setPage(1);
    action();
  }

  function handleSort(field: AccessAuditSortBy) {
    setPage(1);
    if (field === sortBy) setSortDir((current) => current === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("asc"); }
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      triggerBlobDownload("access-audit.csv", await downloadAccessAuditCsv(query));
    } catch (cause) {
      setError(extractApiError(cause, "Unable to export effective access audit."));
    } finally {
      setExporting(false);
    }
  }

  const hasContextFilter = userId != null || targetId != null;
  const status = resolveListTableStatus({ loading, error, rowCount: rows.length });
  const hasActiveFilters = Boolean(query.search || query.scope || query.right || query.source || hasContextFilter);

  return (
    <PageShell
      actionPresentation="listing"
      title="Effective access audit"
      description="Review saved BucketReef permissions after direct and UI Group grants are combined."
      breadcrumbs={adminPageBreadcrumbs("access-audit")}
    >
      <ListPageSection
        variant="page"
        title="Effective access audit"
        countLabel={`${total} ${total === 1 ? "entry" : "entries"}`}
        search={<UiInput aria-label="Search effective access" type="search" value={search}
          onChange={(event) => updateFilter(() => setSearch(event.target.value))}
          placeholder="Search users, targets, rights, or groups" size="compact" fieldClassName="min-w-[220px] flex-1" />}
        filters={<>
          <UiSelect label="Scope" aria-label="Filter by scope" size="compact" value={scope}
            onChange={(event) => updateFilter(() => setScope(event.target.value as AllOr<AccessAuditScope>))}>
            <option value="all">All scopes</option>
            {ACCESS_AUDIT_SCOPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </UiSelect>
          <UiSelect label="Right" aria-label="Filter by right" size="compact" value={right}
            onChange={(event) => updateFilter(() => setRight(event.target.value as AllOr<AccessAuditRightCode>))}>
            <option value="all">All rights</option>
            {ACCESS_AUDIT_RIGHTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </UiSelect>
          <UiSelect label="Source" aria-label="Filter by source" size="compact" value={source}
            onChange={(event) => updateFilter(() => setSource(event.target.value as AllOr<AccessAuditSourceKind>))}>
            <option value="all">All sources</option>
            <option value="direct">Direct</option>
            <option value="group">UI Group</option>
          </UiSelect>
        </>}
        actions={<ListActionButton onClick={() => void handleExport()} loading={exporting}>Export CSV</ListActionButton>}
        secondaryContent={hasContextFilter || error ? <div className="flex flex-wrap items-center gap-2">
          {hasContextFilter ? <>
            <span>Context filter: {userId != null ? `UI User #${userId}` : ""}{userId != null && targetId != null ? " · " : ""}{targetId != null ? `Target #${targetId}` : ""}</span>
            <ListActionButton variant="ghost" onClick={() => { setPage(1); setUserId(undefined); setTargetId(undefined); }}>Clear context</ListActionButton>
          </> : null}
          {error ? <span role="alert">{error}</span> : null}
        </div> : undefined}
      >
        <AccessAuditTable
          rows={rows}
          status={status}
          emptyMessage={hasActiveFilters ? "No effective access matches the current filters." : "No effective BucketReef rights are currently granted."}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: (size) => { setPage(1); setPageSize(size); },
            disabled: loading,
          }}
        />
      </ListPageSection>
    </PageShell>
  );
}
