/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import { useMemo, useRef, useState } from "react";

import {
  streamCephAdminBucketIntegrityCheck,
  streamManagerBucketIntegrityCheck,
  streamStorageOpsBucketIntegrityCheck,
  type BucketIntegrityBucketResult,
  type BucketIntegrityCheckMode,
  type BucketIntegrityCheckPayload,
  type BucketIntegrityFailure,
  type BucketIntegrityProgress,
  type BucketIntegrityResult,
} from "../../api/bucketIntegrity";
import PageBanner from "../../components/PageBanner";
import BucketOperationResult, { BucketOperationFailures } from "./BucketOperationResult";
import WorkflowPage from "../../components/WorkflowPage";
import ListToolbar from "../../components/ListToolbar";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import UiSelect from "../../components/ui/UiSelect";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatNumber } from "../../utils/format";
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
import { useSharedI18n } from "./sharedI18n";

type CommonProps = {
  targets: BucketOperationUiTarget[];
  onClose: () => void;
};

type BucketIntegrityCheckModalProps =
  | (CommonProps & {
      mode: "manager";
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

function statusLabel(status: BucketIntegrityResult["status"]): string {
  if (status === "passed") return "Passed";
  if (status === "completed_with_errors") return "Completed with errors";
  if (status === "canceled") return "Canceled";
  return "Failed";
}

function bucketStatusTone(status: BucketIntegrityResult["status"]): "success" | "warning" | "danger" {
  if (status === "passed") return "success";
  if (status === "completed_with_errors") return "warning";
  return "danger";
}

function formatFailureTarget(failure: BucketIntegrityFailure): string {
  if (failure.key) return failure.key;
  return failure.stage === "list" ? "Bucket listing" : "Object";
}

function bucketMatchesSearch(bucket: BucketIntegrityBucketResult, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    bucket.bucket_name,
    bucket.context_name ?? "",
    bucket.context_id ?? "",
    bucket.status,
    statusLabel(bucket.status),
    ...bucket.failures_sample.flatMap((failure) => [
      failure.stage,
      failure.key ?? "",
      failure.version_id ?? "",
      failure.message,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function parseOptionalSince(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Since must be a valid date.");
  }
  return parsed.toISOString();
}

function parseOptionalMaxMb(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Max MB per object must be greater than zero.");
  }
  return parsed;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

const CHECK_MODE_OPTIONS: Array<{ value: BucketIntegrityCheckMode; label: string }> = [
  { value: "head", label: "HEAD only" },
  { value: "get", label: "GET body" },
];

export default function BucketIntegrityCheckModal(props: BucketIntegrityCheckModalProps) {
  const { text: surfaceText } = useSharedI18n();
  const [parallelism, setParallelism] = useState(10);
  const [allVersions, setAllVersions] = useState(false);
  const [checkMode, setCheckMode] = useState<BucketIntegrityCheckMode>("head");
  const [since, setSince] = useState("");
  const [maxMb, setMaxMb] = useState("");
  const [progress, setProgress] = useState<BucketIntegrityProgress | null>(null);
  const [result, setResult] = useState<BucketIntegrityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BucketIntegrityResult["status"]>("all");
  const [errorFilter, setErrorFilter] = useState<"all" | "with_errors" | "without_errors">("all");
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const targetCount = props.targets.length;
  const targetLabel = surfaceText(
    targetCount === 1 ? "{count} bucket" : "{count} buckets",
    { count: targetCount },
  );
  const progressPercent = useMemo(() => {
    if (!progress || progress.listed_count <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((progress.checked_count / progress.listed_count) * 100)));
  }, [progress]);
  const filteredBucketResults = useMemo(() => {
    if (!result) return [];
    const needle = resultSearch.trim().toLowerCase();
    return result.buckets.filter((bucket) => {
      if (statusFilter !== "all" && bucket.status !== statusFilter) return false;
      if (errorFilter === "with_errors" && bucket.failed_count === 0) return false;
      if (errorFilter === "without_errors" && bucket.failed_count > 0) return false;
      return bucketMatchesSearch(bucket, needle);
    });
  }, [errorFilter, result, resultSearch, statusFilter]);

  const buildPayload = (): BucketIntegrityCheckPayload => {
    const maxMbPerObject = checkMode === "get" ? parseOptionalMaxMb(maxMb) : null;
    const sinceIso = parseOptionalSince(since);
    const basePayload: BucketIntegrityCheckPayload = {
      parallelism: Math.max(1, Math.min(64, Math.trunc(parallelism || 10))),
      all_versions: allVersions,
      check_mode: checkMode,
      since: sinceIso || undefined,
      max_mb_per_object: checkMode === "get" ? maxMbPerObject || undefined : undefined,
    };
    if (props.mode === "storage-ops") {
      return { ...basePayload, targets: buildStorageOpsBucketTargets(props.targets) };
    }
    return {
      ...basePayload,
      buckets: props.targets.map((target) => target.bucketName),
    };
  };

  const runCheck = async () => {
    if (running || targetCount === 0) return;
    setError(null);
    setMessage(null);
    setResult(null);
    setProgress(null);
    let payload: BucketIntegrityCheckPayload;
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
        onProgress: (event: BucketIntegrityProgress) => setProgress(event),
      };
      const nextResult =
        props.mode === "manager"
          ? await streamManagerBucketIntegrityCheck(props.contextId, payload, streamOptions)
          : props.mode === "ceph-admin"
            ? await streamCephAdminBucketIntegrityCheck(props.endpointId, payload, streamOptions)
            : await streamStorageOpsBucketIntegrityCheck(payload, streamOptions);
      setResult(nextResult);
      setMessage(surfaceText(
        nextResult.status === "passed"
          ? "Check passed."
          : nextResult.status === "completed_with_errors"
            ? "Check completed with errors."
            : nextResult.status === "canceled"
              ? "Check canceled."
              : "Check failed.",
      ));
    } catch (err) {
      if (isAbortError(err)) {
        setMessage(surfaceText("Check canceled."));
      } else {
        setError(extractApiError(err, surfaceText("Bucket integrity check failed.")));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelCheck = () => {
    abortRef.current?.abort();
  };

  const closeModal = () => {
    abortRef.current?.abort();
    props.onClose();
  };

  const breadcrumbs =
    props.mode === "manager"
      ? buildWorkspacePageBreadcrumbs("manager", MANAGER_PAGE_CONTRACTS.integrity, { label: surfaceText("Run") })
      : props.mode === "ceph-admin"
        ? buildWorkspacePageBreadcrumbs("ceph-admin", CEPH_ADMIN_PAGE_CONTRACTS.buckets, { label: surfaceText("Integrity check") })
        : buildWorkspacePageBreadcrumbs("storage-ops", STORAGE_OPS_PAGE_CONTRACTS.buckets, { label: surfaceText("Integrity check") });

  return (
    <WorkflowPage
      title={surfaceText("Check bucket integrity")}
      description={surfaceText("Configure the read strategy, follow progress and review every affected bucket without blocking the bucket list.")}
      breadcrumbs={breadcrumbs}
      onBack={closeModal}
      backLabel={running ? surfaceText("Stop and return") : surfaceText("Back to bucket selection")}
      contentClassName="min-w-0"
    >
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {message && <PageBanner tone={result?.status === "passed" ? "success" : result?.status === "failed" ? "error" : "warning"}>{message}</PageBanner>}

        <BucketOperationSetup
          targetLabel={targetLabel}
          contextLabel={props.mode === "manager" ? props.contextName || props.contextId : props.mode === "ceph-admin" ? props.endpointName || `Endpoint ${props.endpointId}` : "Storage Ops"}
          actions={running ? (
            <UiButton type="button" onClick={cancelCheck} variant="danger" size="sm">
              {surfaceText("Cancel")}</UiButton>
          ) : (
            <UiButton
              type="button"
              onClick={runCheck}
              disabled={targetCount === 0}
              variant="primary"
              size="sm"
            >
              {surfaceText("Run check")}</UiButton>
          )}
        >
          <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[auto_minmax(80px,0.6fr)_minmax(0,1fr)_minmax(120px,0.8fr)_auto]">
            <fieldset className="bucket-operation-mode min-w-0">
              <legend>{surfaceText("Mode")}</legend>
              <UiSegmentedControl
                ariaLabel={surfaceText("Bucket integrity check mode")}
                options={CHECK_MODE_OPTIONS.map((option) => ({
                  ...option,
                  label: surfaceText(option.value === "head" ? "HEAD only" : "GET body"),
                  disabled: running,
                }))}
                value={checkMode}
                onChange={setCheckMode}
              />
            </fieldset>
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
              label={surfaceText("Since")}
              type="datetime-local"
              value={since}
              disabled={running}
              onChange={(event) => setSince(event.target.value)}
            />
            <UiInput
              size="compact"
              label={surfaceText("Max MB per object")}
              type="number"
              min={0}
              step="0.1"
              value={maxMb}
              disabled={running || checkMode === "head"}
              onChange={(event) => setMaxMb(event.target.value)}
            />
            <UiCheckboxField
              checked={allVersions}
              disabled={running}
              onChange={(event) => setAllVersions(event.target.checked)}
              className="bucket-operation-checkbox"
            >
              {surfaceText("All versions")}</UiCheckboxField>
          </div>
        </BucketOperationSetup>

        {progress && (
          <BucketOperationProgress
            label={surfaceText("Bucket integrity progress")}
            value={progressPercent}
            stage={progress.bucket_name ? `${progress.bucket_name} - ${progress.stage}` : progress.stage}
            metrics={surfaceText("Objects: {checked} / {listed} · Read: {bytes}", {
              checked: formatNumber(progress.checked_count),
              listed: formatNumber(progress.listed_count),
              bytes: formatBytes(progress.bytes_read),
            })}
          >
            {surfaceText(
              progress.failed_count > 0
                ? "Buckets: {completed} / {total} · Errors: {errors}"
                : "Buckets: {completed} / {total}",
              {
                completed: formatNumber(progress.completed_buckets),
                total: formatNumber(progress.total_buckets),
                errors: formatNumber(progress.failed_count),
              },
            )}
          </BucketOperationProgress>
        )}

        {result && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <BucketOperationSummaryStat label={surfaceText("Objects listed")} value={formatNumber(result.listed_count)} />
              <BucketOperationSummaryStat label={surfaceText("Objects checked")} value={formatNumber(result.checked_count)} />
              <BucketOperationSummaryStat label={surfaceText("Errors")} value={formatNumber(result.failed_count)} />
              <BucketOperationSummaryStat label={surfaceText("Bytes read")} value={formatBytes(result.bytes_read)} />
            </div>
            <ListToolbar
              variant="section"
              title={surfaceText("Bucket results")}
              countLabel={surfaceText(
                result.buckets.length === 1
                  ? "Showing {visible} / {total} bucket result."
                  : "Showing {visible} / {total} bucket results.",
                {
                  visible: formatNumber(filteredBucketResults.length),
                  total: formatNumber(result.buckets.length),
                },
              )}
              search={
                <ToolbarSearchInput
                  label={surfaceText("Filter integrity results")}
                  value={resultSearch}
                  onChange={setResultSearch}
                  placeholder={surfaceText("Filter by bucket, context, object, or error")}
                />
              }
              filters={
                <>
                  <UiSelect
                    label={surfaceText("Status")}
                    aria-label={surfaceText("Filter integrity status")}
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as "all" | BucketIntegrityResult["status"])}
                  >
                    <option value="all">{surfaceText("All statuses")}</option>
                    <option value="passed">{surfaceText("Passed")}</option>
                    <option value="completed_with_errors">{surfaceText("Completed with errors")}</option>
                    <option value="failed">{surfaceText("Failed")}</option>
                    <option value="canceled">{surfaceText("Canceled")}</option>
                  </UiSelect>
                  <UiSelect
                    label={surfaceText("Errors")}
                    aria-label={surfaceText("Filter integrity errors")}
                    value={errorFilter}
                    onChange={(event) => setErrorFilter(event.target.value as "all" | "with_errors" | "without_errors")}
                  >
                    <option value="all">{surfaceText("All error states")}</option>
                    <option value="with_errors">{surfaceText("With errors")}</option>
                    <option value="without_errors">{surfaceText("Without errors")}</option>
                  </UiSelect>
                </>
              }
              actions={
                <ListActionButton
                  type="button"
                  variant="secondary"
                  disabled={!resultSearch && statusFilter === "all" && errorFilter === "all"}
                  onClick={() => {
                    setResultSearch("");
                    setStatusFilter("all");
                    setErrorFilter("all");
                  }}
                >
                  {surfaceText("Reset filters")}</ListActionButton>
              }
            />
            <div className="space-y-2">
              {filteredBucketResults.map((bucket) => (
                <BucketOperationResult
                  key={`${bucket.context_id ?? ""}:${bucket.bucket_name}`}
                  bucketName={bucket.bucket_name}
                  contextLabel={bucket.context_name || bucket.context_id}
                  status={<ListBadge tone={bucketStatusTone(bucket.status)}>{surfaceText(statusLabel(bucket.status))}</ListBadge>}
                  durationSeconds={bucket.duration_seconds}
                  metrics={[
                    { label: surfaceText("Listed"), value: formatNumber(bucket.listed_count) },
                    { label: surfaceText("Checked"), value: formatNumber(bucket.checked_count) },
                    { label: surfaceText("Errors"), value: formatNumber(bucket.failed_count) },
                    { label: surfaceText("Read"), value: formatBytes(bucket.bytes_read) },
                  ]}
                >
                  <BucketOperationFailures
                    bucketName={bucket.bucket_name}
                    title={surfaceText("Affected objects")}
                    targetLabel={surfaceText("Object")}
                    total={bucket.failed_count}
                    failures={bucket.failures_sample.map((failure) => ({
                      stage: failure.stage,
                      target: failure.key
                        ? failure.key
                        : surfaceText(formatFailureTarget(failure)),
                      version: failure.version_id,
                      message: failure.message,
                    }))}
                    emptyMessage={surfaceText("No affected objects reported for this bucket.")}
                  />
                </BucketOperationResult>
              ))}
              {filteredBucketResults.length === 0 && (
                <UiInlineMessage>{surfaceText("No bucket result matches the current filters.")}</UiInlineMessage>
              )}
            </div>
          </div>
        )}
      </div>
    </WorkflowPage>
  );
}
