/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../../../api/managerMigrations";
import ErrorState from "../../../components/errors/ErrorState";
import ConfirmActionDialog from "../../../components/ConfirmActionDialog";
import WorkflowPage, {
  WorkflowSection,
  WorkflowMetadata,
} from "../../../components/WorkflowPage";
import DataTableShell from "../../../components/list/DataTableShell";
import UiActionMenu from "../../../components/ui/UiActionMenu";
import UiBadge from "../../../components/ui/UiBadge";
import UiButton from "../../../components/ui/UiButton";
import UiDetails from "../../../components/ui/UiDetails";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiProgressBar from "../../../components/ui/UiProgressBar";
import { useManagerMigrationDetail } from "./hooks";
import { managerPageBreadcrumbs } from "../managerBreadcrumbs";
import { useManagerContexts } from "../useManagerContexts";
import { extractError, formatDateTime, stepLabel } from "./shared";
import { MigrationStages, migrationLabel } from "./MigrationWorkflow";

type Action =
  | "precheck"
  | "active_checks"
  | "start"
  | "edit"
  | "pause"
  | "resume"
  | "cutover"
  | "stop"
  | "retry"
  | "restore_access"
  | "cleanup_source"
  | "cleanup_target"
  | "delete";
const actionLabels: Record<Action, string> = {
  precheck: "Run read-only checks",
  active_checks: "Run active checks",
  start: "Start copy",
  edit: "Correct configuration",
  pause: "Pause copy",
  resume: "Resume copy",
  cutover: "Start cutover",
  stop: "Stop migration",
  retry: "Retry failed buckets",
  restore_access: "Restore access",
  cleanup_source: "Delete source buckets",
  cleanup_target: "Delete incomplete destinations",
  delete: "Delete migration record",
};
const confirmation: Partial<
  Record<Action, { description: string; impacts: string[] }>
> = {
  active_checks: {
    description:
      "Verify permissions and protections before copying. The draft remains in preparation.",
    impacts: [
      "Source writes are temporarily blocked while the protection policy is tested and restored.",
      "Temporary destination buckets are created, written to and deleted. Requested configuration operations are tested there.",
      "Temporary read grants are tested only if explicitly enabled. An incomplete restoration blocks the migration.",
    ],
  },
  start: {
    description:
      "Start the reviewed backend plan for this configuration revision.",
    impacts: [
      "Pre-copy waits for an explicit cutover. Immediate migration blocks source writes from the start.",
      "Source buckets are retained. Deletion is a separate operation.",
    ],
  },
  cutover: {
    description:
      "Finalize transfer for the listed buckets and verify their contents.",
    impacts: [
      "Source writes will be blocked before the final synchronization.",
      "Successful sources remain read-only. Update client applications to use the destination yourself; BucketReef does not change their configuration.",
    ],
  },
  stop: {
    description:
      "Stop the transfer and restore its source and destination access protections.",
    impacts: [
      "Copied data remains at the destination. The source is not deleted.",
      "Restoration errors will stay visible and require recovery.",
    ],
  },
  restore_access: {
    description:
      "Restore recorded access policies and remove temporary check resources.",
    impacts: [
      "Source writes can resume. Previously verified copies can then diverge.",
      "Copied destination data is retained. Partial source deletion cannot be undone.",
    ],
  },
  cleanup_source: {
    description:
      "Permanently delete source buckets after fresh SHA-256 verification of contents, tags and version history.",
    impacts: [
      "Source and destination writes are protected during verification and deletion.",
      "All source objects, versions, delete markers and the buckets themselves are permanently removed.",
      "Client applications must already use the destination. The verified copy is retained.",
    ],
  },
  cleanup_target: {
    description: "Delete incomplete destinations created by this migration.",
    impacts: [
      "All data in failed destination buckets is permanently removed, including versions.",
      "Successful copies are retained. Restore source writes separately if necessary.",
    ],
  },
  delete: {
    description: "Delete this migration record and its history.",
    impacts: [
      "Bucket data is retained. Access protections must be restored first.",
    ],
  },
};

