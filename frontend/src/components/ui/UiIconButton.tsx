/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import { cx, uiIconButtonClass, uiIconButtonVariants } from "./styles";

type UiIconButtonSize = "compact" | "md";
type UiIconButtonVariant = keyof typeof uiIconButtonVariants;

const uiIconButtonSizeClasses: Record<UiIconButtonSize, string> = {
  compact: "h-6 w-6 text-sm",
  md: "h-8 w-8",
};

type UiIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  label: string;
  icon: ReactNode;
  size?: UiIconButtonSize;
  variant?: UiIconButtonVariant;
};

const UiIconButton = forwardRef<HTMLButtonElement, UiIconButtonProps>(function UiIconButton({
  label,
  icon,
  size = "md",
  variant = "neutral",
  className,
  type = "button",
  title,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx(
        uiIconButtonClass,
        uiIconButtonSizeClasses[size],
        uiIconButtonVariants[variant],
        className
      )}
      {...props}
    >
      {icon}
    </button>
  );
});

export default UiIconButton;
