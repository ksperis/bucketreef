/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { InputHTMLAttributes, forwardRef, ReactNode } from "react";
import UiField from "./UiField";
import { useLocalizedNativeValidation } from "./nativeValidation";
import { cx, uiInputClass } from "./styles";

type UiInputSize = "compact" | "md";

const uiInputSizeClasses: Record<UiInputSize, string> = {
  compact: "ui-control-compact",
  md: "px-3 py-2 ui-body",
};

type UiInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  labelClassName?: string;
  size?: UiInputSize;
};

const UiInput = forwardRef<HTMLInputElement, UiInputProps>(function UiInput(
  { label, hint, error, fieldClassName, labelClassName, className, id, size = "md",
    "aria-describedby": describedBy, "aria-invalid": ariaInvalid, onInput, onInvalid, ...props },
  ref
) {
  const validationHandlers = useLocalizedNativeValidation<HTMLInputElement>(onInvalid, onInput);
  return (
    <UiField label={label} hint={hint} error={error} htmlFor={id} describedBy={describedBy} className={fieldClassName} labelClassName={labelClassName}>
      {({ id: resolvedId, describedBy, invalid }) => (
        <input
          id={resolvedId}
          ref={ref}
          aria-describedby={describedBy}
          aria-invalid={invalid || ariaInvalid}
          className={cx(uiInputClass, uiInputSizeClasses[size], className)}
          {...validationHandlers}
          {...props}
        />
      )}
    </UiField>
  );
});

export default UiInput;
