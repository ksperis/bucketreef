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
  const targetLabel = `${targetCount} bucket${targetCount > 1 ? "s" : ""}`;
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
      setError(err instanceof Error ? err.message : "Invalid options.");
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
      setMessage(`Check ${statusLabel(nextResult.status).toLowerCase()}.`);
    } catch (err) {
      if (isAbortError(err)) {
        setMessage("Check canceled.");
      } else {
        setError(extractApiError(err, "Bucket integrity check failed."));
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
      ? buildWorkspacePageBreadcrumbs("manager", MANAGER_PAGE_CONTRACTS.integrity, { label: "Run" })
      : props.mode === "ceph-admin"
        ? buildWorkspacePageBreadcrumbs("ceph-admin", CEPH_ADMIN_PAGE_CONTRACTS.buckets, { label: "Integrity check" })
        : buildWorkspacePageBreadcrumbs("storage-ops", STORAGE_OPS_PAGE_CONTRACTS.buckets, { label: "Integrity check" });

  return (
    <WorkflowPage
      title="Check bucket integrity"
      description="Configure the read strategy, follow progress and review every affected bucket without blocking the bucket list."
      breadcrumbs={breadcrumbs}
      onBack={closeModal}
      backLabel={running ? "Stop and return" : "Back to bucket selection"}
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
              Cancel
            </UiButton>
          ) : (
            <UiButton
              type="button"
              onClick={runCheck}
              disabled={targetCount === 0}
              variant="primary"
              size="sm"
            >
              Run check
            </UiButton>
          )}
        >
          <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[auto_minmax(80px,0.6fr)_minmax(0,1fr)_minmax(120px,0.8fr)_auto]">
            <fieldset className="bucket-operation-mode min-w-0">
              <legend>Mode</legend>
              <UiSegmentedControl
                ariaLabel="Bucket integrity check mode"
                options={CHECK_MODE_OPTIONS.map((option) => ({ ...option, disabled: running }))}
                value={checkMode}
                onChange={setCheckMode}
              />
            </fieldset>
            <UiInput
              size="compact"
              label="Parallelism"
              type="number"
              min={1}
              max={64}
              value={parallelism}
              disabled={running}
              onChange={(event) => setParallelism(Number(event.target.value))}
            />
            <UiInput
              size="compact"
              label="Since"
              type="datetime-local"
              value={since}
              disabled={running}
              onChange={(event) => setSince(event.target.value)}
            />
            <UiInput
              size="compact"
              label="Max MB per object"
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
              All versions
            </UiCheckboxField>
          </div>
        </BucketOperationSetup>

        {progress && (
          <BucketOperationProgress
            label="Bucket integrity progress"
            value={progressPercent}
            stage={progress.bucket_name ? `${progress.bucket_name} - ${progress.stage}` : progress.stage}
            metrics={<>{formatNumber(progress.checked_count)} / {formatNumber(progress.listed_count)} objects - {formatBytes(progress.bytes_read)}</>}
          >
            {formatNumber(progress.completed_buckets)} / {formatNumber(progress.total_buckets)} buckets completed
            {progress.failed_count > 0 ? ` - ${formatNumber(progress.failed_count)} errors` : ""}
          </BucketOperationProgress>
        )}

        {result && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <BucketOperationSummaryStat label="Objects listed" value={formatNumber(result.listed_count)} />
              <BucketOperationSummaryStat label="Objects checked" value={formatNumber(result.checked_count)} />
              <BucketOperationSummaryStat label="Errors" value={formatNumber(result.failed_count)} />
              <BucketOperationSummaryStat label="Bytes read" value={formatBytes(result.bytes_read)} />
            </div>
            <ListToolbar
              variant="section"
              title="Bucket results"
              countLabel={`Showing ${formatNumber(filteredBucketResults.length)} / ${formatNumber(result.buckets.length)} bucket result(s).`}
              search={
                <ToolbarSearchInput
                  label="Filter integrity results"
                  value={resultSearch}
                  onChange={setResultSearch}
                  placeholder="Filter by bucket, context, object, or error"
                />
              }
              filters={
                <>
                  <UiSelect
                    label="Status"
                    aria-label="Filter integrity status"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as "all" | BucketIntegrityResult["status"])}
                  >
                    <option value="all">All statuses</option>
                    <option value="passed">Passed</option>
                    <option value="completed_with_errors">Completed with errors</option>
                    <option value="failed">Failed</option>
                    <option value="canceled">Canceled</option>
                  </UiSelect>
                  <UiSelect
                    label="Errors"
                    aria-label="Filter integrity errors"
                    value={errorFilter}
                    onChange={(event) => setErrorFilter(event.target.value as "all" | "with_errors" | "without_errors")}
                  >
                    <option value="all">All error states</option>
                    <option value="with_errors">With errors</option>
                    <option value="without_errors">Without errors</option>
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
                  Reset filters
                </ListActionButton>
              }
            />
            <div className="space-y-2">
              {filteredBucketResults.map((bucket) => (
                <BucketOperationResult
                  key={`${bucket.context_id ?? ""}:${bucket.bucket_name}`}
                  bucketName={bucket.bucket_name}
                  contextLabel={bucket.context_name || bucket.context_id}
                  status={<ListBadge tone={bucketStatusTone(bucket.status)}>{statusLabel(bucket.status)}</ListBadge>}
                  durationSeconds={bucket.duration_seconds}
                  metrics={[
                    { label: "Listed", value: formatNumber(bucket.listed_count) },
                    { label: "Checked", value: formatNumber(bucket.checked_count) },
                    { label: "Errors", value: formatNumber(bucket.failed_count) },
                    { label: "Read", value: formatBytes(bucket.bytes_read) },
                  ]}
                >
                  <BucketOperationFailures
                    bucketName={bucket.bucket_name}
                    title="Affected objects"
                    targetLabel="Object"
                    total={bucket.failed_count}
                    failures={bucket.failures_sample.map((failure) => ({
                      stage: failure.stage,
                      target: formatFailureTarget(failure),
                      version: failure.version_id,
                      message: failure.message,
                    }))}
                    emptyMessage="No affected objects reported for this bucket."
                  />
                </BucketOperationResult>
              ))}
              {filteredBucketResults.length === 0 && (
                <UiInlineMessage>No bucket result matches the current filters.</UiInlineMessage>
              )}
            </div>
          </div>
        )}
      </div>
    </WorkflowPage>
  );
}
