/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import AdvancedFilterSelectField from "./AdvancedFilterSelectField";
import {
  formatFeatureFilterStateLabel,
  type AdvancedFilterState,
  type FeatureFilterState,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import { buildAdvancedFilterFieldState } from "./bucketOpsAdvancedFilterUiProjection";

type FeatureStateOption = {
  id: FeatureKey;
  label: string;
  supported: boolean;
};

const BINARY_FEATURE_FILTER_STATES: FeatureFilterState[] = [
  "any",
  "enabled",
  "disabled",
];
const VERSIONING_FILTER_STATES: FeatureFilterState[] = [
  ...BINARY_FEATURE_FILTER_STATES,
  "suspended",
  "disabled_or_suspended",
];

type BucketOpsFeatureStateFilterFieldsProps = {
  advancedApplied: AdvancedFilterState | null;
  advancedDraft: AdvancedFilterState;
  featureStateOptions: FeatureStateOption[];
  onFeatureChange: (feature: FeatureKey, value: FeatureFilterState) => void;
};

export default function BucketOpsFeatureStateFilterFields({
  advancedApplied,
  advancedDraft,
  featureStateOptions,
  onFeatureChange,
}: BucketOpsFeatureStateFilterFieldsProps) {
  const hasUnsupportedFeature = featureStateOptions.some(
    (feature) => !feature.supported,
  );

  return (
    <>
      {hasUnsupportedFeature && (
        <p className="mb-3 ui-caption text-slate-500 dark:text-slate-400">
          Some features are disabled on this endpoint and cannot be filtered.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {featureStateOptions.map((feature) => {
          const disabled = !feature.supported;
          const appliedValue =
            advancedApplied?.features[feature.id] ?? "any";
          const draftValue = advancedDraft.features[feature.id];
          const state = disabled
            ? { labelClass: "", fieldClass: "" }
            : buildAdvancedFilterFieldState(
                appliedValue !== "any",
                draftValue !== appliedValue,
              );
          const filterStates =
            feature.id === "versioning"
              ? VERSIONING_FILTER_STATES
              : BINARY_FEATURE_FILTER_STATES;
          return (
            <AdvancedFilterSelectField
              key={feature.id}
              label={feature.label}
              className={disabled ? "opacity-60" : undefined}
              disabled={disabled}
              fieldState={state}
              value={draftValue}
              onChange={(value) =>
                onFeatureChange(feature.id, value as FeatureFilterState)
              }
              hint={disabled ? `${feature.label} is disabled on this endpoint.` : undefined}
            >
              {filterStates.map((filterState) => (
                <option key={filterState} value={filterState}>
                  {formatFeatureFilterStateLabel(filterState)}
                </option>
              ))}
            </AdvancedFilterSelectField>
          );
        })}
      </div>
    </>
  );
}
