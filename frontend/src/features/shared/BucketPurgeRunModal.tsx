/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListBadge } from "../../components/list/ListControls";
import { useMemo, useRef, useState } from "react";

import {
  streamManagerBucketDeleteWithPurge,
  streamCephAdminBucketPurge,
  streamManagerBucketPurge,
  streamStorageOpsBucketPurge,
  type BucketDeleteWithPurgePayload,
  type BucketPurgeBucketResult,
  type BucketPurgeFailure,
  type BucketPurgePayload,
  type BucketPurgeProgress,
  type BucketPurgeResult,
} from "../../api/bucketPurge";
import PageBanner from "../../components/PageBanner";
import BucketOperationResult, { BucketOperationFailures } from "./BucketOperationResult";
import WorkflowPage from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatCompactNumber, formatNumber } from "../../utils/format";
import { BucketOperationSetup, BucketOperationProgress, BucketOperationSummaryStat } from "./bucketOperationRunUi";
import {
  buildStorageOpsBucketTargets,
  type BucketOperationUiTarget,
} from "./bucketOpsSelectionModel";
import {
  CEPH_ADMIN_PAGE_CONTRACTS,
  MANAGER_PAGE_CONTRACTS,
  STORAGE_OPS_PAGE_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
} from "../../navigation/workspacePages";
import { useSharedI18n, type SharedText } from "./sharedI18n";

type CommonProps = {
  targets: BucketOperationUiTarget[];
  onClose: () => void;
  onFinished?: (result: BucketPurgeResult) => void;
};

type BucketPurgeRunModalProps =
  | (CommonProps & {
      mode: "manager";
      contextId: string;
      contextName?: string | null;
    })
  | (CommonProps & {
      mode: "manager-delete";
      contextId: string;
      contextName?: string | null;
    })
  | (CommonProps & {
      mode: "ceph-admin";
      endpointId: number;
      endpointName?: string | null;
    })
  | (CommonProps & {
      mode: "storage-ops";
    });

