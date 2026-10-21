/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

import type { AuditStatus } from "../../api/audit";
import { listManagerActivity, type ManagerActivityEntry } from "../../api/managerActivity";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime } from "../../utils/dateTime";
import { RefreshIcon } from "../browser/browserIcons";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import { managerActivityPresentation, managerActivityTarget } from "./managerActivityPresentation";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";
import { useExecutionContext } from "./ExecutionContextProvider";

const PAGE_SIZE = 20;

function statusTone(status: ManagerActivityEntry["status"]): "success" | "danger" | "warning" {
  if (status === "success") return "success";
  if (status === "failure") return "danger";
  return "warning";
}

function statusLabel(status: ManagerActivityEntry["status"]): string {
  if (status === "success") return "Success";
  if (status === "failure") return "Failure";
  return "Partial";
}

export default function ManagerActivityPage() {
  const { text, intlLocale } = useManagerI18n();
  const {
    contextIdForApi,
    contextsLoaded,
    hasExecutionContext,
    managerFeatureStates,
  } = useExecutionContext();
  const [entries, setEntries] = useState<ManagerActivityEntry[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | AuditStatus>("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const featureStateLoading = !contextsLoaded || (hasExecutionContext && managerFeatureStates == null);
  const activityEnabled = managerFeatureStates?.activity_history?.enabled === true;

  useEffect(() => {
    if (!hasExecutionContext || !activityEnabled) {
      setEntries([]);
      setError(null);
      setLoadMoreError(null);
      setHasMore(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setLoadMoreError(null);
      listManagerActivity(contextIdForApi, {
        limit: PAGE_SIZE,
        search,
        status: status || undefined,
      })
        .then((items) => {
          if (cancelled) return;
          setEntries(items);
          setHasMore(items.length === PAGE_SIZE);
        })
        .catch((cause) => {
          if (cancelled) return;
          setEntries([]);
          setHasMore(false);
          setError(extractApiError(cause, text("Unable to load activity history.")));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [contextIdForApi, activityEnabled, hasExecutionContext, refreshNonce, search, status, text]);

  const loadOlder = useCallback(async () => {
    const cursor = entries.at(-1)?.id;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const items = await listManagerActivity(contextIdForApi, {
        limit: PAGE_SIZE,
        cursor,
        search,
        status: status || undefined,
      });
      setEntries((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...items.filter((item) => !known.has(item.id))];
      });
      setHasMore(items.length === PAGE_SIZE);
    } catch (cause) {
      setLoadMoreError(extractApiError(cause, text("Unable to load older activity.")));
    } finally {
      setLoadingMore(false);
    }
  }, [contextIdForApi, entries, loadingMore, search, status, text]);

  const columns = useMemo<DataTableColumn<ManagerActivityEntry>[]>(() => [
    {
      id: "when",
      label: text("When"),
      render: (entry) => formatLocalDateTime(entry.created_at, intlLocale),
    },
    {
      id: "actor",
      label: text("Actor"),
      primary: true,
      render: (entry) => entry.user_email,
    },
    {
      id: "action",
      label: text("Action"),
      render: (entry) => {
        const presentation = managerActivityPresentation(entry);
        return (
          <div className="min-w-0">
            <div className="font-medium text-[var(--ui-text)]">{text(presentation.label)}</div>
            <code className={cx("ui-caption break-all", uiMutedTextClass)}>{entry.action}</code>
          </div>
        );
      },
    },
    {
      id: "status",
      label: text("Status"),
      render: (entry) => <UiBadge tone={statusTone(entry.status)}>{text(statusLabel(entry.status))}</UiBadge>,
    },
    {
      id: "target",
      label: text("Target"),
      cellClassName: "break-all",
      render: (entry) => (
        <div className="min-w-0">
          <div>{managerActivityTarget(entry)}</div>
          {entry.entity_type ? <div className={cx("ui-caption", uiMutedTextClass)}>{entry.entity_type}</div> : null}
        </div>
      ),
    },
  ], [intlLocale, text]);

  if (contextsLoaded && !hasExecutionContext) return <Navigate to="/manager" replace />;
  if (!featureStateLoading && !activityEnabled) return <Navigate to="/manager" replace />;

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: entries.length });
  const filtered = Boolean(search.trim() || status);

  return (
    <div className="space-y-4" data-testid="manager-activity-page">
      <PageHeader
        title={text("Activity history")}
        description={text("Review Manager control and configuration actions for this execution context. S3 object access logs are not included.")}
        breadcrumbs={managerPageBreadcrumbs(text, "activity")}
      />

      {loadMoreError ? <PageBanner tone="warning">{loadMoreError}</PageBanner> : null}

      {featureStateLoading ? (
        <p role="status" className={uiMutedTextClass}>{text("Loading activity history...")}</p>
      ) : (
        <ListPageSection
          variant="page"
          title={text("Activity history")}
          countLabel={text(entries.length === 1 ? "{count} event loaded" : "{count} events loaded", { count: entries.length })}
          search={
            <ManagerToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder={text("Search actor, action, or target")}
              className="w-full sm:w-72 md:w-80"
            />
          }
          filters={
            <UiSelect
              label={text("Status")}
              size="compact"
              value={status}
              onChange={(event) => setStatus(event.target.value as "" | AuditStatus)}
            >
              <option value="">{text("All statuses")}</option>
              <option value="success">{text("Success")}</option>
              <option value="failure">{text("Failure")}</option>
              <option value="partial">{text("Partial")}</option>
            </UiSelect>
          }
          actions={
            <UiButton
              variant="secondary"
              size="xs"
              leftIcon={<RefreshIcon className={cx("h-3.5 w-3.5", loading && "animate-spin")} />}
              onClick={() => setRefreshNonce((value) => value + 1)}
              disabled={loading || loadingMore}
            >
              {text("Refresh")}
            </UiButton>
          }
        >
          <DataTableShell
            columns={columns}
            rows={entries}
            rowKey={(entry) => entry.id}
            status={tableStatus}
            loadingMessage={text("Loading activity history...")}
            errorMessage={error ?? text("Unable to load activity history.")}
            emptyMessage={text(filtered ? "No activity matches these filters." : "No Manager activity has been recorded for this context yet.")}
            responsiveCards
            tableLayout="fixed"
            tableClassName="w-full min-w-[820px]"
          />
          {entries.length > 0 ? (
            <div className="flex items-center justify-center border-t border-[color:var(--ui-border-soft)] px-4 py-3">
              {hasMore ? (
                <UiButton variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadOlder()}>
                  {loadingMore ? text("Loading...") : text("Load older")}
                </UiButton>
              ) : (
                <span className={cx("ui-caption", uiMutedTextClass)}>{text("No older activity.")}</span>
              )}
            </div>
          ) : null}
        </ListPageSection>
      )}
    </div>
  );
}
