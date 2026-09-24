/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_VALUE_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
} from "./topbarControlWidths";

type TopbarStaticAccountControlProps = {
  mode: "icon" | "icon_label";
  selectedLabel: string;
  title?: string;
  icon: ReactNode;
  badge?: ReactNode;
  muted?: boolean;
};

export default function TopbarStaticAccountControl({
  mode,
  selectedLabel,
  title,
  icon,
  badge,
  muted = false,
}: TopbarStaticAccountControlProps) {
  if (mode === "icon") {
    return (
      <div
        title={title ?? selectedLabel}
        className={`shell-control inline-flex h-9 ${TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS} items-center justify-center rounded-lg border`}
      >
        <span aria-hidden="true">{icon}</span>
        <span className="sr-only">Account context {selectedLabel}</span>
      </div>
    );
  }

  return (
    <div
      title={title}
      className={`shell-control inline-flex h-10 ${TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS} items-center gap-2.5 rounded-lg border px-3 text-left ${
        muted ? "shell-muted-text" : ""
      }`}
    >
      <span className="min-w-0 flex-1 leading-tight">
        <span className="shell-muted-text block truncate text-[10px] font-medium">
          Account
        </span>
        <span className={`mt-0.5 block ${TOPBAR_CONTEXT_SELECTOR_VALUE_WIDTH_CLASS} truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]`}>
          {selectedLabel}
        </span>
      </span>
      {badge}
    </div>
  );
}
