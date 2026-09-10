/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useRef, useState } from "react";

import {
  streamCephAdminBucketUsageStats,
  streamStorageOpsBucketUsageStats,
  type BucketUsageStatsPayload,
  type BucketUsageStatsProgress,
  type BucketUsageStatsResult,
} from "../../api/bucketUsageStats";
import PageBanner from "../../components/PageBanner";
import WorkflowPage from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { BucketOperationSetup, BucketOperationProgress, BucketOperationSummaryStat, bucketOperationTableContainerClass } from "./bucketOperationRunUi";
import {
  buildStorageOpsBucketTargets,
  type BucketOperationUiTarget,
} from "./bucketOpsSelectionModel";
import {
  CEPH_ADMIN_PAGE_CONTRACTS,
  STORAGE_OPS_PAGE_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
} from "../../navigation/workspacePages";

type CommonProps = {
  targets: BucketOperationUiTarget[];
  onClose: () => void;
  onCompleted?: () => void;
};

type BucketUsageStatsRunModalProps =
  | (CommonProps & {
      mode: "ceph-admin";
      endpointId: number;
      endpointName?: string | null;
    })
  | (CommonProps & {
      mode: "storage-ops";
    });

function statusLabel(status: BucketUsageStatsResult["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "completed_with_warnings") return "Completed with warnings";
  if (status === "canceled") return "Canceled";
  return "Failed";
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export default function BucketUsageStatsRunModal(props: BucketUsageStatsRunModalProps) {
  const [parallelism, setParallelism] = useState(8);
  const [progress, setProgress] = useState<BucketUsageStatsProgress | null>(null);
  const [result, setResult] = useState<BucketUsageStatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const targetCount = props.targets.length;
  const targetLabel = `${targetCount} bucket${targetCount > 1 ? "s" : ""}`;
  const progressPercent = useMemo(() => {
    if (!progress || progress.total_buckets <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((progress.completed_buckets / progress.total_buckets) * 100)));
  }, [progress]);

  const buildPayload = (): BucketUsageStatsPayload => {
    const basePayload: BucketUsageStatsPayload = {
      parallelism: Math.max(1, Math.min(32, Math.trunc(parallelism || 8))),
    };
    if (props.mode === "storage-ops") {
      return { ...basePayload, targets: buildStorageOpsBucketTargets(props.targets) };
    }
    return {
      ...basePayload,
      buckets: props.targets.map((target) => target.bucketName),
    };
  };

  const runCalculation = async () => {
    if (running || targetCount === 0) return;
    setError(null);
    setMessage(null);
    setResult(null);
    setProgress(null);
    let payload: BucketUsageStatsPayload;
    try {
      payload = buildPayload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid options.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const streamOptions = {
        signal: controller.signal,
        onProgress: (event: BucketUsageStatsProgress) => setProgress(event),
      };
      const nextResult =
        props.mode === "ceph-admin"
          ? await streamCephAdminBucketUsageStats(props.endpointId, payload, streamOptions)
          : await streamStorageOpsBucketUsageStats(payload, streamOptions);
      setResult(nextResult);
      setMessage(`Calculation ${statusLabel(nextResult.status).toLowerCase()}.`);
      if (nextResult.status !== "failed") {
        props.onCompleted?.();
      }
    } catch (err) {
      if (isAbortError(err)) {
        setMessage("Calculation canceled.");
      } else {
        setError(extractApiError(err, "Bucket usage stats calculation failed."));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelCalculation = () => {
    abortRef.current?.abort();
  };

  const closeModal = () => {
    abortRef.current?.abort();
    props.onClose();
  };

  const breadcrumbs =
    props.mode === "ceph-admin"
      ? buildWorkspacePageBreadcrumbs("ceph-admin", CEPH_ADMIN_PAGE_CONTRACTS.buckets, { label: "Usage stats" })
      : buildWorkspacePageBreadcrumbs("storage-ops", STORAGE_OPS_PAGE_CONTRACTS.buckets, { label: "Usage stats" });

  return (
    <WorkflowPage
      title="Calculate bucket usage stats"
      description="Run the calculation as a page-level task and keep progress and per-bucket results visible."
      breadcrumbs={breadcrumbs}
      onBack={closeModal}
      backLabel={running ? "Stop and return" : "Back to buckets"}
      contentClassName="min-w-0"
    >
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {message && <PageBanner tone={result?.status === "completed" ? "success" : result?.status === "failed" ? "error" : "warning"}>{message}</PageBanner>}

        <BucketOperationSetup
          targetLabel={targetLabel}
          contextLabel={props.mode === "ceph-admin" ? props.endpointName || `Endpoint ${props.endpointId}` : "Storage Ops"}
          actions={
            <>
              <UiInput
                label="Parallelism"
                type="number"
                min={1}
                max={32}
                value={parallelism}
                disabled={running}
                onChange={(event) => setParallelism(Number(event.target.value))}
                fieldClassName="w-24"
                size="compact"
              />
              {running ? (
                <UiButton
                  type="button"
                  onClick={cancelCalculation}
                  variant="danger"
                  size="sm"
                >
                  Cancel
                </UiButton>
              ) : (
                <UiButton
                  type="button"
                  onClick={runCalculation}
                  disabled={targetCount === 0}
                  variant="primary"
                  size="sm"
                >
                  Run calculation
                </UiButton>
              )}
            </>
          }
        />

        {progress && (
          <BucketOperationProgress
            label="Bucket usage stats progress"
            value={progressPercent}
            stage={progress.bucket_name ? `${progress.bucket_name} - ${progress.stage}` : progress.stage}
            metrics={<>{formatCompactNumber(progress.listed_versions)} version(s) - {formatBytes(progress.total_bytes)}</>}
          >
            {formatCompactNumber(progress.completed_buckets)} / {formatCompactNumber(progress.total_buckets)} buckets completed
            {progress.listed_delete_markers > 0 ? ` - ${formatCompactNumber(progress.listed_delete_markers)} delete markers` : ""}
          </BucketOperationProgress>
        )}

        {result && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <BucketOperationSummaryStat label="Versions listed" value={formatCompactNumber(result.listed_versions)} />
              <BucketOperationSummaryStat label="Logical bytes" value={formatBytes(result.total_bytes)} />
              <BucketOperationSummaryStat label="Delete markers" value={formatCompactNumber(result.listed_delete_markers)} />
              <BucketOperationSummaryStat label="Failed buckets" value={formatCompactNumber(result.failed_buckets)} />
            </div>
            <div className={bucketOperationTableContainerClass}>
              <table className="ui-data-table">
                <thead>
                  <tr>
                    <th className="text-left">Bucket</th>
                    <th className="text-left">Status</th>
                    <th className="text-right">Bytes</th>
                    <th className="text-right">Versions</th>
                    <th className="text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {result.buckets.map((bucket) => (
                    <tr key={`${bucket.context_id ?? ""}:${bucket.bucket_name}`}>
                      <td className="ui-table-primary">{bucket.bucket_name}</td>
                      <td className="ui-table-secondary">{bucket.status.replace(/_/g, " ")}</td>
                      <td className="text-right ui-table-secondary">{formatBytes(bucket.snapshot?.total_bytes ?? 0)}</td>
                      <td className="text-right ui-table-secondary">{formatCompactNumber(bucket.snapshot?.object_version_count ?? 0)}</td>
                      <td className="ui-table-secondary">{bucket.message || bucket.snapshot?.warnings?.[0] || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!result && !progress && (
          <div className={cx(uiCardMutedClass, "px-4 py-3")}>
            <p className={cx("ui-body font-semibold", uiTitleTextClass)}>Ready to calculate</p>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              The calculation lists object versions first. If an endpoint does not support version listing, it falls back to current objects only.
            </p>
          </div>
        )}
      </div>
    </WorkflowPage>
  );
}
