/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import ListPageSection from "../../../components/list/ListPageSection";
import PageBanner from "../../../components/PageBanner";
import PageEmptyState from "../../../components/PageEmptyState";
import PageShell from "../../../components/PageShell";
import { type BucketMigrationStatus } from "../../../api/managerMigrations";
import { useExecutionContext } from "../ExecutionContextProvider";
import { managerPageBreadcrumbs } from "../managerBreadcrumbs";
import { useManagerContexts } from "../useManagerContexts";
import { useManagerMigrationsList } from "./hooks";
import {
  formatDateTime,
} from "./shared";

import UiBadge from "../../../components/ui/UiBadge";
import { migrationLabel } from "./MigrationWorkflow";
import { useManagerI18n } from "../managerI18n";

const SORT_PRIORITY: Record<BucketMigrationStatus, number> = {
  running: 0,
  queued: 1,
  pause_requested: 2,
  cancel_requested: 3,
  paused: 4,
  awaiting_cutover: 5,
  draft: 6,
  failed: 7,
  completed_with_errors: 8,
  canceled: 9,
  completed: 10,
  rolled_back: 11,
};

export default function ManagerMigrationsListPage() {
  const { text } = useManagerI18n();
  const navigate = useNavigate();
  const { selectedContextId, requiresContextSelection } = useExecutionContext();
  const sourceContextId = selectedContextId ?? "";

  const { contextLabelById, contextsLoading, contextsError } = useManagerContexts();
  const { migrations, migrationsLoading, migrationsError } = useManagerMigrationsList(sourceContextId);

  const sortedMigrations = useMemo(
    () =>
      [...migrations].sort((left, right) => {
      const priorityLeft = SORT_PRIORITY[left.status] ?? 99;
      const priorityRight = SORT_PRIORITY[right.status] ?? 99;
      if (priorityLeft !== priorityRight) return priorityLeft - priorityRight;
      return right.id - left.id;
    }),
    [migrations]
  );

  return (
    <PageShell
      title={text("Bucket Migration")}
      description={text("Track migrations and open an operational view for each run.")}
      breadcrumbs={managerPageBreadcrumbs(text, "migration")}
      actions={[
        {
          label: text("New migration"),
          onClick: () => navigate("/manager/migrations/new"),
        },
      ]}
    >
      {contextsLoading && <PageBanner tone="info">{text("Loading contexts…")}</PageBanner>}
      {contextsError && <PageBanner tone="error">{text(contextsError)}</PageBanner>}
      {migrationsError && <PageBanner tone="error">{text(migrationsError)}</PageBanner>}

      {!requiresContextSelection ? (
        <PageEmptyState
          title={text("Bucket migration is unavailable in session mode")}
          description={text("This tool needs a persistent execution context so it can resolve source and target inventories before launching a migration.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title={text("Select a source context before opening bucket migrations")}
          description={text("Choose an execution context to list migration runs that originate from it and to start a new migration.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title={text("Migrations")}
            countLabel={text(sortedMigrations.length === 1 ? "{count} result" : "{count} results", { count: sortedMigrations.length })}
        >
          <div className="max-h-[720px] space-y-2 overflow-auto p-4">
            {migrationsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">{text("Loading migrations...")}</p>}
            {!migrationsLoading && sortedMigrations.length === 0 && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">{text("No migrations yet.")}</p>
            )}

            {sortedMigrations.map((migration) => {
              return (
                <button
                  key={migration.id}
                  type="button"
                  onClick={() => navigate(`/manager/migrations/${migration.id}`)}
                  className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">{text("Migration #")}{migration.id}</p>
                    <UiBadge tone={migration.failed_items || migration.preparation_status === "blocked" ? "warning" : "info"}>{text(migrationLabel(migration))}</UiBadge>
                  </div>

                  <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                    {contextLabelById.get(migration.source_context_id) ?? migration.source_context_id} {"->"}{" "}
                    {contextLabelById.get(migration.target_context_id) ?? migration.target_context_id}
                  </p>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      {migration.status === "draft"
                        ? text("{checked}/{total} checked", { checked: migration.preparation_completed_items, total: migration.total_items })
                        : text("{verified} verified · {failed} failed · {awaiting} awaiting cutover · {skipped} not copied", {
                            verified: migration.completed_items,
                            failed: migration.failed_items,
                            awaiting: migration.awaiting_items,
                            skipped: migration.skipped_items,
                          })}
                    </p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">{text("updated:")} {formatDateTime(migration.updated_at)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </ListPageSection>
      )}
    </PageShell>
  );
}
