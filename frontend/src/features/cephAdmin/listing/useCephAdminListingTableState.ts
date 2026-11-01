/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { nextSortState } from "../../../utils/sortValues";
import {
  loadCephAdminVisibleColumns,
  persistCephAdminVisibleColumns,
} from "./cephAdminListingViewState";

type SortState<Field extends string> = {
  field: Field;
  direction: "asc" | "desc";
};

type UseCephAdminListingTableStateOptions<ColumnId extends string, SortField extends string> = {
  storageKey: string;
  allowedColumns: readonly ColumnId[];
  defaultVisibleColumns: readonly ColumnId[];
  defaultSort: SortState<SortField>;
  defaultPageSize?: number;
};

export function useCephAdminListingTableState<ColumnId extends string, SortField extends string>({
  storageKey,
  allowedColumns,
  defaultVisibleColumns,
  defaultSort,
  defaultPageSize = 25,
}: UseCephAdminListingTableStateOptions<ColumnId, SortField>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [sort, setSort] = useState<SortState<SortField>>(defaultSort);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() =>
    loadCephAdminVisibleColumns(storageKey, allowedColumns, defaultVisibleColumns),
  );

  useEffect(() => {
    persistCephAdminVisibleColumns(storageKey, visibleColumns);
  }, [storageKey, visibleColumns]);

  const toggleColumn = useCallback((id: ColumnId) => {
    setVisibleColumns((current) =>
      current.includes(id)
        ? current.filter((column) => column !== id)
        : [...current, id],
    );
  }, []);

  const resetColumns = useCallback(() => {
    setVisibleColumns([...defaultVisibleColumns]);
  }, [defaultVisibleColumns]);

  const toggleSort = useCallback((field: SortField) => {
    setSort((current) => nextSortState(current, field));
    setPage(1);
  }, []);

  const changePageSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const resetSort = useCallback(() => {
    setSort(defaultSort);
  }, [defaultSort]);

  const resetPageSize = useCallback(() => {
    setPageSize(defaultPageSize);
  }, [defaultPageSize]);

  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const visible = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !visible.has(column));
  }, [defaultVisibleColumns, visibleColumns]);

  return {
    page,
    setPage,
    pageSize,
    sort,
    visibleColumns,
    toggleColumn,
    resetColumns,
    toggleSort,
    changePageSize,
    resetSort,
    resetPageSize,
    columnsCustomized,
  };
}
