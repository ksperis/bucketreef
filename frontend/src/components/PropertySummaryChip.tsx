/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

import UiBadge from "./ui/UiBadge";
import type { UiTone } from "./ui/styles";

export type PropertySummaryTone = "active" | "inactive" | "unknown";

const chipTones: Record<PropertySummaryTone, UiTone> = {
  active: "success",
  inactive: "neutral",
  unknown: "warning",
};

const dotClasses: Record<PropertySummaryTone, string> = {
  active: "bg-emerald-500",
  inactive: "bg-slate-400",
  unknown: "bg-amber-500",
};

export default function PropertySummaryChip({
  label,
  state,
  tone,
  compact = false,
  title,
}: {
  label?: string;
  state: string;
  tone: PropertySummaryTone;
  compact?: boolean;
  title?: string;
}) {
  if (compact) {
    return (
      <UiBadge
        tone={chipTones[tone]}
        title={title}
        className="px-1.5 py-px ui-badge uppercase tracking-wide"
      >
        {state}
      </UiBadge>
    );
  }
  return (
    <UiBadge
      tone={chipTones[tone]}
      title={title}
      className="gap-2 px-3 py-[3px]"
    >
      <span className={`h-2 w-2 rounded-full ${dotClasses[tone]}`} />
      {!compact && label ? <span>{label}</span> : null}
      <span className="ui-caption uppercase tracking-wide">{state}</span>
    </UiBadge>
  );
}
