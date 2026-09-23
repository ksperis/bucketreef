/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";

import { cx, uiLabelClass } from "../../components/ui/styles";
import {
  advancedFilterControlClass,
  advancedFilterFieldCardClass,
  advancedFilterMatchModeButtonClass,
  renderFilterCostIndicator,
  type FilterCostLevel,
  type TextMatchMode,
} from "./advancedFilterShared";

type AdvancedFilterFieldState = {
  fieldClass: string;
  labelClass: string;
};

type AdvancedFilterTextMatchFieldProps = {
  children?: ReactNode;
  className?: string;
  containsAriaLabel?: string;
  containsLabel?: ReactNode;
  costLevel?: FilterCostLevel;
  costTooltip?: string;
  exactAriaLabel?: string;
  exactLabel?: ReactNode;
  fieldState: AdvancedFilterFieldState;
  forcesExact: boolean;
  label: ReactNode;
  matchMode: TextMatchMode;
  onChange: (value: string) => void;
  onMatchModeChange: (value: TextMatchMode) => void;
  placeholder?: string;
  rows?: number;
  textareaClassName?: string;
  value: string;
};

export default function AdvancedFilterTextMatchField({
  children,
  className,
  containsAriaLabel = "Contains",
  containsLabel = "Contains",
  costLevel,
  costTooltip,
  exactAriaLabel = "Exact",
  exactLabel = "Exact",
  fieldState,
  forcesExact,
  label,
  matchMode,
  onChange,
  onMatchModeChange,
  placeholder,
  rows = 2,
  textareaClassName,
  value,
}: AdvancedFilterTextMatchFieldProps) {
  const controlId = useId();

  return (
    <div className={advancedFilterFieldCardClass(className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={controlId} className={cx(uiLabelClass, fieldState.labelClass)}>
          <span className="inline-flex items-center gap-1">
            <span>{label}</span>
            {costLevel && costTooltip ? renderFilterCostIndicator(costLevel, costTooltip) : null}
          </span>
        </label>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={forcesExact}
            aria-label={containsAriaLabel}
            aria-pressed={matchMode === "contains"}
            onClick={() => onMatchModeChange("contains")}
            className={advancedFilterMatchModeButtonClass(matchMode === "contains", forcesExact)}
          >
            {containsLabel}
          </button>
          <button
            type="button"
            disabled={forcesExact}
            aria-label={exactAriaLabel}
            aria-pressed={matchMode === "exact"}
            onClick={() => onMatchModeChange("exact")}
            className={advancedFilterMatchModeButtonClass(matchMode === "exact", forcesExact)}
          >
            {exactLabel}
          </button>
        </div>
      </div>
      <textarea
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder={placeholder}
        rows={rows}
        className={advancedFilterControlClass(
          cx("mt-2 w-full resize-y px-2 py-1.5 font-normal", fieldState.fieldClass, textareaClassName),
        )}
      />
      {children}
    </div>
  );
}
