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
  resolveQuickTextFilterState,
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
  const state = resolveQuickTextFilterState({
    draftValue,
    appliedValue,
    mode,
  });

  return {
    ...state,
    fieldState: advancedFilterFieldHighlight(state.active, state.pending),
  };
}

export function resolveCephAdminTextFilterFieldState({
  draftValue,
  draftMode,
  appliedValue = "",
  appliedMode = "contains",
}: {
  draftValue: string;
  draftMode: TextMatchMode;
  appliedValue?: string | null;
  appliedMode?: TextMatchMode | null;
}) {
  const normalizedDraft = draftValue.trim();
  const normalizedApplied = (appliedValue ?? "").trim();
  const draftParsed = parseExactListInput(draftValue);
  const appliedParsed = parseExactListInput(appliedValue ?? "");
  const draftForcesExact = draftParsed.listProvided && draftParsed.values.length > 0;
  const appliedForcesExact =
    appliedParsed.listProvided && appliedParsed.values.length > 0;
  const resolvedDraftMode: TextMatchMode = draftForcesExact ? "exact" : draftMode;
  const resolvedAppliedMode: TextMatchMode = appliedForcesExact
    ? "exact"
    : (appliedMode ?? "contains");
  const pending =
    normalizedDraft !== normalizedApplied ||
    (normalizedDraft.length > 0 && resolvedDraftMode !== resolvedAppliedMode);

  return {
    appliedValue: normalizedApplied,
    draftValue: normalizedDraft,
    draftForcesExact,
    appliedMode: resolvedAppliedMode,
    draftMode: resolvedDraftMode,
    pending,
    fieldState: advancedFilterFieldHighlight(Boolean(normalizedApplied), pending),
  };
}
