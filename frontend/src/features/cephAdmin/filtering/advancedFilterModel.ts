/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatNumber } from "../../../utils/format";

const ACTIVE_FIELD_CLASS =
  "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200/70 dark:border-emerald-400/70 dark:bg-emerald-500/15 dark:ring-emerald-500/25";
const ACTIVE_LABEL_CLASS = "text-emerald-700 dark:text-emerald-200";
const PENDING_FIELD_CLASS =
  "border-amber-400 bg-amber-50 ring-2 ring-amber-300/70 dark:border-amber-400/70 dark:bg-amber-500/20 dark:ring-amber-500/25";
const PENDING_LABEL_CLASS = "text-amber-700 dark:text-amber-300";

export const advancedFilterFieldHighlight = (isApplied: boolean, isPending: boolean) => {
  if (isPending) return { labelClass: PENDING_LABEL_CLASS, fieldClass: PENDING_FIELD_CLASS };
  if (isApplied) return { labelClass: ACTIVE_LABEL_CLASS, fieldClass: ACTIVE_FIELD_CLASS };
  return { labelClass: "", fieldClass: "" };
};

export type NumericFilterRangeField<Key extends string> = {
  label: string;
  minKey: Key;
  maxKey: Key;
};

type NumericFilterSummaryField<Key extends string> = {
  format?: "number" | "percent";
  key: Key;
  label: string;
};

type NumericFilterSummaryItem<Key extends string> = {
  field: Key;
  id: string;
  label: string;
};

export const buildNumericFilterFields = <Key extends string>(
  ranges: readonly NumericFilterRangeField<Key>[],
  format: "number" | "percent" = "number",
): NumericFilterSummaryField<Key>[] =>
  ranges.flatMap(({ label, minKey, maxKey }) => [
    { key: minKey, label: `${label} >=`, format },
    { key: maxKey, label: `${label} <=`, format },
  ]);

export const buildNumericFilterFieldStates = <Key extends string>(
  draft: object,
  applied: object | null,
  fields: readonly Pick<NumericFilterSummaryField<Key>, "key">[],
): Record<Key, ReturnType<typeof advancedFilterFieldHighlight>> => {
  const draftValues = draft as Partial<Record<Key, unknown>>;
  const appliedValues = (applied ?? {}) as Partial<Record<Key, unknown>>;
  const states = {} as Record<Key, ReturnType<typeof advancedFilterFieldHighlight>>;

  fields.forEach(({ key }) => {
    const draftValue = typeof draftValues[key] === "string" ? draftValues[key].trim() : "";
    const appliedValue = typeof appliedValues[key] === "string" ? appliedValues[key].trim() : "";
    states[key] = advancedFilterFieldHighlight(
      Boolean(appliedValue),
      draftValue !== appliedValue,
    );
  });
  return states;
};

export const numericFilterRangeFieldHighlight = <Key extends string>(
  draft: object,
  applied: object | null,
  minKey: Key,
  maxKey: Key,
) => {
  const draftValues = draft as Partial<Record<Key, unknown>>;
  const appliedValues = (applied ?? {}) as Partial<Record<Key, unknown>>;
  const readValue = (values: Partial<Record<Key, unknown>>, key: Key) =>
    typeof values[key] === "string" ? values[key].trim() : "";
  const minDraft = readValue(draftValues, minKey);
  const maxDraft = readValue(draftValues, maxKey);
  const minApplied = readValue(appliedValues, minKey);
  const maxApplied = readValue(appliedValues, maxKey);

  return advancedFilterFieldHighlight(
    Boolean(minApplied || maxApplied),
    minDraft !== minApplied || maxDraft !== maxApplied,
  );
};

export const buildNumericFilterSummaryItems = <Key extends string>(
  values: object,
  fields: readonly NumericFilterSummaryField<Key>[],
  idPrefix = "num-",
): NumericFilterSummaryItem<Key>[] =>
  fields.flatMap(({ format = "number", key, label }) => {
    const value = (values as Partial<Record<Key, unknown>>)[key];
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return [];
    const numeric = Number(raw);
    const display = Number.isFinite(numeric)
      ? format === "percent"
        ? `${numeric}%`
        : formatNumber(numeric)
      : raw;
    return [{ field: key, id: `${idPrefix}${key}`, label: `${label} ${display}` }];
  });

export const appendNumericFilterRule = (
  rules: Array<Record<string, unknown>>,
  field: string,
  operator: "gte" | "lte",
  rawValue: string
) => {
  const normalizedValue = rawValue.trim();
  if (!normalizedValue) return;
  const value = Number(normalizedValue);
  if (!Number.isFinite(value)) return;
  rules.push({ field, op: operator, value });
};
