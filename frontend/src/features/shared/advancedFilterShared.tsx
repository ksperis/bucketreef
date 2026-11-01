/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { interpolateText } from "../../i18n";
import { clampPercentage } from "../../utils/numbers";
import type { TextMatchMode } from "../../utils/textMatch";
import type { SharedText } from "./sharedI18n";

const identityText: SharedText = interpolateText;

export type { TextMatchMode } from "../../utils/textMatch";
export type FilterCostLevel = "none" | "low" | "medium" | "high";
export type AdvancedFilterFieldState = {
  fieldClass: string;
  labelClass: string;
};
const ACTIVE_ADVANCED_FILTER_FIELD_CLASS =
  "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200/70 dark:border-emerald-400/70 dark:bg-emerald-500/15 dark:ring-emerald-500/25";
const ACTIVE_ADVANCED_FILTER_LABEL_CLASS =
  "text-emerald-700 dark:text-emerald-200";
const PENDING_ADVANCED_FILTER_FIELD_CLASS =
  "border-amber-400 bg-amber-50 ring-2 ring-amber-300/70 dark:border-amber-400/70 dark:bg-amber-500/20 dark:ring-amber-500/25";
const PENDING_ADVANCED_FILTER_LABEL_CLASS =
  "text-amber-700 dark:text-amber-300";

export const advancedFilterFieldHighlight = (
  isApplied: boolean,
  isPending: boolean,
): AdvancedFilterFieldState => {
  if (isPending) {
    return {
      labelClass: PENDING_ADVANCED_FILTER_LABEL_CLASS,
      fieldClass: PENDING_ADVANCED_FILTER_FIELD_CLASS,
    };
  }
  if (isApplied) {
    return {
      labelClass: ACTIVE_ADVANCED_FILTER_LABEL_CLASS,
      fieldClass: ACTIVE_ADVANCED_FILTER_FIELD_CLASS,
    };
  }
  return { labelClass: "", fieldClass: "" };
};
export type AdvancedSearchProgress = {
  active: boolean;
  determinate: boolean;
  percent: number;
  stage: string;
  message: string;
  processed: number;
  total: number;
};

type AdvancedSearchProgressEvent = {
  percent?: number;
  stage?: string;
  message?: string;
  processed?: number;
  total?: number;
};

export const INACTIVE_ADVANCED_PROGRESS: AdvancedSearchProgress = {
  active: false,
  determinate: true,
  percent: 0,
  stage: "",
  message: "",
  processed: 0,
  total: 0,
};

export const PREPARING_ADVANCED_PROGRESS: AdvancedSearchProgress = {
  active: true,
  determinate: true,
  percent: 0,
  stage: "prepare",
  message: "Preparing advanced search...",
  processed: 0,
  total: 0,
};

export const FALLBACK_ADVANCED_PROGRESS: AdvancedSearchProgress = {
  active: true,
  determinate: false,
  percent: 0,
  stage: "fallback",
  message: "Advanced search in progress...",
  processed: 0,
  total: 0,
};

const advancedFilterSummaryClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-3 text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]";

export const advancedFilterSectionClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-3 text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]";

export const advancedFilterAccordionClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]";

export const advancedFilterFieldCardClass = (className: string = "") =>
  `rounded-lg border border-[color:var(--ui-border-soft)] p-3${className ? ` ${className}` : ""}`;

const advancedFilterControlBaseClass =
  "ui-control ui-control-compact ui-list-control";

export const advancedFilterControlClass = (className: string = "", disabled: boolean = false) => {
  const disabledClass = disabled ? " disabled:cursor-not-allowed" : "";
  return `${advancedFilterControlBaseClass}${disabledClass}${className ? ` ${className}` : ""}`;
};

export const advancedFilterSummaryChipClass =
  "ui-list-badge border border-primary/30 bg-primary/10 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/15 dark:text-primary-100";

type AdvancedFilterSummaryItem = {
  id: string;
  label: ReactNode;
};

export const renderAdvancedFilterDraftSummary = (
  items: AdvancedFilterSummaryItem[],
  text: SharedText = identityText,
) => (
  <section className={advancedFilterSummaryClass}>
    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {text("Draft summary")}
    </p>
    {items.length === 0 ? (
      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
        {text("No advanced rule in draft.")}
      </p>
    ) : (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item.id} className={advancedFilterSummaryChipClass}>
            {item.label}
          </span>
        ))}
      </div>
    )}
  </section>
);

