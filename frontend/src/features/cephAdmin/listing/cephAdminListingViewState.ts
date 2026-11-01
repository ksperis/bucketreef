/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  readClientJsonFromKey,
  writeClientJsonToKey,
} from "../../../utils/clientStorage";
import {
  advancedFilterFieldHighlight,
  resolveQuickTextFilterState,
  type TextMatchMode,
} from "../../shared/advancedFilterShared";

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
