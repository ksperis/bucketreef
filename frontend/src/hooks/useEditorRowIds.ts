/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import { createUiDraftId } from "../utils/uiDraftId";

function createRowIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, () => createUiDraftId(prefix));
}

export function useEditorRowIds(prefix: string, rowCount?: number) {
  const [rowIds, setRowIds] = useState<string[]>(() =>
    createRowIds(prefix, rowCount ?? 0),
  );

  useEffect(() => {
    if (rowCount === undefined) return;
    setRowIds((current) => {
      if (current.length === rowCount) return current;
      if (current.length > rowCount) return current.slice(0, rowCount);
      return [...current, ...createRowIds(prefix, rowCount - current.length)];
    });
  }, [prefix, rowCount]);

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
    rowIds,
  };
}