const advancedFilterHeaderBadgeClass =
  "ui-list-badge border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

export const advancedFilterSyncBadgeClass = (pending: boolean) => {
  if (pending) {
    return "ui-list-badge border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-200";
  }
  return "ui-list-badge border border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/20 dark:text-emerald-200";
};

export const renderAdvancedFilterRuleCountBadge = (
  count: number,
  text: SharedText = identityText,
) => (
  <span className={advancedFilterHeaderBadgeClass}>
    {text(count === 1 ? "{count} rule" : "{count} rules", { count })}
  </span>
);

export const renderAdvancedFilterCostBadge = (
  level: FilterCostLevel,
  tooltip: string,
  text: SharedText = identityText,
) => (
  <span className={`${advancedFilterHeaderBadgeClass} inline-flex items-center gap-1`} title={tooltip}>
    {text("Global draft cost")}
    {renderFilterCostIndicator(level, tooltip)}
  </span>
);

export const formatAdvancedFilterSyncLabel = (
  pending: boolean,
  text: SharedText = identityText,
) => text(pending ? "Unsaved changes" : "In sync");

export const FILTER_COST_LABEL: Record<FilterCostLevel, string> = {
  none: "No additional cost",
  low: "Low cost",
  medium: "Medium cost",
  high: "High cost",
};

const FILTER_COST_ENABLED_DOTS: Record<FilterCostLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const FILTER_COST_DOT_CLASS: Record<Exclude<FilterCostLevel, "none">, string> = {
  low: "bg-emerald-500 dark:bg-emerald-300",
  medium: "bg-amber-500 dark:bg-amber-300",
  high: "bg-rose-500 dark:bg-rose-300",
};

export const renderFilterCostIndicator = (level: FilterCostLevel, tooltip: string) => {
  const enabledDots = FILTER_COST_ENABLED_DOTS[level];
  const activeClass = level === "none" ? "" : FILTER_COST_DOT_CLASS[level];
  return (
    <span className="inline-flex items-center gap-1" title={tooltip} aria-label={tooltip}>
      {[0, 1, 2].map((idx) => (
        <span
          key={`${level}-${idx}`}
          className={`h-1.5 w-1.5 rounded-full ${idx < enabledDots ? activeClass : "bg-slate-300 dark:bg-slate-600"}`}
        />
      ))}
    </span>
  );
};

const formatAdvancedSearchStage = (stage: string) => {
  if (!stage.trim()) return "";
  return stage
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const progressFromAdvancedSearchEvent = (event: AdvancedSearchProgressEvent): AdvancedSearchProgress => {
  const rawPercent = Number(event.percent);
  const percent = Number.isFinite(rawPercent) ? clampPercentage(Math.round(rawPercent)) : 0;
  const rawProcessed = Number(event.processed);
  const rawTotal = Number(event.total);
  const total = Number.isFinite(rawTotal) ? Math.max(0, Math.round(rawTotal)) : 0;
  const processed = Number.isFinite(rawProcessed) ? Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, Math.round(rawProcessed))) : 0;
  return {
    active: true,
    determinate: true,
    percent,
    stage: event.stage || "",
    message: event.message || "Running advanced search...",
    processed,
    total,
  };
};

export const renderAdvancedSearchProgress = (
  progress: AdvancedSearchProgress,
  text: SharedText = identityText,
) => {
  if (!progress.active) return null;
  const percent = clampPercentage(Math.round(progress.percent));
  const progressDetails = progress.total > 0 ? ` · ${progress.processed} / ${progress.total}` : "";
  return (
    <div className="mb-3 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
          {progress.determinate
            ? text("Advanced search in progress · {percent}%", { percent })
            : text("Advanced search in progress...")}
        </p>
        {(progress.message || progress.stage) && (
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {text(progress.message || formatAdvancedSearchStage(progress.stage))}
            {progressDetails}
          </p>
        )}
      </div>
      <UiProgressBar
        value={progress.determinate ? percent : 100}
        label={text("Advanced search progress")}
        className="mt-2 h-2 bg-slate-200 dark:bg-slate-800"
        barClassName={progress.determinate ? "bg-primary transition-[width] duration-150 ease-out" : "animate-pulse bg-primary/70"}
      />
    </div>
  );
};

