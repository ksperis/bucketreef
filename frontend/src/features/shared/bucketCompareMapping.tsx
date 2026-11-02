/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useId, useMemo, useState } from "react";
import UiDetails from "../../components/ui/UiDetails";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import "./bucketOperationRun.css";
import { useSharedI18n } from "./sharedI18n";

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
  const { text: surfaceText } = useSharedI18n();
  const targetOptionsId = useId();

  return (
    <div className="space-y-3">
      <UiDetails className="bucket-operation-disclosure">
        <summary>{surfaceText("Raw mapping (priority)")}</summary>
        <div className="space-y-2 border-t border-[var(--ui-border-soft)] px-3 py-2">
          <UiTextarea
            label={surfaceText("Raw bucket mapping")}
            hint={
              <>
                {surfaceText("Accepted formats per line:")}
                <code>{surfaceText("source =&gt; target")}</code>,{" "}
                <code>{surfaceText("source -&gt; target")}</code>,{" "}
                <code>{surfaceText("source = target")}</code>.
              </>
            }
            error={
              parsedRawMapping.invalidLines.length > 0
                ? surfaceText("Some mapping lines could not be parsed.")
                : undefined
            }
            value={rawMappingText}
            onChange={(event) => onRawMappingTextChange(event.target.value)}
            disabled={disabled}
            rows={6}
            placeholder={surfaceText(
              "source-bucket-a => target-bucket-a source-bucket-b -> target-bucket-b",
            )}
            className="font-mono"
          />
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {surfaceText("Parsed entries: {parsed}. Invalid lines: {invalid}.", {
              parsed: parsedRawMapping.mapping.size,
              invalid: parsedRawMapping.invalidLines.length,
            })}
          </p>
          {parsedRawMapping.invalidLines.length > 0 && (
            <pre className="whitespace-pre-wrap break-words rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
              {parsedRawMapping.invalidLines.map((line) => `- ${line}`).join("\n")}
            </pre>
          )}
        </div>
      </UiDetails>
      <div
        className={bucketCompareMappingTableContainerClass}
        role="region"
        aria-label={surfaceText("Bucket mapping")}
        tabIndex={0}
      >
        <table className="ui-data-table" aria-label={surfaceText("Bucket mapping")}>
          <thead>
            <tr>
              <th scope="col" className="text-left">
                {surfaceText("Source")}
              </th>
              <th scope="col" className="text-left">
                {surfaceText("Target")}
              </th>
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
                      aria-label={surfaceText("Target bucket for {bucket}", {
                        bucket: sourceBucket,
                      })}
                      list={targetOptionsId}
                      value={rawTarget ?? (manualMapping[sourceBucket] ?? "")}
                      onChange={(event) =>
                        onManualMappingChange(sourceBucket, event.target.value)
                      }
                      disabled={disabled || Boolean(rawTarget)}
                      placeholder={surfaceText("target bucket")}
                    />
                    {rawTarget && (
                      <p className="ui-caption text-amber-700 dark:text-amber-200">
                        {surfaceText("Overridden by raw mapping.")}
                      </p>
                    )}
                    {!rawTarget && !manualMapping[sourceBucket] && effectiveTarget && (
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        {surfaceText("Fallback 1:1 applied: {target}", {
                          target: effectiveTarget,
                        })}
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
  rawMapping: ReadonlyMap<string, string>,
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
  const parsedRawMapping = useMemo(
    () => parseRawMappingText(rawMappingText),
    [rawMappingText],
  );

  useEffect(() => {
    if (mappingMode !== "manual") return;
    setManualMapping((previous) =>
      reconcileBucketCompareManualMapping({
        previous,
        sourceBuckets,
        targetBuckets,
        sameTargetSelected,
      }),
    );
  }, [mappingMode, sameTargetSelected, sourceBuckets, targetBuckets]);

  useEffect(() => {
    if (mappingMode !== "manual" || parsedRawMapping.mapping.size === 0) return;
    setManualMapping((previous) =>
      mergeRawBucketCompareMappings(previous, sourceBuckets, parsedRawMapping.mapping),
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

export const buildBucketCompareMappingModel = ({
  targetSelected,
  targetKind,
  sourceBuckets,
  targetBuckets,
  targetInventoryComplete = true,
  sameTargetSelected,
  mappingMode,
  rawMapping,
  manualMapping,
}: {
  targetSelected: boolean;
  targetKind: "endpoint" | "context";
  sourceBuckets: string[];
  targetBuckets: string[];
  targetInventoryComplete?: boolean;
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
        error:
          "No mapping resolved. Add raw mapping lines, fill manual fields, or rely on 1:1 fallback when available.",
      };
    } else {
      comparePlan = { mappings, error: null };
    }
  }

  const targetBucketNames = new Set(targetBuckets);
  const missingByName =
    targetInventoryComplete && mappingMode === "by_name"
      ? sourceBuckets.filter((name) => !targetBucketNames.has(name))
      : [];

  return {
    availableTargetBucketNames,
    resolvedManualMapping,
    comparePlan,
    missingByName,
  };
};
