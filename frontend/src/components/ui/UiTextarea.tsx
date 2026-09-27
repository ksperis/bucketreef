/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { TextareaHTMLAttributes, forwardRef, ReactNode } from "react";
import UiField from "./UiField";
import { useLocalizedNativeValidation } from "./nativeValidation";
import { cx, uiInputClass } from "./styles";

type UiTextareaSize = "compact" | "md";

const uiTextareaSizeClasses: Record<UiTextareaSize, string> = {
  compact: "ui-control-compact",
  md: "px-3 py-2 ui-body",
};

type UiTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  size?: UiTextareaSize;
};

const UiTextarea = forwardRef<HTMLTextAreaElement, UiTextareaProps>(function UiTextarea(
  { label, hint, error, fieldClassName, className, id, size = "md",
    "aria-describedby": describedBy, "aria-invalid": ariaInvalid, onInput, onInvalid, ...props },
  ref
) {
  const validationHandlers = useLocalizedNativeValidation<HTMLTextAreaElement>(onInvalid, onInput);
  return (
    <UiField label={label} hint={hint} error={error} htmlFor={id} describedBy={describedBy} className={fieldClassName}>
      {({ id: resolvedId, describedBy, invalid }) => (
        <textarea
          id={resolvedId}
          ref={ref}
          aria-describedby={describedBy}
          aria-invalid={invalid || ariaInvalid}
          className={cx(uiInputClass, uiTextareaSizeClasses[size], className)}
          {...validationHandlers}
          {...props}
        />
      )}
    </UiField>
  );
});

export default UiTextarea;