type ParsedExactListInput = {
  values: string[];
  listProvided: boolean;
};

export const parseExactListInput = (value: string): ParsedExactListInput => {
  const raw = value.trim();
  if (!raw) return { values: [], listProvided: false };
  const listProvided = /[\n,]/.test(value);
  if (!listProvided) {
    return { values: [raw], listProvided: false };
  }
  const seen = new Set<string>();
  const values: string[] = [];
  value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      values.push(item);
    });
  return { values, listProvided: true };
};

export const resolveTextFilterInputState = (
  value: string,
  mode: TextMatchMode,
) => {
  const parsed = parseExactListInput(value);
  const forcesExact = parsed.listProvided && parsed.values.length > 0;

  return {
    value: value.trim(),
    parsed,
    forcesExact,
    effectiveMode: forcesExact ? ("exact" as const) : mode,
  };
};

export const resolveQuickTextFilterState = ({
  draftValue,
  appliedValue,
  mode,
}: {
  draftValue: string;
  appliedValue: string;
  mode: TextMatchMode;
}) => {
  const draft = resolveTextFilterInputState(draftValue, mode);
  const applied = resolveTextFilterInputState(appliedValue, mode);
  const effectiveSearchValue =
    applied.effectiveMode === "contains" ? appliedValue : "";

  return {
    active: applied.value.length > 0,
    appliedParsed: applied.parsed,
    draftParsed: draft.parsed,
    draftForcesExact: draft.forcesExact,
    effectiveMode: applied.effectiveMode,
    effectiveSearchValue,
    modeForDisplay: draft.effectiveMode,
    pending: draft.value !== applied.value,
  };
};

export const resolveTextFilterFieldState = ({
  draftValue,
  draftMode,
  appliedValue = "",
  appliedMode = "contains",
}: {
  draftValue: string;
  draftMode: TextMatchMode;
  appliedValue?: string | null;
  appliedMode?: TextMatchMode | null;
}) => {
  const draft = resolveTextFilterInputState(draftValue, draftMode);
  const applied = resolveTextFilterInputState(
    appliedValue ?? "",
    appliedMode ?? "contains",
  );
  const pending =
    draft.value !== applied.value ||
    (draft.value.length > 0 && draft.effectiveMode !== applied.effectiveMode);

  return {
    appliedValue: applied.value,
    draftValue: draft.value,
    draftForcesExact: draft.forcesExact,
    appliedMode: applied.effectiveMode,
    draftMode: draft.effectiveMode,
    pending,
    fieldState: advancedFilterFieldHighlight(
      Boolean(applied.value),
      pending,
    ),
  };
};

export const buildTextFieldRules = (field: string, rawValue: string, mode: TextMatchMode): Array<Record<string, unknown>> => {
  const { parsed, effectiveMode } = resolveTextFilterInputState(rawValue, mode);
  if (parsed.values.length === 0) return [];
  if (parsed.listProvided) {
    if (parsed.values.length === 1) {
      return [{ field, op: "eq", value: parsed.values[0] }];
    }
    return [{ field, op: "in", value: parsed.values }];
  }
  return [{ field, op: effectiveMode === "exact" ? "eq" : "contains", value: parsed.values[0] }];
};

export const serializeAdvancedFilterRules = (rules: Array<Record<string, unknown>>): string =>
  JSON.stringify({ match: "all", rules });

export const formatTextMatchModeLabel = (mode: TextMatchMode) => (mode === "exact" ? "exact" : "contains");

const formatListPreview = (values: string[], limit: number = 2) => {
  if (values.length === 0) return "";
  if (values.length <= limit) return values.join(", ");
  return `${values.slice(0, limit).join(", ")} +${values.length - limit}`;
};

export const formatTextFilterSummary = (label: string, rawValue: string, mode: TextMatchMode) => {
  const { parsed, effectiveMode } = resolveTextFilterInputState(rawValue, mode);
  if (parsed.values.length === 0) return null;
  if (parsed.listProvided) {
    return `${label} exact list: ${formatListPreview(parsed.values, 2)}`;
  }
  return `${label} ${formatTextMatchModeLabel(effectiveMode)}: ${parsed.values[0]}`;
};
