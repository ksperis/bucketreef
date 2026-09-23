/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import { cx, uiLabelClass } from "../../components/ui/styles";
import {
  renderFilterCostIndicator,
  type AdvancedFilterFieldState,
  type FilterCostLevel,
} from "./advancedFilterShared";

type AdvancedFilterFieldLabelProps = {
  className?: string;
  costLevel?: FilterCostLevel;
  costTooltip?: string;
  fieldState: AdvancedFilterFieldState;
  htmlFor: string;
  label: ReactNode;
};

export default function AdvancedFilterFieldLabel({
  className,
  costLevel,
  costTooltip,
  fieldState,
  htmlFor,
  label,
}: AdvancedFilterFieldLabelProps) {
  return (
    <label htmlFor={htmlFor} className={cx(uiLabelClass, fieldState.labelClass, className)}>
      <span className="inline-flex items-center gap-1">
        <span>{label}</span>
        {costLevel && costTooltip ? (
          <span aria-hidden="true">{renderFilterCostIndicator(costLevel, costTooltip)}</span>
        ) : null}
      </span>
    </label>
  );
}
