/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";

import { cx } from "../../components/ui/styles";
import AdvancedFilterFieldLabel from "./AdvancedFilterFieldLabel";
import {
  advancedFilterControlClass,
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
  label,
  onChange,
  selectClassName,
  title,
  value,
}: AdvancedFilterSelectFieldProps) {
  const controlId = useId();

  return (
    <div className={advancedFilterFieldCardClass(className)}>
      <AdvancedFilterFieldLabel
        costLevel={costLevel}
        costTooltip={costTooltip}
        fieldState={fieldState}
        htmlFor={controlId}
        label={label}
      />
      <select
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        title={title}
        className={advancedFilterControlClass(
          cx("mt-2 w-full px-2 py-1.5 font-normal", fieldState.fieldClass, selectClassName),
          disabled,
        )}
      >
        {children}
      </select>
    </div>
  );
}
