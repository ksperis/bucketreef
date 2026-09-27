/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SelectHTMLAttributes, forwardRef, ReactNode } from "react";
import UiField from "./UiField";
import { useLocalizedNativeValidation } from "./nativeValidation";
import { cx, uiInputClass } from "./styles";

type UiSelectSize = "compact" | "md";

const uiSelectSizeClasses: Record<UiSelectSize, string> = {
  compact: "ui-control-compact",
  md: "px-3 py-2 ui-body",
};

type UiSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  labelClassName?: string;
  size?: UiSelectSize;
};

const UiSelect = forwardRef<HTMLSelectElement, UiSelectProps>(function UiSelect(
  { label, hint, error, fieldClassName, labelClassName, className, id, size = "md", children,
    "aria-describedby": describedBy, "aria-invalid": ariaInvalid, onInput, onInvalid, ...props },
  ref
) {
  const validationHandlers = useLocalizedNativeValidation<HTMLSelectElement>(onInvalid, onInput);
  return (
    <UiField label={label} hint={hint} error={error} htmlFor={id} describedBy={describedBy} className={fieldClassName} labelClassName={labelClassName}>
      {({ id: resolvedId, describedBy, invalid }) => (
        <select
          id={resolvedId}
          ref={ref}
          aria-describedby={describedBy}
          aria-invalid={invalid || ariaInvalid}
          className={cx(uiInputClass, uiSelectSizeClasses[size], className)}
          {...validationHandlers}
          {...props}
        >
          {children}
        </select>
      )}
    </UiField>
  );
});

export default UiSelect;
