/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

import { nextSortState } from "../../utils/sortValues";

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
  const [filter, setFilterValue] = useState(initialFilter);
  const [sort, setSort] = useState<SortState<Field>>(initialSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const handleFilterChange = useCallback((value: string) => {
    setFilterValue(value);
    setPage(1);
  }, []);

  const handleSort = useCallback((field: Field) => {
    setSort((current) => nextSortState(current, field, newFieldSortDirection));
    setPage(1);
  }, [newFieldSortDirection]);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(Math.max(1, nextPage));
  }, []);

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
  }, []);

  const resetPage = useCallback(() => setPage(1), []);

  return {
    filter,
    sort,
    page,
    pageSize,
    setPage,
    handleFilterChange,
    handleSort,
    handlePageChange,
    handlePageSizeChange,
    resetPage,
  };
}
