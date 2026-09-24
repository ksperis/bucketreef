/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";

import UiTextarea from "../../components/ui/UiTextarea";
import { cx } from "../../components/ui/styles";
import AdvancedFilterFieldLabel from "./AdvancedFilterFieldLabel";
import {
  advancedFilterFieldCardClass,
  advancedFilterMatchModeButtonClass,
  type AdvancedFilterFieldState,
  type FilterCostLevel,
  type TextMatchMode,
} from "./advancedFilterShared";

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
        <AdvancedFilterFieldLabel
          costLevel={costLevel}
          costTooltip={costTooltip}
          fieldState={fieldState}
          htmlFor={controlId}
          label={label}
        />
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
      <UiTextarea
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder={placeholder}
        rows={rows}
        size="compact"
        className={cx("ui-list-control mt-2 w-full resize-y font-normal", fieldState.fieldClass, textareaClassName)}
      />
      {children}
    </div>
  );
}
