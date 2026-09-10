/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import UiDetails from "../../components/ui/UiDetails";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import "./bucketOperationRun.css";
import type { CompareObjectDetailLike } from "./BucketCompareObjectDetails";
import type { UiTone } from "../../components/ui/styles";
import { extractApiError, isCancelledError } from "../../utils/apiError";
import { diffToneClasses, type DiffTone } from "./diffPresentation";

type ParsedRawMappingResult = {
  mapping: Map<string, string>;
  invalidLines: string[];
};

type BucketCompareMapping = {
  sourceBucket: string;
  targetBucket: string;
};

type BucketCompareMappingModel = {
  availableTargetBucketNames: string[];
  resolvedManualMapping: Map<string, string>;
  comparePlan: {
    mappings: BucketCompareMapping[];
    error: string | null;
  };
  missingByName: string[];
};

type CompareDiffLine = {
  text: string;
  tone?: DiffTone;
};

type CompareObjectDiffLike = {
  key: string;
  source_size?: number | null;
  target_size?: number | null;
  source_etag?: string | null;
  target_etag?: string | null;
  source_last_modified?: string | null;
  target_last_modified?: string | null;
  source_storage_class?: string | null;
  target_storage_class?: string | null;
};

export type CompareVisibleKeysCopyFeedback = {
  tone: "success" | "danger";
  message: string;
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

const bucketCompareMappingTableContainerClass =
  "max-h-[240px] overflow-auto rounded-md border border-[var(--ui-border-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

type BucketCompareManualMappingEditorProps = {
  rawMappingText: string;
  onRawMappingTextChange: (value: string) => void;
  parsedRawMapping: ParsedRawMappingResult;
  sourceBuckets: string[];
  resolvedManualMapping: ReadonlyMap<string, string>;
  manualMapping: Readonly<Record<string, string>>;
  onManualMappingChange: (sourceBucket: string, targetBucket: string) => void;
  availableTargetBucketNames: string[];
  disabled: boolean;
};

export function BucketCompareManualMappingEditor({
  rawMappingText,
  onRawMappingTextChange,
  parsedRawMapping,
  sourceBuckets,
  resolvedManualMapping,
  manualMapping,
  onManualMappingChange,
  availableTargetBucketNames,
  disabled,
}: BucketCompareManualMappingEditorProps) {
  const targetOptionsId = useId();

  return (
    <div className="space-y-3">
      <UiDetails className="bucket-operation-disclosure">
        <summary>
          Raw mapping (priority)
        </summary>
        <div className="space-y-2 border-t border-[var(--ui-border-soft)] px-3 py-2">
          <UiTextarea
            label="Raw bucket mapping"
            hint={<>Accepted formats per line: <code>source =&gt; target</code>, <code>source -&gt; target</code>, <code>source = target</code>.</>}
            error={parsedRawMapping.invalidLines.length > 0 ? "Some mapping lines could not be parsed." : undefined}
            value={rawMappingText}
            onChange={(event) => onRawMappingTextChange(event.target.value)}
            disabled={disabled}
            rows={6}
            placeholder={"source-bucket-a => target-bucket-a\nsource-bucket-b -> target-bucket-b"}
            className="font-mono"
          />
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Parsed entries: {parsedRawMapping.mapping.size}. Invalid lines: {parsedRawMapping.invalidLines.length}.
          </p>
          {parsedRawMapping.invalidLines.length > 0 && (
            <pre className="whitespace-pre-wrap break-words rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
              {parsedRawMapping.invalidLines.map((line) => `- ${line}`).join("\n")}
            </pre>
          )}
        </div>
      </UiDetails>
      <div className={bucketCompareMappingTableContainerClass} role="region" aria-label="Bucket mapping" tabIndex={0}>
        <table className="ui-data-table" aria-label="Bucket mapping">
          <thead>
            <tr>
              <th scope="col" className="text-left">Source</th>
              <th scope="col" className="text-left">Target</th>
            </tr>
          </thead>
          <tbody>
            {sourceBuckets.map((sourceBucket) => {
              const rawTarget = parsedRawMapping.mapping.get(sourceBucket);
              const effectiveTarget = resolvedManualMapping.get(sourceBucket) ?? "";
              return (
                <tr key={sourceBucket} className="align-top">
                  <td className="min-w-[12rem] break-all ui-table-primary">{sourceBucket}</td>
                  <td className="min-w-[14rem] space-y-1">
                    <UiInput
                      aria-label={`Target bucket for ${sourceBucket}`}
                      list={targetOptionsId}
                      value={rawTarget ?? (manualMapping[sourceBucket] ?? "")}
                      onChange={(event) => onManualMappingChange(sourceBucket, event.target.value)}
                      disabled={disabled || Boolean(rawTarget)}
                      placeholder="target bucket"
                    />
                    {rawTarget && (
                      <p className="ui-caption text-amber-700 dark:text-amber-200">
                        Overridden by raw mapping.
                      </p>
                    )}
                    {!rawTarget && !manualMapping[sourceBucket] && effectiveTarget && (
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Fallback 1:1 applied: {effectiveTarget}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id={targetOptionsId}>
          {availableTargetBucketNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

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

export const getObjectParentPrefix = (key: string): string => {
  const index = key.lastIndexOf("/");
  if (index < 0) return "";
  return key.slice(0, index + 1);
};

export const compareObjectDetailsFromKeys = (
  keys: string[]
): CompareObjectDetailLike[] => keys.map((key) => ({ key }));

export const sourceCompareObjectDetailFromDiff = (
  diff: CompareObjectDiffLike
): CompareObjectDetailLike => ({
  key: diff.key,
  size: diff.source_size,
  etag: diff.source_etag,
  last_modified: diff.source_last_modified,
  storage_class: diff.source_storage_class,
});

export const targetCompareObjectDetailFromDiff = (
  diff: CompareObjectDiffLike
): CompareObjectDetailLike => ({
  key: diff.key,
  size: diff.target_size,
  etag: diff.target_etag,
  last_modified: diff.target_last_modified,
  storage_class: diff.target_storage_class,
});

export const getVisibleCompareObjectKeys = (rows: CompareObjectDetailLike[]): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    keys.push(row.key);
  });
  return keys;
};

export const getCompareHiddenCount = (totalCount: number, visibleCount: number, hiddenCount?: number | null): number => {
  const reportedHiddenCount = typeof hiddenCount === "number" && Number.isFinite(hiddenCount) ? hiddenCount : totalCount - visibleCount;
  return Math.max(0, reportedHiddenCount);
};

export const formatCompareDisplayLimitMessage = (
  totalCount: number,
  visibleCount: number,
  hiddenCount?: number | null
): string | null => {
  const hidden = getCompareHiddenCount(totalCount, visibleCount, hiddenCount);
  if (hidden <= 0) return null;
  return `Showing ${visibleCount} of ${totalCount} objects. ${hidden} not displayed.`;
};

const copyCompareObjectKeysToClipboard = async (keys: string[]): Promise<void> => {
  const clipboard =
    typeof window !== "undefined"
      ? window.navigator.clipboard
      : typeof navigator !== "undefined"
        ? navigator.clipboard
        : null;
  if (!clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }
  await clipboard.writeText(keys.join("\n"));
};

export const useCompareVisibleKeysClipboard = () => {
  const [copyFeedback, setCopyFeedback] = useState<
    (CompareVisibleKeysCopyFeedback & { id: string }) | null
  >(null);
  const copyVisibleKeys = useCallback(async (id: string, keys: string[]) => {
    if (keys.length === 0) return;
    try {
      await copyCompareObjectKeysToClipboard(keys);
      setCopyFeedback({
        id,
        tone: "success",
        message: `Copied ${keys.length} key${keys.length === 1 ? "" : "s"} to clipboard.`,
      });
    } catch {
      setCopyFeedback({
        id,
        tone: "danger",
        message: "Unable to copy keys to clipboard.",
      });
    }
  }, []);

  return { copyFeedback, copyVisibleKeys };
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

export const parseRawMappingText = (value: string): ParsedRawMappingResult => {
  const mapping = new Map<string, string>();
  const invalidLines: string[] = [];
  const separators = ["=>", "->", "="] as const;
  value
    .split(/\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separator = separators.find((sep) => line.includes(sep));
      if (!separator) {
        invalidLines.push(line);
        return;
      }
      const [rawSource, ...rawTargetParts] = line.split(separator);
      const source = (rawSource ?? "").trim();
      const target = rawTargetParts.join(separator).trim();
      if (!source || !target) {
        invalidLines.push(line);
        return;
      }
      mapping.set(source, target);
    });
  return { mapping, invalidLines };
};

export const reconcileBucketCompareManualMapping = ({
  previous,
  sourceBuckets,
  targetBuckets,
  sameTargetSelected,
}: {
  previous: Readonly<Record<string, string>>;
  sourceBuckets: string[];
  targetBuckets: string[];
  sameTargetSelected: boolean;
}): Record<string, string> => {
  const knownSources = new Set(sourceBuckets);
  const knownTargets = new Set(targetBuckets);
  const next: Record<string, string> = {};

  sourceBuckets.forEach((sourceBucket) => {
    const previousTarget = (previous[sourceBucket] ?? "").trim();
    if (previousTarget) {
      if (sameTargetSelected && knownSources.has(previousTarget)) return;
      next[sourceBucket] = previousTarget;
      return;
    }
    if (knownTargets.has(sourceBucket) && !sameTargetSelected) {
      next[sourceBucket] = sourceBucket;
    }
  });

  return next;
};

export const mergeRawBucketCompareMappings = (
  previous: Readonly<Record<string, string>>,
  sourceBuckets: string[],
  rawMapping: ReadonlyMap<string, string>
): Readonly<Record<string, string>> => {
  const next = { ...previous };
  let changed = false;
  sourceBuckets.forEach((sourceBucket) => {
    const mapped = rawMapping.get(sourceBucket);
    if (!mapped || (next[sourceBucket] ?? "").trim() === mapped) return;
    next[sourceBucket] = mapped;
    changed = true;
  });
  return changed ? next : previous;
};

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

export const useBucketCompareManualMappingState = ({
  mappingMode,
  sourceBuckets,
  targetBuckets,
  sameTargetSelected,
}: {
  mappingMode: "by_name" | "manual";
  sourceBuckets: string[];
  targetBuckets: string[];
  sameTargetSelected: boolean;
}) => {
  const [manualMapping, setManualMapping] = useState<Record<string, string>>({});
  const [rawMappingText, setRawMappingText] = useState("");
  const parsedRawMapping = useMemo(() => parseRawMappingText(rawMappingText), [rawMappingText]);

  useEffect(() => {
    if (mappingMode !== "manual") return;
    setManualMapping((previous) =>
      reconcileBucketCompareManualMapping({
        previous,
        sourceBuckets,
        targetBuckets,
        sameTargetSelected,
      })
    );
  }, [mappingMode, sameTargetSelected, sourceBuckets, targetBuckets]);

  useEffect(() => {
    if (mappingMode !== "manual" || parsedRawMapping.mapping.size === 0) return;
    setManualMapping((previous) =>
      mergeRawBucketCompareMappings(previous, sourceBuckets, parsedRawMapping.mapping)
    );
  }, [mappingMode, parsedRawMapping.mapping, sourceBuckets]);

  return {
    manualMapping,
    parsedRawMapping,
    rawMappingText,
    setManualMapping,
    setRawMappingText,
  };
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

export const buildBucketCompareMappingModel = ({
  targetSelected,
  targetKind,
  sourceBuckets,
  targetBuckets,
  sameTargetSelected,
  mappingMode,
  rawMapping,
  manualMapping,
}: {
  targetSelected: boolean;
  targetKind: "endpoint" | "context";
  sourceBuckets: string[];
  targetBuckets: string[];
  sameTargetSelected: boolean;
  mappingMode: "by_name" | "manual";
  rawMapping: ReadonlyMap<string, string>;
  manualMapping: Readonly<Record<string, string>>;
}): BucketCompareMappingModel => {
  const sourceBucketNames = new Set(sourceBuckets);
  const availableTargetBucketNames = sameTargetSelected
    ? targetBuckets.filter((name) => !sourceBucketNames.has(name))
    : targetBuckets;
  const availableTargetNames = new Set(availableTargetBucketNames);
  const resolvedManualMapping = new Map<string, string>();

  sourceBuckets.forEach((sourceBucket) => {
    const rawMapped = rawMapping.get(sourceBucket);
    if (rawMapped) {
      resolvedManualMapping.set(sourceBucket, rawMapped);
      return;
    }
    const uiMapped = (manualMapping[sourceBucket] ?? "").trim();
    if (uiMapped) {
      resolvedManualMapping.set(sourceBucket, uiMapped);
      return;
    }
    if (availableTargetNames.has(sourceBucket)) {
      resolvedManualMapping.set(sourceBucket, sourceBucket);
    }
  });

  let comparePlan: BucketCompareMappingModel["comparePlan"];
  if (!targetSelected) {
    comparePlan = { mappings: [], error: `Select a target ${targetKind}.` };
  } else if (sourceBuckets.length === 0) {
    comparePlan = { mappings: [], error: "Select source buckets first." };
  } else if (sameTargetSelected && mappingMode !== "manual") {
    comparePlan = {
      mappings: [],
      error: `Same-${targetKind} comparison requires manual mapping.`,
    };
  } else if (mappingMode === "by_name") {
    comparePlan = {
      mappings: sourceBuckets.map((bucket) => ({
        sourceBucket: bucket,
        targetBucket: bucket,
      })),
      error: null,
    };
  } else {
    const mappings: BucketCompareMapping[] = [];
    let hasInvalidTarget = false;
    sourceBuckets.forEach((sourceBucket) => {
      const targetBucket = (resolvedManualMapping.get(sourceBucket) ?? "").trim();
      if (!targetBucket) return;
      if (sameTargetSelected && sourceBucketNames.has(targetBucket)) {
        hasInvalidTarget = true;
        return;
      }
      mappings.push({ sourceBucket, targetBucket });
    });
    if (hasInvalidTarget) {
      comparePlan = {
        mappings: [],
        error: `When source and target ${targetKind} are the same, mapped target buckets must be outside the selected source set.`,
      };
    } else if (mappings.length === 0) {
      comparePlan = {
        mappings: [],
        error: "No mapping resolved. Add raw mapping lines, fill manual fields, or rely on 1:1 fallback when available.",
      };
    } else {
      comparePlan = { mappings, error: null };
    }
  }

  const targetBucketNames = new Set(targetBuckets);
  const missingByName =
    mappingMode === "by_name"
      ? sourceBuckets.filter((name) => !targetBucketNames.has(name))
      : [];

  return {
    availableTargetBucketNames,
    resolvedManualMapping,
    comparePlan,
    missingByName,
  };
};
