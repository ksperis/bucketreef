/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import { createUiDraftId } from "../utils/uiDraftId";

function createRowIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, () => createUiDraftId(prefix));
}

function reconcileRowIds(prefix: string, rowIds: string[], rowCount: number): string[] {
  if (rowIds.length === rowCount) return rowIds;
  if (rowIds.length > rowCount) return rowIds.slice(0, rowCount);
  return [...rowIds, ...createRowIds(prefix, rowCount - rowIds.length)];
}

export function useEditorRowIds(prefix: string, rowCount?: number) {
  const [rowIds, setRowIds] = useState<string[]>(() =>
    createRowIds(prefix, rowCount ?? 0),
  );
  const renderedRowIds = rowCount === undefined
    ? rowIds
    : reconcileRowIds(prefix, rowIds, rowCount);

  useEffect(() => {
    if (renderedRowIds === rowIds) return;
    setRowIds(renderedRowIds);
  }, [renderedRowIds, rowIds]);

  const resetRowIds = useCallback((count: number) => {
    setRowIds(createRowIds(prefix, count));
  }, [prefix]);

  const appendRowId = useCallback(() => {
    setRowIds((current) => [...current, createUiDraftId(prefix)]);
  }, [prefix]);

  const removeRowId = useCallback((index: number) => {
    setRowIds((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }, []);

  const insertRowId = useCallback((index: number, rowId?: string) => {
    setRowIds((current) => {
      const next = [...current];
      next.splice(Math.min(index, next.length), 0, rowId ?? createUiDraftId(prefix));
      return next;
    });
  }, [prefix]);

  return {
    appendRowId,
    insertRowId,
    removeRowId,
    resetRowIds,
    rowIds: renderedRowIds,
  };
}
