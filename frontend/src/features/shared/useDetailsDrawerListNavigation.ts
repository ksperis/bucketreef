/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DetailsDrawerNavigationState } from "./DetailsDrawerNavigation";

type NavigationFocus = "previous" | "next";

type UseDetailsDrawerListNavigationOptions<Row, Target> = {
  items: readonly Row[];
  resetKey: string | number | null;
  targetFromRow: (row: Row) => Target | null;
  rowMatchesTarget: (row: Row, target: Target) => boolean;
  rowKey: (row: Row) => string;
  findRowAction: (rowKey: string) => HTMLElement | null;
};

export default function useDetailsDrawerListNavigation<Row, Target>({
  items,
  resetKey,
  targetFromRow,
  rowMatchesTarget,
  rowKey,
  findRowAction,
}: UseDetailsDrawerListNavigationOptions<Row, Target>) {
  const [target, setTarget] = useState<Target | null>(null);
  const [requestedFocus, setRequestedFocus] = useState<NavigationFocus | undefined>(undefined);

  const index = useMemo(() => {
    if (!target) return -1;
    return items.findIndex((row) => rowMatchesTarget(row, target));
  }, [items, rowMatchesTarget, target]);

  const viewedRowKey = useMemo(() => {
    if (index < 0) return null;
    return rowKey(items[index]);
  }, [index, items, rowKey]);

  useEffect(() => {
    if (!viewedRowKey) return;
    const frame = window.requestAnimationFrame(() => {
      const rowAction = findRowAction(viewedRowKey);
      if (!rowAction) return;
      const bounds = rowAction.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        rowAction.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [findRowAction, viewedRowKey]);

  const updateTarget = useCallback(
    (row: Row, options?: { focus?: NavigationFocus }) => {
      const nextTarget = targetFromRow(row);
      if (!nextTarget) return;
      setRequestedFocus(options?.focus);
      setTarget(nextTarget);
    },
    [targetFromRow],
  );

  const open = useCallback((row: Row) => updateTarget(row), [updateTarget]);

  const close = useCallback(() => {
    setRequestedFocus(undefined);
    setTarget(null);
  }, []);

  useEffect(() => {
    close();
  }, [close, resetKey]);

  const navigation = useMemo<DetailsDrawerNavigationState | undefined>(() => {
    if (!target || index < 0) return undefined;
    const previousRow = items[index - 1];
    const nextRow = items[index + 1];
    return {
      previous: previousRow
        ? () => updateTarget(previousRow, { focus: "previous" })
        : undefined,
      next: nextRow
        ? () => updateTarget(nextRow, { focus: "next" })
        : undefined,
      position: `${index + 1} / ${items.length}`,
      focus: requestedFocus,
      returnFocus: () => (viewedRowKey ? findRowAction(viewedRowKey) : null),
    };
  }, [findRowAction, index, items, requestedFocus, target, updateTarget, viewedRowKey]);

  return {
    close,
    navigation,
    open,
    target,
    viewedRowKey,
  };
}
