/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

import { nextSortState } from "../../utils/sortValues";
import useAdminPaginationState from "./useAdminPaginationState";

type SortDirection = "asc" | "desc";
type SortState<Field extends string> = { field: Field; direction: SortDirection };

type UseAdminPaginatedListStateOptions<Field extends string> = {
  initialFilter?: string;
  initialPageSize?: number;
  initialSort: SortState<Field>;
  newFieldSortDirection?: SortDirection;
};

export default function useAdminPaginatedListState<Field extends string>({
  initialFilter = "",
  initialPageSize = 25,
  initialSort,
  newFieldSortDirection = "desc",
}: UseAdminPaginatedListStateOptions<Field>) {
  const pagination = useAdminPaginationState({ initialFilter, initialPageSize });
  const { resetPage } = pagination;
  const [sort, setSort] = useState<SortState<Field>>(initialSort);

  const handleSort = useCallback((field: Field) => {
    setSort((current) => nextSortState(current, field, newFieldSortDirection));
    resetPage();
  }, [newFieldSortDirection, resetPage]);

  return {
    ...pagination,
    sort,
    handleSort,
  };
}