function Diagnostics({
  entries,
}: {
  entries: api.BucketMigrationPrecheckEntry[];
}) {
  return (
    <div className="space-y-2">
      {entries.map((entry, index) => (
        <UiInlineMessage
          key={`${entry.code}-${index}`}
          tone={
            entry.code === "active_checks_required"
              ? "info"
              : entry.blocking
                ? "error"
                : "warning"
          }
        >
          <p>{entry.message}</p>
          {entry.permission && (
            <p className="mt-1">Required permission: {entry.permission}</p>
          )}
          {entry.remediation && (
            <p className="mt-1">Next: {entry.remediation}</p>
          )}
        </UiInlineMessage>
      ))}
    </div>
  );
}

export default function ManagerMigrationDetailPage() {
  const { migrationId } = useParams<{ migrationId: string }>();
  const id = Number(migrationId);
  const validId = Number.isSafeInteger(id) && id > 0 ? id : null;
  const navigate = useNavigate();
  const { contextLabelById } = useManagerContexts();
  const {
    migrationDetail: migration,
    detailLoading,
    detailError,
    loadFailure,
    refresh,
  } = useManagerMigrationDetail(validId);
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  if (!validId)
    return (
      <ErrorState
        kind="invalid_link"
        primaryAction={{
          label: "Back to migrations",
          to: "/manager/migrations",
        }}
      />
    );
  if (!migration && !detailLoading)
    return (
      <ErrorState
        kind={loadFailure ? undefined : "not_found"}
        error={loadFailure}
        onRetry={refresh}
        primaryAction={{
          label: "Back to migrations",
          to: "/manager/migrations",
        }}
      />
    );
  if (!migration) return <p role="status">Loading migration…</p>;

  const draft = migration.status === "draft";
  const checking = migration.preparation_status === "checking";
  const maintenanceBusy = ["queued", "running"].includes(
    migration.maintenance_status ?? "",
  );
  const allowed = (action: Action) =>
    Boolean(
      migration.available_actions?.[
        action === "active_checks" ? "precheck" : action
      ]?.enabled,
    );
  const report = migration.precheck_report;
  const reports = new Map(report?.items?.map((item) => [item.item_id, item]));
  const problems = (entries: api.BucketMigrationPrecheckEntry[] = []) =>
    entries.filter(
      (entry) =>
        entry.blocking || (entry.severity ?? entry.level) === "warning",
    );
  const otherBlockers = report?.items?.some((item) =>
    item.checks?.some(
      (check) => check.blocking && check.code !== "active_checks_required",
    ),
  );
  const primary: Action | null =
    allowed("restore_access") &&
    (migration.items.some(
      (item) => item.recovery_required || item.cleanup_error,
    ) ||
      Boolean(migration.maintenance_error))
      ? "restore_access"
      : draft
        ? checking
          ? null
          : allowed("start")
            ? "start"
            : otherBlockers && allowed("edit")
              ? "edit"
              : allowed("precheck")
                ? report && !migration.preparation_active_checks
                  ? "active_checks"
                  : "precheck"
                : null
        : allowed("retry")
          ? "retry"
          : allowed("cutover")
            ? "cutover"
            : allowed("resume")
              ? "resume"
              : allowed("pause")
                ? "pause"
                : null;
  const stage = maintenanceBusy
    ? 5
    : draft
      ? 1
      : migration.status === "awaiting_cutover"
        ? 3
        : [
              "completed",
              "completed_with_errors",
              "failed",
              "canceled",
              "rolled_back",
            ].includes(migration.status)
          ? 4
          : 2;
  const affectedBuckets = migration.items.filter((item) => {
    if (pending === "cleanup_source")
      return item.status === "completed" && !item.source_deleted;
    if (pending === "cleanup_target")
      return item.status === "failed" && item.target_created_by_migration;
    if (pending === "restore_access")
      return (
        item.recovery_required ||
        item.read_only_applied ||
        item.target_lock_applied
      );
    if (pending === "cutover") return item.status === "awaiting_cutover";
    return true;
  });
  const bucketNames = affectedBuckets
    .map((item) => `${item.source_bucket} → ${item.target_bucket}`)
    .join(", ");
  const perform = async (action: Action) => {
    setBusy(true);
    setError(null);
    try {
      switch (action) {
        case "edit":
          navigate(`/manager/migrations/new?from=${id}`);
          return;
        case "precheck":
          await api.runManagerMigrationPrecheck(id, false);
          break;
        case "active_checks":
          await api.runManagerMigrationPrecheck(id, true);
          break;
        case "start":
          if (!migration.configuration_revision)
            throw new Error("Reload the checked configuration.");
          await api.startManagerMigration(
            id,
            migration.configuration_revision,
            migration.mode === "one_shot",
          );
          break;
        case "cutover":
          await api.continueManagerMigration(id, true);
          break;
        case "pause":
          await api.pauseManagerMigration(id);
          break;
        case "resume":
          await api.resumeManagerMigration(id);
          break;
        case "stop":
          await api.stopManagerMigration(id);
          break;
        case "retry":
          await api.retryFailedManagerMigrationItems(id);
          break;
        case "restore_access":
        case "cleanup_source":
        case "cleanup_target":
          await api.runManagerMigrationMaintenance(id, action);
          break;
        case "delete":
          await api.deleteManagerMigration(id);
          navigate("/manager/migrations");
          return;
      }
      setPending(null);
      await refresh();
    } catch (failure) {
      setError(extractError(failure));
    } finally {
      setBusy(false);
    }
  };
  const choose = (action: Action) => {
    if (confirmation[action]) {
      setError(null);
      setPending(action);
    } else void perform(action);
  };
  const secondary = (Object.keys(actionLabels) as Action[]).filter(
    (action) =>
      action !== primary &&
      (draft
        ? [
            "edit",
            "precheck",
            "active_checks",
            "restore_access",
            "delete",
          ].includes(action)
        : !["edit", "precheck", "active_checks", "start"].includes(action)),
  );

  return (
    <WorkflowPage
      title={`Migration #${id}`}
      description="Review checks, control the transfer and resolve remaining actions."
      breadcrumbs={managerPageBreadcrumbs("migration", { label: "Details" })}
      backLabel="Back to migrations"
      backTo="/manager/migrations"
      width="wide"
      contentClassName="space-y-6"
    >
      <MigrationStages current={stage} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UiBadge
          tone={
            migration.failed_items ||
            migration.preparation_status === "blocked" ||
            migration.maintenance_error
              ? "warning"
              : "info"
          }
        >
          {migrationLabel(migration)}
        </UiBadge>
        <div className="flex flex-wrap gap-2">
          {primary && (
            <UiButton
              size="sm"
              disabled={busy || maintenanceBusy}
              onClick={() => choose(primary)}
            >
              {busy ? "Working…" : actionLabels[primary]}
            </UiButton>
          )}
          <UiActionMenu
            ariaLabel="Migration actions"
            trigger="More actions"
            triggerClassName="ui-list-action-button"
            sections={[
              {
                id: "actions",
                items: secondary.map((action) => ({
                  id: action,
                  label: actionLabels[action],
                  disabled: busy || !allowed(action),
                  disabledReason:
                    migration.available_actions?.[
                      action === "active_checks" ? "precheck" : action
                    ]?.reason ?? "Unavailable in this state.",
                  danger: action.startsWith("cleanup") || action === "delete",
                  onSelect: () => choose(action),
                })),
              },
            ]}
          />
        </div>
      </div>
      <WorkflowMetadata
        items={[
          {
            label: "Source identity",
            value:
              contextLabelById.get(migration.source_context_id) ??
              migration.source_context_id,
          },
          {
            label: "Destination identity",
            value:
              contextLabelById.get(migration.target_context_id) ??
              migration.target_context_id,
          },
          { label: "Updated", value: formatDateTime(migration.updated_at) },
        ]}
      />
      <div ref={errorRef} tabIndex={-1} className="outline-none">
        {(error || detailError) && (
          <UiInlineMessage tone="error" role="alert">
            {error || detailError} Your saved migration is retained.
          </UiInlineMessage>
        )}
      </div>
      {migration.error_message && (
        <UiInlineMessage tone="error" role="alert">
          {migration.error_message}
        </UiInlineMessage>
      )}
      {migration.maintenance_error && (
        <UiInlineMessage tone="error" role="alert">
          Recovery needs attention: {migration.maintenance_error} The transfer
          result is retained.
        </UiInlineMessage>
      )}
      {maintenanceBusy && (
        <UiInlineMessage tone="info" role="status">
          Recovery is running in the background. You can leave and return to
          this page.
        </UiInlineMessage>
      )}
      {draft ? (
        <WorkflowSection
          title="Preparation checks"
          description="Read-only analysis comes first. Active permission tests need your confirmation. Passing checks never starts a copy."
        >
          <p role="status" aria-live="polite" className="ui-caption">
            {migration.preparation_completed_items ?? 0} of{" "}
            {migration.total_items} buckets checked. {report?.errors ?? 0}{" "}
            blocking checks, {report?.warnings ?? 0} warnings.
          </p>
          {checking && (
            <UiProgressBar
              label="Buckets checked"
              value={
                migration.total_items
                  ? (100 * (migration.preparation_completed_items ?? 0)) /
                    migration.total_items
                  : null
              }
            />
          )}
          {migration.preparation_status === "stale" && (
            <UiInlineMessage tone="warning">
              Checks have expired or the configuration changed. Run checks again
              before starting.
            </UiInlineMessage>
          )}
          <Diagnostics entries={problems(report?.checks)} />
        </WorkflowSection>
      ) : (
        <WorkflowSection title="Transfer result">
          <p role="status" aria-live="polite" className="ui-caption">
            {migration.completed_items} buckets verified,{" "}
            {migration.failed_items} failed, {migration.awaiting_items} awaiting
            cutover, {migration.skipped_items} not copied.
          </p>
          {migration.status === "awaiting_cutover" && (
            <UiInlineMessage tone="info">
              Pre-copy is finished. Source writes are still allowed. Start
              cutover when ready to interrupt them, synchronize the final
              changes and verify the copy.
            </UiInlineMessage>
          )}
          {migration.items.some(
            (item) => item.read_only_applied && !item.source_deleted,
          ) && (
            <UiInlineMessage tone="warning">
              Source buckets with a read-only protection are retained. Update
              client applications yourself after a verified cutover. Restore
              access and source deletion are separate actions.
            </UiInlineMessage>
          )}
        </WorkflowSection>
      )}
      <DataTableShell
        rows={[...migration.items].sort(
          (a, b) =>
            Number(
              Boolean(reports.get(b.id)?.blocking || b.status === "failed"),
            ) -
            Number(
              Boolean(reports.get(a.id)?.blocking || a.status === "failed"),
            ),
        )}
        rowKey={(item) => item.id}
        responsiveCards
        tableLayout="fixed"
        status={migration.items.length ? "ready" : "empty"}
        loadingMessage="Loading buckets…"
        errorMessage="Unable to load buckets."
        emptyMessage="No buckets."
        columns={[
          {
            id: "bucket",
            label: "Bucket mapping",
            primary: true,
            render: (item) => (
              <div className="break-all">
                <p>{item.source_bucket}</p>
                <p className="text-[var(--ui-text-muted)]">
                  → {item.target_bucket}
                </p>
              </div>
            ),
          },
          {
            id: "state",
            label: draft ? "Check result" : "Phase and outcome",
            render: (item) => {
              const checked = reports.get(item.id);
              return (
                <div className="space-y-1">
                  <p>
                    {draft
                      ? checked
                        ? checked.state === "unverified"
                          ? "Active checks required"
                          : checked.blocking
                            ? "Blocked"
                            : checked.warnings
                              ? "Ready with warnings"
                              : "Ready"
                        : "Not checked"
                      : item.status === "completed"
                        ? "Copy verified"
                        : item.status === "failed"
                          ? "Copy needs attention"
                          : stepLabel(item.step)}
                  </p>
                  {!draft && <p>{item.objects_copied} objects transferred</p>}
                  {!draft && (
                    <p>
                      {item.source_deleted
                        ? "Source deleted"
                        : item.read_only_applied
                          ? "Source retained, read-only"
                          : "Source retained"}
                    </p>
                  )}
                  {item.target_lock_applied && (
                    <p>Destination write protection active</p>
                  )}
                  {item.recovery_required && (
                    <UiBadge tone="danger">Restoration required</UiBadge>
                  )}
                </div>
              );
            },
          },
          {
            id: "diagnosis",
            label: "Next action and diagnostics",
            render: (item) => (
              <div className="space-y-2">
                <Diagnostics
                  entries={
                    draft
                      ? problems(
                          reports.get(item.id)?.checks ??
                            reports.get(item.id)?.messages,
                        )
                      : []
                  }
                />
                {item.error_message && (
                  <UiInlineMessage tone="error">
                    {item.error_message}
                    <p className="mt-1">
                      Correct the cause, then retry failed buckets. Successful
                      copies are retained.
                    </p>
                  </UiInlineMessage>
                )}
                {item.cleanup_error && (
                  <UiInlineMessage tone="error">
                    Cleanup: {item.cleanup_error}
                  </UiInlineMessage>
                )}
                {item.diff_sample && (
                  <UiDetails>
                    <summary className="cursor-pointer">
                      Differences found
                    </summary>
                    <pre className="whitespace-pre-wrap break-all">
                      {JSON.stringify(item.diff_sample, null, 2)}
                    </pre>
                  </UiDetails>
                )}
                <UiDetails>
                  <summary className="cursor-pointer">
                    Technical details for {item.source_bucket}
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all ui-caption">
                    {JSON.stringify(
                      {
                        source_identity: migration.source_context_id,
                        destination_identity: migration.target_context_id,
                        phase: item.step,
                        checks: reports.get(item.id)?.checks,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </UiDetails>
              </div>
            ),
          },
        ]}
      />
      {report?.items?.length ? (
        <WorkflowSection
          title="Reviewed plan"
          description={`Configuration revision ${migration.configuration_revision ?? "unknown"}. Checked ${formatDateTime(migration.precheck_checked_at)}.`}
        >
          <p className="ui-caption">
            {migration.mode === "pre_sync"
              ? "Pre-copy, then manual cutover"
              : "Immediate migration with source write interruption"}{" "}
            ·{" "}
            {migration.use_same_endpoint_copy
              ? "Copy within storage"
              : "Copy via BucketReef"}{" "}
            · Source retained
          </p>
          <ul className="list-disc pl-5 ui-caption space-y-2">
            {report.items.map((item) => (
              <li key={item.item_id}>
                <p>
                  {item.source_bucket}:{" "}
                  {item.strategy === "version_aware"
                    ? "Objects, version history and delete markers"
                    : "Current objects and their tags"}
                  {item.source_object_count == null
                    ? "; object total unknown"
                    : `; ${item.source_object_count} current objects`}
                  .
                </p>
                <p>
                  Settings copied:{" "}
                  {item.settings_copied
                    ?.map((name) => name.replaceAll("_", " "))
                    .join(", ") || "None recorded in this plan"}
                  .
                </p>
                <p>
                  Settings omitted:{" "}
                  {item.settings_omitted
                    ?.map((name) => name.replaceAll("_", " "))
                    .join(", ") || "See the original report"}
                  .
                </p>
              </li>
            ))}
          </ul>
          <p className="ui-caption">
            {migration.auto_grant_source_read_for_copy
              ? "Temporary source read grants were explicitly enabled."
              : "No temporary source read grants."}{" "}
            {migration.lock_target_writes
              ? "Destination writes protected during transfer."
              : "Destination writes are not protected during transfer."}
          </p>
        </WorkflowSection>
      ) : null}
      <UiDetails>
        <summary className="cursor-pointer ui-caption">
          Activity history
        </summary>
        <ol className="mt-3 space-y-2 ui-caption">
          {migration.recent_events.map((event) => (
            <li key={event.id}>
              {formatDateTime(event.created_at)} — {event.message}
            </li>
          ))}
        </ol>
      </UiDetails>
      {pending && confirmation[pending] && (
        <ConfirmActionDialog
          title={actionLabels[pending]}
          description={confirmation[pending]!.description}
          impacts={
            pending === "start"
              ? [
                  migration.mode === "pre_sync"
                    ? "Source writes remain available during pre-copy. A separate cutover confirmation is required."
                    : "Source writes will be blocked before object transfer begins.",
                  "Source buckets are retained. Deletion is a separate operation.",
                ]
              : confirmation[pending]!.impacts
          }
          confirmLabel={actionLabels[pending]}
          tone={
            pending === "start" || pending === "active_checks"
              ? "primary"
              : "danger"
          }
          loading={busy}
          error={error}
          details={[
            { label: "Buckets", value: bucketNames },
            { label: "Source identity", value: migration.source_context_id },
            {
              label: "Destination identity",
              value: migration.target_context_id,
            },
          ]}
          onCancel={() => {
            if (!busy) setPending(null);
          }}
          onConfirm={() => void perform(pending)}
        />
      )}
    </WorkflowPage>
  );
}
