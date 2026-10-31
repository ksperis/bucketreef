/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

import { pageCount } from "../../utils/pagination";

type UseAdminPaginationStateOptions = {
  initialFilter?: string;
  initialPageSize?: number;
};

export default function useAdminPaginationState({
  initialFilter = "",
  initialPageSize = 25,
}: UseAdminPaginationStateOptions = {}) {
  const [filter, setFilterValue] = useState(initialFilter);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const handleFilterChange = useCallback((value: string) => {
    setFilterValue(value);
    setPage(1);
  }, []);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(Math.max(1, nextPage));
  }, []);

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
  }, []);

  const resetPage = useCallback(() => setPage(1), []);

  const ensurePageInRange = useCallback(
    (totalItems: number) => {
      if (totalItems <= 0) return true;
      const totalPages = pageCount(totalItems, pageSize);
      if (page <= totalPages) return true;
      setPage(totalPages);
      return false;
    },
    [page, pageSize],
  );

  return {
    filter,
    page,
    pageSize,
    handleFilterChange,
    handlePageChange,
    handlePageSizeChange,
    resetPage,
    ensurePageInRange,
  };
}
