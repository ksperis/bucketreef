/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import AdvancedFilterNumberRangeField from "../../shared/AdvancedFilterNumberRangeField";
import { advancedFilterSectionClass } from "../../shared/advancedFilterShared";
import { useSharedI18n } from "../../shared/sharedI18n";
import {
  buildNumericFilterFieldStates,
  numericFilterRangeFieldHighlight,
  type NumericFilterRangeField,
} from "./advancedFilterModel";

type AdvancedFilterNumericRangesSectionProps<Key extends string> = {
  applied: Record<Key, string> | null;
  canViewUsage: boolean;
  draft: Record<Key, string>;
  onChange: (field: Key, value: string) => void;
  rangeCostTooltip: string;
  ranges: readonly NumericFilterRangeField<Key>[];
  usageRanges: readonly NumericFilterRangeField<Key>[];
};

export default function AdvancedFilterNumericRangesSection<Key extends string>({
  applied,
  canViewUsage,
  draft,
  onChange,
  rangeCostTooltip,
  ranges,
  usageRanges,
}: AdvancedFilterNumericRangesSectionProps<Key>) {
  const { text: surfaceText } = useSharedI18n();
  const fieldStates = buildNumericFilterFieldStates(
    draft,
    applied,
    [...ranges, ...usageRanges].flatMap(({ minKey, maxKey }) => [
      { key: minKey },
      { key: maxKey },
    ]),
  );

  const renderRange = (field: NumericFilterRangeField<Key>, inputMin?: number) => (
    <AdvancedFilterNumberRangeField
      key={`${field.minKey}:${field.maxKey}`}
      label={field.label}
      costLevel="medium"
      costTooltip={rangeCostTooltip}
      fieldState={numericFilterRangeFieldHighlight(draft, applied, field.minKey, field.maxKey)}
      minFieldState={fieldStates[field.minKey]}
      maxFieldState={fieldStates[field.maxKey]}
      minValue={draft[field.minKey]}
      maxValue={draft[field.maxKey]}
      inputMin={inputMin}
      onMinChange={(value) => onChange(field.minKey, value)}
      onMaxChange={(value) => onChange(field.maxKey, value)}
    />
  );

  return (
    <section className={advancedFilterSectionClass}>
      <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {surfaceText("Limits and Quotas")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">{ranges.map((field) => renderRange(field))}</div>
      {canViewUsage && (
        <div className="mt-4">
          <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {surfaceText("Quota usage %")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {usageRanges.map((field) => renderRange(field, 0))}
          </div>
        </div>
      )}
    </section>
  );
}
