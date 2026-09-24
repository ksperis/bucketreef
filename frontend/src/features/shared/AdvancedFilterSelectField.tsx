/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";

import UiSelect from "../../components/ui/UiSelect";
import { cx } from "../../components/ui/styles";
import AdvancedFilterFieldLabel from "./AdvancedFilterFieldLabel";
import {
  advancedFilterFieldCardClass,
  type AdvancedFilterFieldState,
  type FilterCostLevel,
} from "./advancedFilterShared";

type AdvancedFilterSelectFieldProps = {
  children: ReactNode;
  className?: string;
  costLevel?: FilterCostLevel;
  costTooltip?: string;
  disabled?: boolean;
  fieldState: AdvancedFilterFieldState;
  hint?: ReactNode;
  label: ReactNode;
  onChange: (value: string) => void;
  selectClassName?: string;
  title?: string;
  value: string;
};

export default function AdvancedFilterSelectField({
  children,
  className,
  costLevel,
  costTooltip,
  disabled = false,
  fieldState,
  hint,
  label,
  onChange,
  selectClassName,
  title,
  value,
}: AdvancedFilterSelectFieldProps) {
  const controlId = useId();
  const hintId = hint ? `${controlId}-hint` : undefined;

  return (
    <div className={advancedFilterFieldCardClass(className)}>
      <AdvancedFilterFieldLabel
        costLevel={costLevel}
        costTooltip={costTooltip}
        fieldState={fieldState}
        htmlFor={controlId}
        label={label}
      />
      <UiSelect
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-describedby={hintId}
        title={title}
        size="compact"
        className={cx("ui-list-control mt-2 w-full font-normal", fieldState.fieldClass, selectClassName)}
      >
        {children}
      </UiSelect>
      {hint ? (
        <p id={hintId} className="mt-1 ui-caption text-[var(--ui-text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
