/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ComponentProps } from "react";
import { Link, type LinkProps } from "react-router-dom";
import UiBadge from "../ui/UiBadge";
import { cx } from "../ui/styles";

type ActionPresentation = {
  variant?: "secondary" | "primary" | "danger" | "warning" | "success" | "ghost";
  iconOnly?: boolean;
};

function actionClass({ variant = "secondary", iconOnly }: ActionPresentation) {
  return cx("ui-list-action", `ui-list-action-${variant}`, iconOnly && "ui-list-action-icon");
}

export const ListActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & ActionPresentation & { loading?: boolean }
>(function ListActionButton({ variant, iconOnly, loading = false, disabled, className, type = "button", ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || props["aria-busy"]}
      className={cx(actionClass({ variant, iconOnly }), className)}
    />
  );
});

export const ListActionLink = forwardRef<HTMLAnchorElement, LinkProps & ActionPresentation>(
  function ListActionLink({ variant, iconOnly, className, onClick, tabIndex, ...props }, ref) {
    const disabled = props["aria-disabled"] === true || props["aria-disabled"] === "true";
    return (
      <Link
        {...props}
        ref={ref}
        tabIndex={disabled ? -1 : tabIndex}
        onClick={(event) => {
          if (disabled) event.preventDefault();
          else onClick?.(event);
        }}
        className={cx(actionClass({ variant, iconOnly }), className)}
      />
    );
  },
);

export function ListActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("ui-list-actions", className)} />;
}

export function ListBadge({ tone = "neutral", className, ...props }: ComponentProps<typeof UiBadge>) {
  return <UiBadge {...props} tone={tone} className={cx("ui-list-badge", className)} />;
}
