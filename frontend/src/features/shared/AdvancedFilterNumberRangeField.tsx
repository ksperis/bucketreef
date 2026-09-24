/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId } from "react";

import UiInput from "../../components/ui/UiInput";
import { cx } from "../../components/ui/styles";
import AdvancedFilterFieldLabel from "./AdvancedFilterFieldLabel";
import {
  advancedFilterFieldCardClass,
  type AdvancedFilterFieldState,
  type FilterCostLevel,
} from "./advancedFilterShared";

type AdvancedFilterNumberRangeFieldProps = {
  accessibleLabel?: string;
  className?: string;
  costLevel?: FilterCostLevel;
  costTooltip?: string;
  disabled?: boolean;
  fieldState: AdvancedFilterFieldState;
  inputMin?: number;
  label: string;
  maxFieldState: AdvancedFilterFieldState;
  maxValue: string;
  minFieldState: AdvancedFilterFieldState;
  minValue: string;
  onMaxChange: (value: string) => void;
  onMinChange: (value: string) => void;
};

export default function AdvancedFilterNumberRangeField({
  accessibleLabel,
  className,
  costLevel,
  costTooltip,
  disabled = false,
  fieldState,
  inputMin,
  label,
  maxFieldState,
  maxValue,
  minFieldState,
  minValue,
  onMaxChange,
  onMinChange,
}: AdvancedFilterNumberRangeFieldProps) {
  const fieldId = useId();
  const minId = `${fieldId}-min`;
  const maxId = `${fieldId}-max`;
  const controlLabel = accessibleLabel ?? label;

  return (
    <div className={advancedFilterFieldCardClass(className)}>
      <AdvancedFilterFieldLabel
        costLevel={costLevel}
        costTooltip={costTooltip}
        fieldState={fieldState}
        htmlFor={minId}
        label={label}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <UiInput
          id={minId}
          type="number"
          inputMode="numeric"
          min={inputMin}
          value={minValue}
          onChange={(event) => onMinChange(event.target.value)}
          aria-label={`${controlLabel} minimum`}
          placeholder="Min"
          disabled={disabled}
          size="compact"
          fieldClassName="min-w-0"
          className={cx("ui-list-control w-full font-normal", minFieldState.fieldClass)}
        />
        <UiInput
          id={maxId}
          type="number"
          inputMode="numeric"
          min={inputMin}
          value={maxValue}
          onChange={(event) => onMaxChange(event.target.value)}
          aria-label={`${controlLabel} maximum`}
          placeholder="Max"
          disabled={disabled}
          size="compact"
          fieldClassName="min-w-0"
          className={cx("ui-list-control w-full font-normal", maxFieldState.fieldClass)}
        />
      </div>
    </div>
  );
}
