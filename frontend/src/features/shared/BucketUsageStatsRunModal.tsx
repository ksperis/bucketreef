/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useRef, useState } from "react";

import {
  streamCephAdminBucketUsageStats,
  streamStorageOpsBucketUsageStats,
  type BucketUsageStatsBucketResult,
  type BucketUsageStatsPayload,
  type BucketUsageStatsProgress,
  type BucketUsageStatsResult,
} from "../../api/bucketUsageStats";
import PageBanner from "../../components/PageBanner";
import WorkflowPage from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError, isCancelledError } from "../../utils/apiError";
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
import {
  bucketUsageStatsErrorMessage,
  bucketUsageStatsMessage,
  useBucketUsageStatsI18n,
  type BucketUsageStatsMessageKey,
} from "./bucketUsageStatsMessage";

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

const statusKeys: Record<BucketUsageStatsBucketResult["status"], BucketUsageStatsMessageKey> = {
  completed: "statusCompleted",
  completed_with_warnings: "statusCompletedWithWarnings",
  canceled: "statusCanceled",
  failed: "statusFailed",
  skipped: "statusSkipped",
};
const calculationMessageKeys: Record<BucketUsageStatsResult["status"], BucketUsageStatsMessageKey> = {
  completed: "calculationCompleted",
  completed_with_warnings: "calculationCompletedWithWarnings",
  canceled: "calculationCanceled",
  failed: "calculationFailed",
};
const stageKeys: Record<BucketUsageStatsProgress["stage"], BucketUsageStatsMessageKey> = {
  prepare: "stagePrepare",
  list: "stageList",
  persist: "stagePersist",
  completed: "stageCompleted",
};

export default function BucketUsageStatsRunModal(props: BucketUsageStatsRunModalProps) {
  const { locale, text } = useBucketUsageStatsI18n();
  const [parallelism, setParallelism] = useState(8);
  const [progress, setProgress] = useState<BucketUsageStatsProgress | null>(null);
  const [result, setResult] = useState<BucketUsageStatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<BucketUsageStatsMessageKey | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const targetCount = props.targets.length;
  const targetLabel = text(targetCount > 1 ? "targetBuckets" : "targetBucket", { count: targetCount });
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
      setError(err instanceof Error ? err.message : bucketUsageStatsMessage.invalidOptions.en);
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
      setMessage(calculationMessageKeys[nextResult.status]);
      if (nextResult.status !== "failed") {
        props.onCompleted?.();
      }
    } catch (err) {
      if (isCancelledError(err)) {
        setMessage("calculationCanceled");
      } else {
        setError(extractApiError(err, bucketUsageStatsMessage.calculationError.en));
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

  const breadcrumbs = (
    props.mode === "ceph-admin"
      ? buildWorkspacePageBreadcrumbs("ceph-admin", CEPH_ADMIN_PAGE_CONTRACTS.buckets, { label: text("usageStats") })
      : buildWorkspacePageBreadcrumbs("storage-ops", STORAGE_OPS_PAGE_CONTRACTS.buckets, { label: text("usageStats") })
  ).map((breadcrumb, index) => ({
    ...breadcrumb,
    label: index === 0
      ? text(props.mode === "ceph-admin" ? "cephAdmin" : "storageOps")
      : index === 1 ? text("bucketsBreadcrumb") : breadcrumb.label,
  }));

  return (
    <WorkflowPage
      title={text("calculateTitle")}
      description={text("calculateDescription")}
      breadcrumbs={breadcrumbs}
      onBack={closeModal}
      backLabel={text(running ? "stopAndReturn" : "backToBuckets")}
      contentClassName="min-w-0"
    >
      <div className="space-y-4">
        {error && <PageBanner tone="error">{bucketUsageStatsErrorMessage(error, locale)}</PageBanner>}
        {message && <PageBanner tone={result?.status === "completed" ? "success" : result?.status === "failed" ? "error" : "warning"}>{text(message)}</PageBanner>}

        <BucketOperationSetup
          targetLabel={targetLabel}
          contextLabel={props.mode === "ceph-admin" ? props.endpointName || text("endpoint", { id: props.endpointId }) : text("storageOps")}
          actions={
            <>
              <UiInput
                label={text("parallelism")}
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
                  {text("cancel")}
                </UiButton>
              ) : (
                <UiButton
                  type="button"
                  onClick={runCalculation}
                  disabled={targetCount === 0}
                  variant="primary"
                  size="sm"
                >
                  {text("runCalculation")}
                </UiButton>
              )}
            </>
          }
        />

        {progress && (
          <BucketOperationProgress
            label={text("progressLabel")}
            value={progressPercent}
            stage={progress.bucket_name ? `${progress.bucket_name} - ${text(stageKeys[progress.stage])}` : text(stageKeys[progress.stage])}
            metrics={text("progressMetric", { versions: formatCompactNumber(progress.listed_versions), bytes: formatBytes(progress.total_bytes) })}
          >
            {text(progress.listed_delete_markers > 0 ? "bucketsCompletedWithMarkers" : "bucketsCompleted", {
              completed: formatCompactNumber(progress.completed_buckets),
              total: formatCompactNumber(progress.total_buckets),
              markers: formatCompactNumber(progress.listed_delete_markers),
            })}
          </BucketOperationProgress>
        )}

        {result && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <BucketOperationSummaryStat label={text("versionsListed")} value={formatCompactNumber(result.listed_versions)} />
              <BucketOperationSummaryStat label={text("logicalBytes")} value={formatBytes(result.total_bytes)} />
              <BucketOperationSummaryStat label={text("deleteMarkers")} value={formatCompactNumber(result.listed_delete_markers)} />
              <BucketOperationSummaryStat label={text("failedBuckets")} value={formatCompactNumber(result.failed_buckets)} />
            </div>
            <div className={bucketOperationTableContainerClass}>
              <table className="ui-data-table">
                <thead>
                  <tr>
                    <th className="text-left">{text("bucket")}</th>
                    <th className="text-left">{text("status")}</th>
                    <th className="text-right">{text("bytes")}</th>
                    <th className="text-right">{text("versions")}</th>
                    <th className="text-left">{text("notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.buckets.map((bucket) => (
                    <tr key={`${bucket.context_id ?? ""}:${bucket.bucket_name}`}>
                      <td className="ui-table-primary">{bucket.bucket_name}</td>
                      <td className="ui-table-secondary">{text(statusKeys[bucket.status])}</td>
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
            <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{text("readyTitle")}</p>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {text("readyDescription")}
            </p>
          </div>
        )}
      </div>
    </WorkflowPage>
  );
}
