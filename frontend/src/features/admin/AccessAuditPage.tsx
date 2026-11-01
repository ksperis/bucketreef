/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ACCESS_AUDIT_RIGHTS,
  ACCESS_AUDIT_SCOPES,
  ACCESS_AUDIT_SOURCES,
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
import { useAccessAuditI18n } from "./accessAuditMessage";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import useAdminPaginationState from "./useAdminPaginationState";
import useAdminPaginatedResourceController from "./useAdminPaginatedResourceController";

type AllOr<T extends string> = "all" | T;

function positiveInt(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default function AccessAuditPage() {
  const { text, scopeLabel, rightLabel } = useAccessAuditI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialScope = searchParams.get("scope") as AccessAuditScope | null;
  const initialRight = searchParams.get("right") as AccessAuditRightCode | null;
  const initialSource = searchParams.get("source") as AccessAuditSourceKind | null;
  const {
    filter: search,
    page,
    pageSize,
    handleFilterChange,
    handlePageChange,
    handlePageSizeChange,
    resetPage,
    ensurePageInRange,
  } = useAdminPaginationState({ initialFilter: searchParams.get("search") ?? "" });
  const [scope, setScope] = useState<AllOr<AccessAuditScope>>(initialScope && ACCESS_AUDIT_SCOPES.some((item) => item.value === initialScope) ? initialScope : "all");
  const [right, setRight] = useState<AllOr<AccessAuditRightCode>>(initialRight && ACCESS_AUDIT_RIGHTS.some((item) => item.value === initialRight) ? initialRight : "all");
  const [source, setSource] = useState<AllOr<AccessAuditSourceKind>>(
    initialSource && ACCESS_AUDIT_SOURCES.includes(initialSource) ? initialSource : "all",
  );
  const [userId, setUserId] = useState<number | undefined>(() => positiveInt(searchParams.get("user_id")));
  const [groupId, setGroupId] = useState<number | undefined>(() => positiveInt(searchParams.get("group_id")));
  const [targetId, setTargetId] = useState<number | undefined>(() => positiveInt(searchParams.get("target_id")));
  const [sortBy, setSortBy] = useState<AccessAuditSortBy>("user");
  const [sortDir, setSortDir] = useState<AccessAuditSortDir>("asc");
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => ({
    search: search.trim() || undefined,
    scope: scope === "all" ? undefined : scope,
    right: right === "all" ? undefined : right,
    source: source === "all" ? undefined : source,
    user_id: userId,
    group_id: groupId,
    target_id: targetId,
    sort_by: sortBy,
    sort_dir: sortDir,
  }), [groupId, right, scope, search, sortBy, sortDir, source, targetId, userId]);
  const loadAccessAuditPage = useCallback(
    () => listAccessAudit({ ...query, page, page_size: pageSize }),
    [page, pageSize, query],
  );
  const formatAccessAuditLoadError = useCallback(
    (cause: unknown) => extractApiError(cause, text("loadError")),
    [text],
  );
  const {
    items: rows,
    total,
    loading,
    error,
    setError,
  } = useAdminPaginatedResourceController<AccessAuditRow>({
    loadPage: loadAccessAuditPage,
    ensurePageInRange,
    formatError: formatAccessAuditLoadError,
    resetResourceOnError: true,
  });

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.scope) params.set("scope", query.scope);
    if (query.right) params.set("right", query.right);
    if (query.source) params.set("source", query.source);
    if (query.user_id) params.set("user_id", String(query.user_id));
    if (query.group_id) params.set("group_id", String(query.group_id));
    if (query.target_id) params.set("target_id", String(query.target_id));
    setSearchParams(params, { replace: true });
  }, [query, setSearchParams]);

  function handleSort(field: AccessAuditSortBy) {
    resetPage();
    if (field === sortBy) setSortDir((current) => current === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("asc"); }
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      triggerBlobDownload("access-audit.csv", await downloadAccessAuditCsv(query));
    } catch (cause) {
      setError(extractApiError(cause, text("exportError")));
    } finally {
      setExporting(false);
    }
  }

  const hasContextFilter = userId != null || groupId != null || targetId != null;
  const status = resolveListTableStatus({ loading, error, rowCount: rows.length });
  const hasActiveFilters = Boolean(query.search || query.scope || query.right || query.source || hasContextFilter);
  const contextLabel = useMemo(() => {
    const parts: string[] = [];
    if (userId != null) {
      const principal = rows.find((row) => row.principal.id === userId)?.principal;
      parts.push(text("uiUserContext", { name: principal?.full_name?.trim() || principal?.email || `#${userId}` }));
    }
    if (groupId != null) {
      const source = rows
        .flatMap((row) => row.rights)
        .flatMap((right) => right.sources)
        .find((candidate) => candidate.kind === "group" && candidate.group_id === groupId);
      parts.push(text("uiGroupContext", { name: source?.group_name || `#${groupId}` }));
    }
    if (targetId != null) {
      const target = rows.find((row) => row.target.id === targetId)?.target;
      const label = scope === "all"
        ? text("target")
        : scopeLabel(scope, ACCESS_AUDIT_SCOPES.find((item) => item.value === scope)?.label ?? text("target"));
      parts.push(text("targetContext", { scope: label, name: target?.name || `#${targetId}` }));
    }
    return parts.join(" · ");
  }, [groupId, rows, scope, scopeLabel, targetId, text, userId]);

  return (
    <PageShell
      actionPresentation="listing"
      title={text("title")}
      description={text("description")}
      breadcrumbs={adminPageBreadcrumbs("access-audit").map((breadcrumb, index) => ({
        ...breadcrumb, label: text(index === 0 ? "admin" : "accessAudit"),
      }))}
    >
      <ListPageSection
        variant="page"
        title={text("title")}
        countLabel={text(total === 1 ? "entryCount" : "entriesCount", { count: total })}
        search={<UiInput aria-label={text("searchAccess")} type="search" value={search}
          onChange={(event) => handleFilterChange(event.target.value)}
          placeholder={text("searchPlaceholder")} size="compact" fieldClassName="min-w-[220px] flex-1" />}
        filters={<>
          <UiSelect label={text("scope")} aria-label={text("filterScope")} size="compact" value={scope}
            onChange={(event) => {
              resetPage();
              setScope(event.target.value as AllOr<AccessAuditScope>);
            }}>
            <option value="all">{text("allScopes")}</option>
            {ACCESS_AUDIT_SCOPES.map((item) => <option key={item.value} value={item.value}>{scopeLabel(item.value, item.label)}</option>)}
          </UiSelect>
          <UiSelect label={text("right")} aria-label={text("filterRight")} size="compact" value={right}
            onChange={(event) => {
              resetPage();
              setRight(event.target.value as AllOr<AccessAuditRightCode>);
            }}>
            <option value="all">{text("allRights")}</option>
            {ACCESS_AUDIT_RIGHTS.map((item) => <option key={item.value} value={item.value}>{rightLabel(item.value, item.label)}</option>)}
          </UiSelect>
          <UiSelect label={text("source")} aria-label={text("filterSource")} size="compact" value={source}
            onChange={(event) => {
              resetPage();
              setSource(event.target.value as AllOr<AccessAuditSourceKind>);
            }}>
            <option value="all">{text("allSources")}</option>
            <option value="platform">{text("platform")}</option>
            <option value="direct">{text("direct")}</option>
            <option value="group">{text("uiGroup")}</option>
          </UiSelect>
        </>}
        actions={<ListActionButton onClick={() => void handleExport()} loading={exporting}>{text("exportCsv")}</ListActionButton>}
        secondaryContent={hasContextFilter || error ? <div className="flex flex-wrap items-center gap-2">
          {hasContextFilter ? <>
            <span>{text("contextFilter", { context: contextLabel })}</span>
            <ListActionButton variant="ghost" onClick={() => {
              resetPage();
              setUserId(undefined);
              setGroupId(undefined);
              setTargetId(undefined);
            }}>{text("clearContext")}</ListActionButton>
          </> : null}
          {error ? <span role="alert">{error}</span> : null}
        </div> : undefined}
      >
        <AccessAuditTable
          rows={rows}
          status={status}
          emptyMessage={text(hasActiveFilters ? "noMatchingAccess" : "noGrantedRights")}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: handlePageChange,
            onPageSizeChange: handlePageSizeChange,
            disabled: loading,
          }}
        />
      </ListPageSection>
    </PageShell>
  );
}
