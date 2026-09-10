/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { cx } from "./styles";

type UiProgressBarProps = {
  value: number | null;
  label?: string;
  showLabel?: boolean;
  className?: string;
  barClassName?: string;
};

export default function UiProgressBar({
  value,
  label = "Progress",
  showLabel = false,
  className,
  barClassName = "bg-primary",
}: UiProgressBarProps) {
  const width = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <>
      {showLabel ? <span className="sr-only">{label}</span> : null}
      <div
        className={cx("h-1.5 rounded-full bg-slate-100 dark:bg-slate-800", className)}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width === null ? undefined : Math.round(width)}
      >
        <div
          className={cx("h-full rounded-full", width === null && "animate-pulse motion-reduce:animate-none", barClassName)}
          style={{ width: `${width ?? 100}%` }}
        />
      </div>
    </>
  );
}
