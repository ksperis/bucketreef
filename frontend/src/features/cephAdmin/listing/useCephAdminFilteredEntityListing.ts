/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";

import type { TextMatchMode } from "../../shared/advancedFilterShared";
import {
  useCephAdminListingFilters,
  type CephAdminListingStringState,
} from "../filtering/useCephAdminListingFilters";
import {
  useCephAdminEntityListing,
  type CephAdminListEntities,
  type CephAdminListingSortDirection,
  type CephAdminStreamEntities,
} from "./useCephAdminEntityListing";

type UseCephAdminFilteredEntityListingOptions<
  Entity,
  FilterState extends CephAdminListingStringState<FilterState>,
> = {
  endpointId: number | null;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  pageSize: number;
  sortBy: string;
  sortDirection: CephAdminListingSortDirection;
  includes: string[];
  reloadNonce: number;
  defaultAdvancedFilter: FilterState;
  buildAdvancedFilter: (
    state: FilterState | null,
    quickSearch: string,
    quickMatchMode: TextMatchMode,
  ) => string | undefined;
  listEntities: CephAdminListEntities<Entity>;
  streamEntities: CephAdminStreamEntities<Entity>;
  entityKey: (entity: Entity) => string;
};

export function useCephAdminFilteredEntityListing<
  Entity,
  FilterState extends CephAdminListingStringState<FilterState>,
>({
  endpointId,
  page,
  setPage,
  pageSize,
  sortBy,
  sortDirection,
  includes,
  reloadNonce,
  defaultAdvancedFilter,
  buildAdvancedFilter,
  listEntities,
  streamEntities,
  entityKey,
}: UseCephAdminFilteredEntityListingOptions<Entity, FilterState>) {
  const filters = useCephAdminListingFilters<FilterState>({
    endpointId,
    defaultAdvancedFilter,
    serializeAdvancedFilter: (state) => buildAdvancedFilter(state, "", "contains"),
    setPage,
  });
  const quickFilter = filters.quickFilterState;
  const advancedFilter = buildAdvancedFilter(
    filters.advancedApplied,
    filters.searchValue,
    quickFilter.effectiveMode,
  );
  const listing = useCephAdminEntityListing<Entity>({
    endpointId,
    page,
    pageSize,
    search: quickFilter.effectiveSearchValue,
    advancedFilter,
    sortBy,
    sortDirection,
    includes,
    reloadNonce,
    listEntities,
    streamEntities,
    entityKey,
  });

  return {
    ...filters,
    ...listing,
    quickFilterActive: quickFilter.active,
    quickFilterAppliedParsed: quickFilter.appliedParsed,
    quickFilterDraftForcesExact: quickFilter.draftForcesExact,
    effectiveQuickFilterMode: quickFilter.effectiveMode,
    quickFilterFieldState: quickFilter.fieldState,
    quickFilterModeForDisplay: quickFilter.modeForDisplay,
    quickFilterPending: quickFilter.pending,
  };
}
