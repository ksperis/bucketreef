/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { useUnsavedChangesGuard } from "../../../components/useUnsavedChangesGuard";
import type { TextMatchMode } from "../../shared/advancedFilterShared";
import { resolveCephAdminQuickFilterState } from "../listing/cephAdminListingViewState";

type StringState<State> = {
  [Field in keyof State]: string;
};

type CephAdminFilterRemoveAction<Field extends PropertyKey> =
  | { type: "quick" }
  | { type: "advanced"; field: Field };

type UseCephAdminListingFiltersOptions<State> = {
  endpointId: number | null;
  defaultAdvancedFilter: State;
  serializeAdvancedFilter: (state: State | null) => string | undefined;
  setPage: Dispatch<SetStateAction<number>>;
};

export function useCephAdminListingFilters<State extends StringState<State>>({
  endpointId,
  defaultAdvancedFilter,
  serializeAdvancedFilter,
  setPage,
}: UseCephAdminListingFiltersOptions<State>) {
  const [filter, setFilter] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<State>(defaultAdvancedFilter);
  const [advancedApplied, setAdvancedApplied] = useState<State | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchValue(filter.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [filter, setPage]);

  useEffect(() => {
    setPage(1);
    setFilter("");
    setSearchValue("");
    setQuickFilterMode("contains");
    setShowAdvancedFilter(false);
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
  }, [defaultAdvancedFilter, endpointId, setPage]);

  const quickFilterState = resolveCephAdminQuickFilterState(filter, searchValue, quickFilterMode);
  const advancedAppliedPayload = serializeAdvancedFilter(advancedApplied);
  const advancedDraftPayload = serializeAdvancedFilter(advancedDraft);
  const hasPendingAdvancedChanges = advancedDraftPayload !== advancedAppliedPayload;
  const hasAnyAdvancedToClear = advancedDraftPayload !== undefined || advancedAppliedPayload !== undefined;

  const toggleQuickFilterMode = useCallback(() => {
    if (quickFilterState.draftForcesExact) return;
    setQuickFilterMode((current) => (current === "contains" ? "exact" : "contains"));
    setPage(1);
  }, [quickFilterState.draftForcesExact, setPage]);

  const closeAdvancedFilterDrawer = useCallback(() => {
    setAdvancedDraft(advancedApplied ?? defaultAdvancedFilter);
    setShowAdvancedFilter(false);
  }, [advancedApplied, defaultAdvancedFilter]);
  const advancedFilterCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedFilter && hasPendingAdvancedChanges,
    onClose: closeAdvancedFilterDrawer,
    zIndexClass: "z-[70]",
  });

  const updateAdvancedField = useCallback(<Field extends keyof State>(field: Field, value: State[Field]) => {
    setAdvancedDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const applyAdvancedFilter = useCallback(() => {
    setAdvancedApplied(advancedDraft);
    setShowAdvancedFilter(false);
    setPage(1);
  }, [advancedDraft, setPage]);

  const resetAdvancedFilter = useCallback(() => {
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setPage(1);
  }, [defaultAdvancedFilter, setPage]);

  const resetAllFilters = useCallback(() => {
    setFilter("");
    setSearchValue("");
    setQuickFilterMode("contains");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setShowAdvancedFilter(false);
    setPage(1);
  }, [defaultAdvancedFilter, setPage]);

  const clearAdvancedField = useCallback(
    (field: keyof State) => {
      const defaultValue = defaultAdvancedFilter[field];
      setAdvancedDraft((current) => ({ ...current, [field]: defaultValue }));
      setAdvancedApplied((current) => (current ? { ...current, [field]: defaultValue } : current));
      setPage(1);
    },
    [defaultAdvancedFilter, setPage]
  );

  const removeActiveFilterItem = useCallback(
    (action: CephAdminFilterRemoveAction<keyof State>) => {
      if (action.type === "quick") {
        setFilter("");
        setSearchValue("");
        setPage(1);
        return;
      }
      clearAdvancedField(action.field);
    },
    [clearAdvancedField, setPage]
  );

  return {
    filter,
    setFilter,
    searchValue,
    quickFilterState,
    toggleQuickFilterMode,
    showAdvancedFilter,
    setShowAdvancedFilter,
    advancedDraft,
    advancedApplied,
    hasPendingAdvancedChanges,
    hasAnyAdvancedToClear,
    advancedFilterCloseGuard,
    updateAdvancedField,
    applyAdvancedFilter,
    resetAdvancedFilter,
    resetAllFilters,
    removeActiveFilterItem,
  };
}
