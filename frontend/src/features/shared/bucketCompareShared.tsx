/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UiTone } from "../../components/ui/styles";
import { extractApiError, isCancelledError } from "../../utils/apiError";
import { roundedClampedPercentageOf } from "../../utils/numbers";
import { diffToneClasses, type DiffTone } from "./diffPresentation";
import { useCompareVisibleKeysClipboard } from "./bucketCompareContentDiff";
import {
  buildBucketCompareMappingModel,
  useBucketCompareManualMappingState,
} from "./bucketCompareMapping";

type CompareDiffLine = {
  text: string;
  tone?: DiffTone;
};

type RunItemStatus = "pending" | "running" | "success" | "failed" | "cancelled";

type RunStatusItem = {
  status: RunItemStatus;
  result?: { has_differences?: boolean } | null;
};

export type BucketCompareRunPresentationItem = RunStatusItem & {
  sourceBucket: string;
  targetBucket: string;
  error?: string;
};

export type BucketCompareRunFilters = {
  search: string;
  status: "all" | RunItemStatus;
  differences: "all" | "with_diff" | "no_diff";
};

type BucketCompareRunSettlement<TResult> =
  | { status: "success"; result: TResult }
  | { status: "failed" | "cancelled"; error: string };

type BucketCompareRunProgress = {
  completed: number;
  total: number;
  failed: number;
  cancelled: number;
};

type BucketCompareSettledRunItem<TResult> = {
  status: RunItemStatus;
  result?: TResult;
  error?: string;
};

export const BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS = [
  { key: "versioning_status", label: "Versioning" },
  { key: "object_lock", label: "Object lock" },
  { key: "public_access_block", label: "Public access block" },
  { key: "lifecycle_rules", label: "Lifecycle rules" },
  { key: "cors_rules", label: "CORS rules" },
  { key: "bucket_policy", label: "Bucket policy" },
  { key: "access_logging", label: "Access logging" },
  { key: "tags", label: "Tags" },
] as const;

export const extractCompareError = (err: unknown): string => {
  return extractApiError(err, "Bucket comparison failed.");
};

export const bucketComparisonCancelledMessage =
  "Comparison cancelled in this browser. The backend may still be finishing; verify the current state before retrying.";

export const resolveBucketCompareRunSettlement = <TResult,>(
  result: PromiseSettledResult<TResult>,
  cancellationRequested: boolean
): BucketCompareRunSettlement<TResult> => {
  if (result.status === "fulfilled") {
    return cancellationRequested
      ? { status: "cancelled", error: bucketComparisonCancelledMessage }
      : { status: "success", result: result.value };
  }
  if (cancellationRequested || isCancelledError(result.reason)) {
    return { status: "cancelled", error: bucketComparisonCancelledMessage };
  }
  return { status: "failed", error: extractCompareError(result.reason) };
};

export const updateBucketCompareRunProgress = <TResult,>(
  progress: BucketCompareRunProgress,
  settlement: BucketCompareRunSettlement<TResult>
): BucketCompareRunProgress => ({
  completed: progress.completed + 1,
  total: progress.total,
  failed: progress.failed + (settlement.status === "failed" ? 1 : 0),
  cancelled: progress.cancelled + (settlement.status === "cancelled" ? 1 : 0),
});

export const updateBucketCompareRunItem = <
  TResult,
  TItem extends BucketCompareSettledRunItem<TResult>,
>(
  item: TItem,
  settlement: BucketCompareRunSettlement<TResult>
) => {
  if (settlement.status === "success") {
    return { ...item, status: "success" as const, result: settlement.result };
  }
  return { ...item, status: settlement.status, error: settlement.error };
};

export const useBucketCompareRunState = <
  TResult,
  TItem extends BucketCompareSettledRunItem<TResult>,
>() => {
  const [progress, setProgress] = useState<BucketCompareRunProgress>({
    completed: 0,
    total: 0,
    failed: 0,
    cancelled: 0,
  });
  const [items, setItems] = useState<TItem[]>([]);
  const cancelRequestedRef = useRef(false);
  const settleRunItem = useCallback((result: PromiseSettledResult<TResult>, index: number) => {
    const settlement = resolveBucketCompareRunSettlement(
      result,
      cancelRequestedRef.current
    );
    setProgress((current) => updateBucketCompareRunProgress(current, settlement));
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? updateBucketCompareRunItem(item, settlement) : item
      )
    );
  }, []);

  return {
    cancelRequestedRef,
    items,
    progress,
    setItems,
    setProgress,
    settleRunItem,
  };
};

export const formatUnknown = (value: unknown) => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export function parseOptionalIsoDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const normalizeBucketCompareParallelism = (value: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.min(20, Math.floor(value))) : 4;

