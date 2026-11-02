/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import { createUiDraftId } from "../../../utils/uiDraftId";

export function useBucketEditorRowIds(prefix: string) {
  const [rowIds, setRowIds] = useState<string[]>([]);

  const resetRowIds = useCallback((count: number) => {
    setRowIds(Array.from({ length: count }, () => createUiDraftId(prefix)));
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
