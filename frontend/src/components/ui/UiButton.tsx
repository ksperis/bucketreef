/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ButtonHTMLAttributes, ReactNode, type ComponentProps, type MouseEventHandler } from "react";
import { Link } from "react-router-dom";
import { cx, uiButtonBaseClass, uiButtonVariants } from "./styles";

export type UiButtonVariant = keyof typeof uiButtonVariants;
export type UiButtonSize = "xs" | "sm" | "md";

const uiButtonSizeClasses: Record<UiButtonSize, string> = {
  xs: "h-7 px-2 py-1 ui-caption",
  sm: "h-8 px-3 py-1.5 text-xs",
  md: "px-4 py-2 ui-body",
};

type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
};

type UiButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  disabled?: boolean;
};

export function uiButtonClassName({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  className?: string;
}) {
  return cx(uiButtonBaseClass, uiButtonVariants[variant], uiButtonSizeClasses[size], className);
}

export default function UiButton({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  leftIcon,
  rightIcon,
  loading = false,
  disabled,
  children,
  ...props
}: UiButtonProps) {
  return (
    <button
      type={type}
      className={uiButtonClassName({ variant, size, className })}
      disabled={disabled || loading}
      {...props}
    >
      {leftIcon ? <span aria-hidden="true">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span aria-hidden="true">{rightIcon}</span> : null}
    </button>
  );
}

export function UiButtonLink({
  variant = "primary",
  size = "md",
  className,
  disabled = false,
  onClick,
  tabIndex,
  ...props
}: UiButtonLinkProps) {
  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <Link
      {...props}
      className={uiButtonClassName({
        variant,
        size,
        className: cx(disabled && "pointer-events-none opacity-60", className),
      })}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : tabIndex}
      onClick={handleClick}
    />
  );
}