export const resolveBucketCompareRunError = ({
  targetSelected,
  hasScopeSelected,
  includeConfig,
  hasConfigFeatureSelected,
  ignoreModifiedAfterInvalid,
  planError,
  messages,
}: {
  targetSelected: boolean;
  hasScopeSelected: boolean;
  includeConfig: boolean;
  hasConfigFeatureSelected: boolean;
  ignoreModifiedAfterInvalid: boolean;
  planError: string | null;
  messages: {
    targetRequired: string;
    scopeRequired: string;
    configFeatureRequired: string;
    invalidCutoff: string;
  };
}): string | null => {
  if (!targetSelected) return messages.targetRequired;
  if (!hasScopeSelected) return messages.scopeRequired;
  if (includeConfig && !hasConfigFeatureSelected) return messages.configFeatureRequired;
  if (ignoreModifiedAfterInvalid) return messages.invalidCutoff;
  return planError;
};

export const renderDiffLines = (lines: CompareDiffLine[]) => (
  <div className="space-y-2">
    {lines.map((line, idx) => (
      <pre
        key={`${line.text}-${idx}`}
        className={`whitespace-pre-wrap break-words rounded-md border px-2 py-1 font-mono text-[11px] leading-relaxed ${diffToneClasses(
          line.tone
        )}`}
      >
        {line.text}
      </pre>
    ))}
  </div>
);

export const getRunStatusTone = (item: RunStatusItem): UiTone => {
  if (item.status === "failed") return "danger";
  if (item.status === "cancelled") return "warning";
  if (item.status === "success") {
    return item.result?.has_differences ? "warning" : "success";
  }
  return "neutral";
};

export const getRunStatusLabel = (item: RunStatusItem): string => {
  if (item.status === "pending") return "Pending";
  if (item.status === "running") return "Running";
  if (item.status === "failed") return "Failed";
  if (item.status === "cancelled") return "Cancelled";
  if (item.status === "success") {
    if (typeof item.result?.has_differences === "boolean") {
      return item.result.has_differences ? "Different" : "Identical";
    }
    return "Done";
  }
  return item.status;
};

export const summarizeBucketCompareRun = (items: RunStatusItem[]) =>
  items.reduce(
    (summary, item) => ({
      success: summary.success + (item.status === "success" ? 1 : 0),
      failed: summary.failed + (item.status === "failed" ? 1 : 0),
      cancelled: summary.cancelled + (item.status === "cancelled" ? 1 : 0),
      withDiff: summary.withDiff + (item.result?.has_differences ? 1 : 0),
    }),
    { success: 0, failed: 0, cancelled: 0, withDiff: 0 }
  );

export const matchesBucketCompareRunFilters = (
  item: BucketCompareRunPresentationItem,
  filters: BucketCompareRunFilters
): boolean => {
  if (filters.status !== "all" && item.status !== filters.status) return false;
  if (filters.differences === "with_diff" && !item.result?.has_differences) {
    return false;
  }
  if (filters.differences === "no_diff") {
    if (item.status !== "success") return false;
    if (item.result?.has_differences) return false;
  }

  const search = filters.search.trim().toLowerCase();
  if (!search) return true;
  return [item.sourceBucket, item.targetBucket, item.error ?? ""].some((value) =>
    value.toLowerCase().includes(search)
  );
};

export const getChangedTone = (changed: boolean): UiTone => (changed ? "warning" : "neutral");

export const updateBucketCompareConfigFeatures = <TFeature extends string>(
  current: readonly TFeature[],
  orderedFeatures: readonly TFeature[],
  feature: TFeature,
  enabled: boolean
): TFeature[] => {
  const next = new Set(current);
  if (enabled) {
    next.add(feature);
  } else {
    next.delete(feature);
  }
  return orderedFeatures.filter((key) => next.has(key));
};

export const useBucketCompareConfigFeatures = <TFeature extends string>(
  orderedFeatures: readonly TFeature[]
) => {
  const [selectedConfigFeatures, setSelectedConfigFeatures] = useState<TFeature[]>(
    () => [...orderedFeatures]
  );
  const toggleConfigFeature = useCallback(
    (feature: TFeature, enabled: boolean) => {
      setSelectedConfigFeatures((current) =>
        updateBucketCompareConfigFeatures(current, orderedFeatures, feature, enabled)
      );
    },
    [orderedFeatures]
  );

  return {
    selectedConfigFeatures,
    setSelectedConfigFeatures,
    toggleConfigFeature,
  };
};

export const useBucketCompareWorkflowState = <
  TFeature extends string,
  TResult,
  TItem extends BucketCompareSettledRunItem<TResult>,
