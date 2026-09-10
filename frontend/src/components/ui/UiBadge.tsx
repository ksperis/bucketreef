/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type HTMLAttributes, ReactNode } from "react";
import { cx, UiTone, uiBadgeShapeClass, uiToneBadgeClasses } from "./styles";

type UiBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: UiTone;
  className?: string;
  children: ReactNode;
  title?: string;
  disableToneStyles?: boolean;
};

export default function UiBadge({
  tone = "neutral",
  className,
  children,
  title,
  disableToneStyles = false,
  ...props
}: UiBadgeProps) {
  return (
    <span
      {...props}
      title={title}
      className={cx(
        "ui-badge-base inline-flex items-center px-2 py-0.5 ui-caption font-medium",
        uiBadgeShapeClass,
        !disableToneStyles && uiToneBadgeClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