function statusLabel(status: BucketPurgeResult["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "completed_with_errors") return "Completed with errors";
  if (status === "canceled") return "Canceled";
  return "Failed";
}

function bucketStatusTone(status: BucketPurgeBucketResult["status"]): "success" | "warning" | "danger" {
  if (status === "completed") {
    return "success";
  }
  if (status === "completed_with_errors") {
    return "warning";
  }
  return "danger";
}

function surfaceLabel(props: BucketPurgeRunModalProps): string {
  if (props.mode === "manager" || props.mode === "manager-delete") return "Manager";
  if (props.mode === "ceph-admin") return "Ceph Admin";
  return "Storage Ops";
}

function contextLabel(props: BucketPurgeRunModalProps): string {
  if (props.mode === "manager" || props.mode === "manager-delete") return props.contextName || props.contextId;
  if (props.mode === "ceph-admin") return props.endpointName || `Endpoint ${props.endpointId}`;
  return "All selected contexts";
}

function failureTarget(failure: BucketPurgeFailure): string {
  if (failure.key) return failure.key;
  if (failure.stage === "delete_bucket") return "Bucket deletion";
  return failure.stage === "list" ? "Bucket listing" : "DeleteObjects batch";
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function progressDeletedEntries(progress: BucketPurgeProgress): number {
  return progress.deleted_objects + progress.deleted_versions;
}

function progressListedEntries(progress: BucketPurgeProgress): number {
  return progress.listed_objects + progress.listed_versions;
}

function progressTotalEntries(progress: BucketPurgeProgress): number | null {
  const discoveredTotal = Math.max(progressListedEntries(progress), progressDeletedEntries(progress));
  const estimatedTotal = progress.total_entries_estimate ?? null;
  if (estimatedTotal === null) return discoveredTotal > 0 ? discoveredTotal : null;
  return Math.max(estimatedTotal, discoveredTotal);
}

function progressEntriesLabel(progress: BucketPurgeProgress, text: SharedText): string {
  const deletedTotal = progressDeletedEntries(progress);
  const totalEntries = progressTotalEntries(progress);
  if (totalEntries === null) {
    return text("{count} entries deleted", {
      count: formatCompactNumber(deletedTotal),
    });
  }
  const totalLabel = progress.total_entries_final
    ? formatCompactNumber(totalEntries)
    : text("at least {count}", { count: formatCompactNumber(totalEntries) });
  return text("{deleted} / {total} entries deleted", {
    deleted: formatCompactNumber(deletedTotal),
    total: totalLabel,
  });
}

export default function BucketPurgeRunModal(props: BucketPurgeRunModalProps) {
  const { text: surfaceText } = useSharedI18n();
  const [parallelism, setParallelism] = useState(10);
  const [confirmation, setConfirmation] = useState("");
  const [progress, setProgress] = useState<BucketPurgeProgress | null>(null);
  const [result, setResult] = useState<BucketPurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const targetCount = props.targets.length;
  const isDeleteMode = props.mode === "manager-delete";
  const deleteTarget = isDeleteMode ? props.targets[0]?.bucketName ?? "" : "";
  const expectedConfirmation = isDeleteMode ? `DELETE BUCKET ${deleteTarget}` : `PURGE ${targetCount} BUCKETS`;
  const confirmationValid = confirmation === expectedConfirmation;
  const targetLabel = isDeleteMode
    ? surfaceText("Delete bucket")
    : surfaceText(targetCount === 1 ? "{count} bucket" : "{count} buckets", {
        count: targetCount,
      });
  const progressPercent = useMemo(() => {
    if (!progress) return null;
    const totalEntries = progressTotalEntries(progress);
    const deletedTotal = progressDeletedEntries(progress);
    if (totalEntries !== null && totalEntries > 0) {
      const rawPercent = Math.max(0, Math.min(100, Math.round((deletedTotal / totalEntries) * 100)));
      return progress.total_entries_final ? rawPercent : Math.min(rawPercent, 96);
    }
    if (progress.total_buckets > 0) {
      const rawPercent = Math.max(0, Math.min(100, Math.round((progress.completed_buckets / progress.total_buckets) * 100)));
      return progress.total_entries_final ? rawPercent : Math.min(rawPercent, 96);
    }
    return null;
  }, [progress]);

  const buildPayload = (): BucketPurgePayload | BucketDeleteWithPurgePayload => {
    const basePayload = {
      parallelism: Math.max(1, Math.min(64, Math.trunc(parallelism || 10))),
      confirmation,
    };
    if (isDeleteMode) {
      if (!deleteTarget) {
        throw new Error("Missing bucket to delete.");
      }
      return basePayload;
    }
    const purgePayload: BucketPurgePayload = {
      ...basePayload,
      include_versions: true,
    };
    if (props.mode === "storage-ops") {
      return { ...purgePayload, targets: buildStorageOpsBucketTargets(props.targets) };
    }
    return {
      ...purgePayload,
      buckets: props.targets.map((target) => target.bucketName),
    };
  };

  const runPurge = async () => {
    if (running || targetCount === 0 || !confirmationValid) return;
    setError(null);
    setMessage(null);
    setResult(null);
    setProgress(null);
    let payload: BucketPurgePayload | BucketDeleteWithPurgePayload;
    try {
      payload = buildPayload();
    } catch (err) {
      setError(surfaceText(err instanceof Error ? err.message : "Invalid options."));
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const streamOptions = {
        signal: controller.signal,
        onProgress: (event: BucketPurgeProgress) => setProgress(event),
      };
      const nextResult =
        props.mode === "manager-delete"
          ? await streamManagerBucketDeleteWithPurge(props.contextId, deleteTarget, payload as BucketDeleteWithPurgePayload, streamOptions)
          : props.mode === "manager"
          ? await streamManagerBucketPurge(props.contextId, payload as BucketPurgePayload, streamOptions)
          : props.mode === "ceph-admin"
            ? await streamCephAdminBucketPurge(props.endpointId, payload as BucketPurgePayload, streamOptions)
            : await streamStorageOpsBucketPurge(payload as BucketPurgePayload, streamOptions);
      setResult(nextResult);
      props.onFinished?.(nextResult);
      setMessage(surfaceText(
        isDeleteMode
          ? nextResult.status === "completed"
            ? "Bucket deletion completed."
            : nextResult.status === "completed_with_errors"
              ? "Bucket deletion completed with errors."
              : nextResult.status === "canceled"
                ? "Bucket deletion canceled."
                : "Bucket deletion failed."
          : nextResult.status === "completed"
            ? "Purge completed."
            : nextResult.status === "completed_with_errors"
              ? "Purge completed with errors."
              : nextResult.status === "canceled"
                ? "Purge canceled."
                : "Purge failed.",
      ));
    } catch (err) {
      if (isAbortError(err)) {
        setMessage(surfaceText(isDeleteMode ? "Bucket deletion canceled." : "Purge canceled."));
      } else {
        setError(extractApiError(
          err,
          surfaceText(isDeleteMode ? "Bucket deletion failed." : "Bucket purge failed."),
        ));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelPurge = () => {
    abortRef.current?.abort();
  };

  const closeModal = () => {
    abortRef.current?.abort();
    props.onClose();
  };

  const workflowLabel = surfaceText(isDeleteMode ? "Purge and delete" : "Purge");
  const resolvedContextLabel = contextLabel(props);
  const breadcrumbs =
    props.mode === "manager" || props.mode === "manager-delete"
      ? buildWorkspacePageBreadcrumbs("manager", MANAGER_PAGE_CONTRACTS.buckets, { label: workflowLabel })
      : props.mode === "ceph-admin"
        ? buildWorkspacePageBreadcrumbs("ceph-admin", CEPH_ADMIN_PAGE_CONTRACTS.buckets, { label: workflowLabel })
        : buildWorkspacePageBreadcrumbs("storage-ops", STORAGE_OPS_PAGE_CONTRACTS.buckets, { label: workflowLabel });

  return (
    <WorkflowPage
      title={surfaceText(isDeleteMode ? "Purge and delete bucket" : "Purge buckets")}
      description={
        isDeleteMode
          ? surfaceText("Review the target, confirm the destructive operation and follow deletion through completion.")
          : surfaceText("Review the selected buckets, confirm the destructive operation and keep progress visible through completion.")
      }
      breadcrumbs={breadcrumbs}
      onBack={closeModal}
      backLabel={running ? surfaceText("Stop and return") : surfaceText("Back to buckets")}
      contentClassName="min-w-0"
    >
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {message && (
          <PageBanner tone={result?.status === "completed" ? "success" : result?.status === "failed" ? "error" : "warning"}>
            {message}
          </PageBanner>
        )}

        <BucketOperationSetup
          targetLabel={targetLabel}
          contextLabel={`${surfaceLabel(props)} - ${
            resolvedContextLabel === "All selected contexts"
              ? surfaceText(resolvedContextLabel)
              : resolvedContextLabel
          }`}
          actions={running ? (
            <UiButton type="button" onClick={cancelPurge} variant="danger" size="sm">
              {surfaceText("Cancel")}</UiButton>
          ) : (
            <UiButton
              type="button"
              onClick={runPurge}
              disabled={targetCount === 0 || !confirmationValid}
              variant="danger"
              size="sm"
            >
              {surfaceText(isDeleteMode ? "Delete bucket" : "Start purge")}
            </UiButton>
          )}
        >
          {isDeleteMode ? (
            <PageBanner tone="warning">
              {surfaceText("This deletes current objects, historical versions, and delete markers, then removes the bucket and its S3 configuration.")}</PageBanner>
          ) : (
            <PageBanner tone="warning">
              {surfaceText("This empties the selected buckets by deleting current objects, historical versions, and delete markers. Buckets and bucket configuration are kept.")}</PageBanner>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_120px_minmax(0,360px)]">
            <div className="min-w-0 rounded-md border border-[color:var(--ui-border-soft)] md:col-span-2 xl:col-span-1">
              <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
                <p className="ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400">{surfaceText("Targets")}</p>
              </div>
              <div className="max-h-48 overflow-auto divide-y divide-slate-200 dark:divide-slate-800">
                {props.targets.map((target) => (
                  <div key={`${target.contextId ?? ""}:${target.bucketName}`} className="px-3 py-2">
                    <p className="break-all ui-body font-semibold text-slate-900 dark:text-slate-100">{target.bucketName}</p>
                    {(target.contextName || target.contextId) && (
                      <p className={cx("ui-caption", uiMutedTextClass)}>{target.contextName || target.contextId}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <UiInput
              size="compact"
              label={surfaceText("Parallelism")}
              type="number"
              min={1}
              max={64}
              value={parallelism}
              disabled={running}
              onChange={(event) => setParallelism(Number(event.target.value))}
            />

            <UiInput
              size="compact"
              label={surfaceText("Type {confirmation}", { confirmation: expectedConfirmation })}
              type="text"
              value={confirmation}
              disabled={running}
              onChange={(event) => setConfirmation(event.target.value)}
              className="font-mono"
            />
          </div>
        </BucketOperationSetup>

        {progress && (
          <BucketOperationProgress
            label={surfaceText("Bucket purge progress")}
            value={progressPercent}
            stage={progress.bucket_name ? `${progress.bucket_name} - ${progress.stage}` : progress.stage}
            metrics={<>{progressEntriesLabel(progress, surfaceText)}</>}
            destructive
          >
            {formatCompactNumber(progress.completed_buckets)} / {formatCompactNumber(progress.total_buckets)} {surfaceText("buckets completed")}{" - "}
            {formatCompactNumber(progress.deleted_objects)} {surfaceText("current object(s),")}{" "}
            {formatCompactNumber(progress.deleted_versions)} {surfaceText("version/delete marker entries")}
            {!progress.total_entries_final ? ` - ${surfaceText("Total still being discovered")}` : ""}
            {progress.failed_count > 0
              ? ` - ${surfaceText("{count} error(s)", { count: formatCompactNumber(progress.failed_count) })}`
              : ""}
          </BucketOperationProgress>
        )}

        {result && (
          <div className="space-y-3">
            <div className={`grid gap-2 ${isDeleteMode ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
              <BucketOperationSummaryStat label={surfaceText("Objects deleted")} value={formatNumber(result.deleted_objects)} />
              <BucketOperationSummaryStat label={surfaceText("Versions/delete markers deleted")} value={formatNumber(result.deleted_versions)} />
              <BucketOperationSummaryStat
                label={surfaceText("Buckets completed")}
                value={`${formatNumber(result.completed_buckets)} / ${formatNumber(result.total_buckets)}`}
              />
              <BucketOperationSummaryStat label={surfaceText("Errors")} value={formatNumber(result.failed_count)} />
              {isDeleteMode && (
                <BucketOperationSummaryStat
                  label={surfaceText("Bucket")}
                  value={surfaceText(result.bucket_deleted ? "Deleted" : "Not deleted")}
                />
              )}
            </div>

            <div className="space-y-2">
              {result.buckets.map((bucket) => (
                <BucketOperationResult
                  key={`${bucket.context_id ?? ""}:${bucket.bucket_name}`}
                  bucketName={bucket.bucket_name}
                  contextLabel={bucket.context_name || bucket.context_id}
                  status={<ListBadge tone={bucketStatusTone(bucket.status)}>{surfaceText(statusLabel(bucket.status))}</ListBadge>}
                  durationSeconds={bucket.duration_seconds}
                  metrics={[
                    { label: surfaceText("Objects"), value: formatNumber(bucket.deleted_objects) },
                    { label: surfaceText("Versions"), value: formatNumber(bucket.deleted_versions) },
                    { label: surfaceText("Errors"), value: formatNumber(bucket.failed_count) },
                  ]}
                >
                  <BucketOperationFailures
                    bucketName={bucket.bucket_name}
                    title={surfaceText("Purge errors")}
                    targetLabel={surfaceText("Target")}
                    total={bucket.failed_count}
                    showCount
                    failures={bucket.failures_sample.map((failure) => ({
                      stage: failure.stage,
                      target: failure.key
                        ? failure.key
                        : surfaceText(failureTarget(failure)),
                      version: failure.version_id,
                      count: failure.count,
                      message: failure.message,
                    }))}
                    emptyMessage={surfaceText("No purge error reported for this bucket.")}
                  />
                </BucketOperationResult>
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkflowPage>
  );
}
