/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiDetails from "../../components/ui/UiDetails";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS } from "./bucketCompareShared";
import { BucketOperationProgress, BucketOperationSetup } from "./bucketOperationRunUi";
import { useSharedI18n } from "./sharedI18n";

type ConfigFeature = (typeof BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS)[number]["key"];

type BucketCompareSetupProps = {
  sourceCount: number;
  sourceName: string;
  targetSelector: ReactNode;
  actions: ReactNode;
  mappingMode: "by_name" | "manual";
  onMappingModeChange: (mode: "by_name" | "manual") => void;
  sameTarget: boolean;
  targetKind: "endpoint" | "context";
  includeContent: boolean;
  onIncludeContentChange: (value: boolean) => void;
  includeConfig: boolean;
  onIncludeConfigChange: (value: boolean) => void;
  parallelism: number;
  onParallelismChange: (value: number) => void;
  ignoreModifiedAfter: string;
  onIgnoreModifiedAfterChange: (value: string) => void;
  ignoreModifiedAfterInvalid: boolean;
  selectedConfigFeatures: ConfigFeature[];
  onConfigFeaturesChange: (features: ConfigFeature[]) => void;
  onConfigFeatureChange: (feature: ConfigFeature, selected: boolean) => void;
  running: boolean;
  children?: ReactNode;
};

/** Presentation only: each workspace retains its own targets, plan and executor. */
export default function BucketCompareSetup({
  sourceCount, sourceName, targetSelector, actions, mappingMode, onMappingModeChange,
  sameTarget, targetKind, includeContent, onIncludeContentChange, includeConfig,
  onIncludeConfigChange, parallelism, onParallelismChange, ignoreModifiedAfter,
  onIgnoreModifiedAfterChange, ignoreModifiedAfterInvalid, selectedConfigFeatures,
  onConfigFeaturesChange, onConfigFeatureChange, running, children,
}: BucketCompareSetupProps) {
  const { text: surfaceText } = useSharedI18n();
  return (
    <BucketOperationSetup
      targetLabel={surfaceText(
        sourceCount === 1 ? "Compare {count} source bucket" : "Compare {count} source buckets",
        { count: sourceCount },
      )}
      contextLabel={<span className="break-all">{surfaceText("Source:")}{sourceName}</span>}
      actions={actions}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {targetSelector}
        <UiSelect label={surfaceText("Mapping mode")} value={mappingMode} disabled={running}
          onChange={(event) => onMappingModeChange(event.target.value as "by_name" | "manual")}>
          <option value="by_name" disabled={sameTarget}>
            {sameTarget
              ? surfaceText("1:1 by bucket name (disabled on same {target})", { target: targetKind })
              : surfaceText("1:1 by bucket name")}
          </option>
          <option value="manual">{surfaceText("Manual mapping")}</option>
        </UiSelect>
      </div>
      {sameTarget && (
        <UiInlineMessage tone="warning">
          {surfaceText("Same-")}{targetKind} {surfaceText("comparison is enabled: manual mapping is required, and selected source buckets are excluded from targets.")}</UiInlineMessage>
      )}
      <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_8rem_minmax(15rem,1fr)]">
        <fieldset className="min-w-0 space-y-1">
          <legend className="ui-field-label">{surfaceText("Comparison scope")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <UiCheckboxField className="bucket-operation-checkbox" checked={includeContent}
              onChange={(event) => onIncludeContentChange(event.target.checked)} disabled={running}>
              {surfaceText("Compare bucket content")}</UiCheckboxField>
            <UiCheckboxField className="bucket-operation-checkbox" checked={includeConfig}
              onChange={(event) => onIncludeConfigChange(event.target.checked)} disabled={running}>
              {surfaceText("Compare bucket configuration")}</UiCheckboxField>
          </div>
        </fieldset>
        <UiInput label={surfaceText("Parallelism")} type="number" min={1} max={20}
          value={parallelism} onChange={(event) => onParallelismChange(Number(event.target.value))} disabled={running} />
        <UiInput label={surfaceText("Ignore objects modified after")} type="datetime-local"
          value={ignoreModifiedAfter} onChange={(event) => onIgnoreModifiedAfterChange(event.target.value)} disabled={running}
          error={ignoreModifiedAfterInvalid ? surfaceText("Enter a valid modified-after cutoff or clear the field.") : undefined} />
      </div>
      {!includeContent && !includeConfig && <UiInlineMessage tone="warning">{surfaceText("Select at least one comparison scope to run.")}</UiInlineMessage>}
      {includeConfig && (
        <UiDetails className="bucket-operation-disclosure">
          <summary>
            {surfaceText("Configuration features to compare")}</summary>
          <div className="space-y-3 border-t border-[var(--ui-border-soft)] p-3">
            <div className="flex flex-wrap gap-2">
              <UiButton variant="secondary" disabled={running}
                onClick={() => onConfigFeaturesChange(BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS.map((option) => option.key))}>{surfaceText("Select all")}</UiButton>
              <UiButton variant="secondary" disabled={running} onClick={() => onConfigFeaturesChange([])}>{surfaceText("Clear")}</UiButton>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS.map((option) => (
                <UiCheckboxField key={option.key} className="bucket-operation-checkbox"
                  checked={selectedConfigFeatures.includes(option.key)} disabled={running}
                  onChange={(event) => onConfigFeatureChange(option.key, event.target.checked)}>
                  {surfaceText(option.label)}
                </UiCheckboxField>
              ))}
            </div>
            {selectedConfigFeatures.length === 0 && <UiInlineMessage tone="warning">{surfaceText("Select at least one configuration feature.")}</UiInlineMessage>}
          </div>
        </UiDetails>
      )}
      {children}
    </BucketOperationSetup>
  );
}

export function BucketCompareProgress({ running, progress, percent }: {
  running: boolean;
  progress: { completed: number; total: number; failed: number; cancelled: number };
  percent: number;
}) {
  const { text: surfaceText } = useSharedI18n();
  return (
    <BucketOperationProgress label={surfaceText("Bucket comparison progress")} value={percent}
      stage={`${running ? "Processing" : "Completed"} ${progress.completed} / ${progress.total} mappings`}
      metrics={`${percent}%`}>
      {surfaceText("Failures so far:")}{progress.failed} {surfaceText("· Cancelled so far:")}{progress.cancelled}
    </BucketOperationProgress>
  );
}
