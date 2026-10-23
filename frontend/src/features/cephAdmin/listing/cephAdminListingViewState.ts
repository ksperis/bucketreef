/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  readClientJsonFromKey,
  writeClientJsonToKey,
} from "../../../utils/clientStorage";
import {
  parseExactListInput,
  type TextMatchMode,
} from "../../shared/advancedFilterShared";
import { advancedFilterFieldHighlight } from "../filtering/advancedFilterModel";

export function loadCephAdminVisibleColumns<ColumnId extends string>(
  storageKey: string,
  allowedColumns: readonly ColumnId[],
  defaultVisibleColumns: readonly ColumnId[],
): ColumnId[] {
  const parsed = readClientJsonFromKey<unknown>(storageKey);
  if (!Array.isArray(parsed)) return [...defaultVisibleColumns];
  const allowed = new Set(allowedColumns);
  const cleaned = parsed.filter(
    (value): value is ColumnId =>
      typeof value === "string" && allowed.has(value as ColumnId),
  );
  return cleaned.length > 0 ? cleaned : [...defaultVisibleColumns];
}

export function persistCephAdminVisibleColumns<ColumnId extends string>(
  storageKey: string,
  visibleColumns: readonly ColumnId[],
): void {
  writeClientJsonToKey(storageKey, visibleColumns);
}

export function resolveCephAdminQuickFilterState(
  draftValue: string,
  appliedValue: string,
  mode: TextMatchMode,
) {
  const draftParsed = parseExactListInput(draftValue);
  const appliedParsed = parseExactListInput(appliedValue);
  const draftForcesExact = draftParsed.listProvided && draftParsed.values.length > 0;
  const appliedForcesExact = appliedParsed.listProvided && appliedParsed.values.length > 0;
  const modeForDisplay: TextMatchMode = draftForcesExact ? "exact" : mode;
  const effectiveMode: TextMatchMode = appliedForcesExact ? "exact" : mode;
  const effectiveSearchValue = effectiveMode === "contains" ? appliedValue : "";
  const normalizedDraft = draftValue.trim();
  const normalizedApplied = appliedValue.trim();
  const pending = normalizedDraft !== normalizedApplied;

  return {
    active: normalizedApplied.length > 0,
    appliedParsed,
    draftParsed,
    draftForcesExact,
    effectiveMode,
    effectiveSearchValue,
    fieldState: advancedFilterFieldHighlight(normalizedApplied.length > 0, pending),
    modeForDisplay,
    pending,
  };
}
