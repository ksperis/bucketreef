/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
} from "react";
import { Link, type LinkProps } from "react-router-dom";
import UiBadge from "../ui/UiBadge";
import { cx, uiCheckboxClass } from "../ui/styles";

type ActionPresentation = {
  variant?: "secondary" | "primary" | "danger" | "warning" | "success" | "ghost";
  iconOnly?: boolean;
  active?: boolean;
};

function actionClass({ variant = "secondary", iconOnly, active }: ActionPresentation) {
  return cx(
    "ui-list-action",
    `ui-list-action-${variant}`,
    iconOnly && "ui-list-action-icon",
    active && "ui-list-action-active",
  );
}

export const ListActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & ActionPresentation & { loading?: boolean; touchTarget?: boolean }
>(function ListActionButton({ variant, iconOnly, active, loading = false, touchTarget = false, disabled, className, type = "button", ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || props["aria-busy"]}
      className={cx(actionClass({ variant, iconOnly, active }), touchTarget && "ui-list-action-touch", className)}
    />
  );
});

export const ListActionLink = forwardRef<HTMLAnchorElement, LinkProps & ActionPresentation>(
  function ListActionLink({ variant, iconOnly, active, className, onClick, tabIndex, ...props }, ref) {
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
        className={cx(actionClass({ variant, iconOnly, active }), className)}
      />
    );
  },
);

/** Native navigation, including opening another workspace in a separate tab. */
export const ListActionAnchor = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & ActionPresentation>(
  function ListActionAnchor({ variant, iconOnly, active, className, ...props }, ref) {
    return <a {...props} ref={ref} className={cx(actionClass({ variant, iconOnly, active }), className)} />;
  },
);

export function ListActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("ui-list-actions", className)} />;
}

type ListSelectionCheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  labelClassName?: string;
  labelProps?: Omit<LabelHTMLAttributes<HTMLLabelElement>, "children" | "className">;
  touchTarget?: boolean;
};

export const ListSelectionCheckbox = forwardRef<HTMLInputElement, ListSelectionCheckboxProps>(
  function ListSelectionCheckbox(
    { className, labelClassName, labelProps, touchTarget = false, ...props },
    ref,
  ) {
    return (
      <label
        {...labelProps}
        className={cx("ui-list-selection", touchTarget && "ui-list-selection-touch", labelClassName)}
      >
        <input
          {...props}
          ref={ref}
          type="checkbox"
          className={cx(uiCheckboxClass, className)}
        />
      </label>
    );
  },
);

export function ListBadge({ tone = "neutral", className, ...props }: ComponentProps<typeof UiBadge>) {
  return <UiBadge {...props} tone={tone} className={cx("ui-list-badge", className)} />;
}
