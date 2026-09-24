/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "./list/ListControls";
import type { KeyboardEventHandler, ReactNode, TextareaHTMLAttributes } from "react";
import UiField from "./ui/UiField";
import { cx, uiInputClass } from "./ui/styles";

type ToolbarSearchMatchMode = "contains" | "exact";

type ToolbarSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: ReactNode;
  labelClassName?: string;
  className?: string;
  active?: boolean;
  inputClassName?: string;
  inputWrapperClassName?: string;
  leadingControl?: ReactNode;
  matchMode?: ToolbarSearchMatchMode;
  onToggleMatchMode?: () => void;
  trailingControl?: ReactNode;
  spellCheck?: boolean;
};

export default function ToolbarSearchInput({
  value,
  onChange,
  placeholder,
  label = "Search",
  labelClassName,
  className = "w-full sm:w-72",
  active = false,
  inputClassName,
  inputWrapperClassName,
  leadingControl,
  matchMode,
  onToggleMatchMode,
  trailingControl,
  spellCheck,
}: ToolbarSearchInputProps) {
  const matchModeControl =
    matchMode && onToggleMatchMode ? (
      <ListActionButton iconOnly
        type="button"
        onClick={onToggleMatchMode}
        className="ui-list-search-mode"
        title={`Filter mode: ${matchMode === "contains" ? "contains" : "exact"}`}
        aria-label="Toggle filter match mode"
      >
        {matchMode === "contains" ? "~" : "="}
      </ListActionButton>
    ) : null;
  const resolvedTrailingControl = trailingControl ?? matchModeControl;
  const renderInput = ({ id, describedBy, invalid }: { id: string; describedBy?: string; invalid: boolean }) => (
    <input
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={spellCheck}
      className={cx(
        uiInputClass,
        "ui-list-control",
        leadingControl ? "ui-list-control-with-icon" : "",
        resolvedTrailingControl ? "ui-list-search" : "",
        active ? "border-primary/50 bg-primary/5 dark:bg-primary/10" : "",
        inputClassName
      )}
    />
  );

  return (
    <UiField label={label} className={className} labelClassName={labelClassName}>
      {(fieldProps) =>
        leadingControl || resolvedTrailingControl ? (
          <div className={cx("relative", inputWrapperClassName)}>
            {leadingControl ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              >
                {leadingControl}
              </span>
            ) : null}
            {renderInput(fieldProps)}
            {resolvedTrailingControl}
          </div>
        ) : (
          renderInput(fieldProps)
        )
      }
    </UiField>
  );
}

type ToolbarSearchTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className" | "onChange" | "placeholder" | "value"
> & {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: ReactNode;
  className?: string;
  inputClassName?: string;
  inputWrapperClassName?: string;
  trailingControl?: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
};

export function ToolbarSearchTextarea({
  value,
  onChange,
  placeholder,
  label = "Search",
  className = "w-full sm:w-72",
  inputClassName,
  inputWrapperClassName,
  trailingControl,
  rows = 1,
  onKeyDown,
  ...props
}: ToolbarSearchTextareaProps) {
  return (
    <UiField label={label} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className={cx("relative", inputWrapperClassName)}>
          <textarea
            {...props}
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={rows}
            className={cx(
              uiInputClass,
              "ui-list-control w-full resize-y",
              trailingControl ? "ui-list-search" : "",
              inputClassName,
            )}
          />
          {trailingControl}
        </div>
      )}
    </UiField>
  );
}