>({
  targetSelected,
  targetKind,
  sourceBuckets,
  targetBuckets,
  targetInventoryComplete = true,
  sameTargetSelected,
  configFeatures,
}: {
  targetSelected: boolean;
  targetKind: "endpoint" | "context";
  sourceBuckets: string[];
  targetBuckets: string[];
  targetInventoryComplete?: boolean;
  sameTargetSelected: boolean;
  configFeatures: readonly TFeature[];
}) => {
  const [mappingMode, setMappingMode] = useState<"by_name" | "manual">("by_name");
  const [includeContent, setIncludeContent] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(false);
  const [ignoreModifiedAfter, setIgnoreModifiedAfter] = useState("");
  const [parallelism, setParallelism] = useState(4);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<BucketCompareRunFilters["status"]>("all");
  const [diffFilter, setDiffFilter] = useState<BucketCompareRunFilters["differences"]>("all");

  useEffect(() => {
    if (sameTargetSelected && mappingMode !== "manual") {
      setMappingMode("manual");
    }
  }, [mappingMode, sameTargetSelected]);

  const mapping = useBucketCompareManualMappingState({
    mappingMode,
    sourceBuckets,
    targetBuckets,
    sameTargetSelected,
  });
  const config = useBucketCompareConfigFeatures<TFeature>(configFeatures);
  const run = useBucketCompareRunState<TResult, TItem>();
  const clipboard = useCompareVisibleKeysClipboard();
  const requestControllersRef = useRef(new Set<AbortController>());
  const { cancelRequestedRef, setItems, setProgress } = run;

  const abortRequests = useCallback(() => {
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
  }, []);

  const beginRun = useCallback(
    (initialItems: TItem[]) => {
      setRunError(null);
      cancelRequestedRef.current = false;
      setRunning(true);
      setStopping(false);
      setProgress({ completed: 0, total: initialItems.length, failed: 0, cancelled: 0 });
      setItems(initialItems);
    },
    [cancelRequestedRef, setItems, setProgress],
  );

  const executeRunItem = useCallback(
    async (index: number, execute: (signal: AbortSignal) => Promise<TResult>): Promise<TResult> => {
      if (cancelRequestedRef.current) {
        throw new DOMException("Comparison cancelled", "AbortError");
      }
      setItems((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? ({ ...item, status: "running" } as TItem) : item,
        ),
      );
      const controller = new AbortController();
      requestControllersRef.current.add(controller);
      try {
        return await execute(controller.signal);
      } finally {
        requestControllersRef.current.delete(controller);
      }
    },
    [cancelRequestedRef, setItems],
  );

  const finishRun = useCallback(() => {
    abortRequests();
    setRunning(false);
    setStopping(false);
  }, [abortRequests]);

  const stopRun = useCallback(() => {
    if (!running) return false;
    cancelRequestedRef.current = true;
    setStopping(true);
    abortRequests();
    setItems((current) =>
      current.map((item) =>
        item.status === "pending" || item.status === "running"
          ? ({
              ...item,
              status: "cancelled",
              error: bucketComparisonCancelledMessage,
            } as TItem)
          : item,
      ),
    );
    return true;
  }, [abortRequests, cancelRequestedRef, running, setItems]);

  useEffect(() => {
    return () => {
      cancelRequestedRef.current = true;
      abortRequests();
    };
  }, [abortRequests, cancelRequestedRef]);
  const mappingModel = useMemo(
    () =>
      buildBucketCompareMappingModel({
        targetSelected,
        targetKind,
        sourceBuckets,
        targetBuckets,
        targetInventoryComplete,
        sameTargetSelected,
        mappingMode,
        rawMapping: mapping.parsedRawMapping.mapping,
        manualMapping: mapping.manualMapping,
      }),
    [
      mapping.manualMapping,
      mapping.parsedRawMapping.mapping,
      mappingMode,
      sameTargetSelected,
      sourceBuckets,
      targetBuckets,
      targetInventoryComplete,
      targetKind,
      targetSelected,
    ]
  );
  const progressPercent = useMemo(
    () => roundedClampedPercentageOf(run.progress.completed, run.progress.total) ?? 0,
    [run.progress.completed, run.progress.total]
  );
  const hasScopeSelected = includeContent || includeConfig;
  const hasConfigFeatureSelected = config.selectedConfigFeatures.length > 0;
  const ignoreModifiedAfterIso = useMemo(
    () => parseOptionalIsoDateTime(ignoreModifiedAfter),
    [ignoreModifiedAfter]
  );
  const ignoreModifiedAfterInvalid =
    Boolean(ignoreModifiedAfter.trim()) && !ignoreModifiedAfterIso;

  return {
    mappingMode,
    setMappingMode,
    includeContent,
    setIncludeContent,
    includeConfig,
    setIncludeConfig,
    ignoreModifiedAfter,
    setIgnoreModifiedAfter,
    parallelism,
    setParallelism,
    running,
    setRunning,
    stopping,
    setStopping,
    runError,
    setRunError,
    resultSearch,
    setResultSearch,
    statusFilter,
    setStatusFilter,
    diffFilter,
    setDiffFilter,
    requestControllersRef,
    ...mappingModel,
    progressPercent,
    hasScopeSelected,
    hasConfigFeatureSelected,
    ignoreModifiedAfterIso,
    ignoreModifiedAfterInvalid,
    beginRun,
    executeRunItem,
    finishRun,
    stopRun,
    ...mapping,
    ...config,
    ...run,
    ...clipboard,
  };
};
