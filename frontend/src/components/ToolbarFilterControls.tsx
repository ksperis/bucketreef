/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ListActionButton } from "./list/ListControls";
import { cx } from "./ui/styles";

type ToolbarMatchMode = "contains" | "exact";

type ToolbarMatchModeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  mode: ToolbarMatchMode;
  pending?: boolean;
  locked?: boolean;
};

export function ToolbarMatchModeButton({
  mode,
  pending = false,
  locked = false,
  "aria-label": ariaLabel = "Toggle filter match mode",
  className,
  disabled,
  title,
  ...props
}: ToolbarMatchModeButtonProps) {
  const resolvedTitle =
    title ??
    (locked
      ? "Quick filter mode: exact (locked by list input)"
      : `Quick filter mode: ${mode === "contains" ? "contains" : "exact"}`);

  return (
    <ListActionButton
      {...props}
      iconOnly
      active={locked || (!pending && mode === "exact")}
      disabled={disabled || locked}
      className={cx(
        "ui-list-search-mode",
        locked
          ? "cursor-not-allowed"
          : pending
            ? "ui-list-action-warning"
            : "",
        className,
      )}
      title={resolvedTitle}
      aria-label={ariaLabel}
    >
      {mode === "contains" ? "~" : "="}
    </ListActionButton>
  );
}

type ToolbarAdvancedFilterButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  active?: boolean;
  children?: ReactNode;
};

export function ToolbarAdvancedFilterButton({
  active = false,
  className,
  children = "Advanced filter",
  ...props
}: ToolbarAdvancedFilterButtonProps) {
  return (
    <ListActionButton
      {...props}
      variant="secondary"
      active={active}
      className={className}
    >
      {children}
    </ListActionButton>
  );
}
