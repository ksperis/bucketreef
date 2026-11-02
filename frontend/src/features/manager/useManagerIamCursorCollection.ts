/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { IamCursorPage, IamCursorQuery } from "../../api/managerIamEntityClient";
import { extractApiError } from "../../utils/apiError";

type CursorLoader<Item> = (
  contextId: S3ExecutionContextSelector,
  query?: IamCursorQuery,
) => Promise<IamCursorPage<Item>>;

export function useManagerIamCursorCollection<Item>(
  listPage: CursorLoader<Item>,
  { includeDetails = false }: { includeDetails?: boolean } = {},
) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextId, setContextId] = useState<S3ExecutionContextSelector | null>(null);
  const contextRef = useRef<S3ExecutionContextSelector | null>(null);
  const [search, setSearchState] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pageSize, setPageSizeState] = useState(25);
  const [markers, setMarkers] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextMarker, setNextMarker] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const resetCursor = useCallback(() => {
    setMarkers([null]);
    setPageIndex(0);
    setNextMarker(null);
  }, []);

  useEffect(() => {
    const normalizedSearch = search.trim();
    if (normalizedSearch === debouncedSearch) return;
    const handle = window.setTimeout(() => {
      setDebouncedSearch(normalizedSearch);
      resetCursor();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [debouncedSearch, resetCursor, search]);

  useEffect(() => {
    if (contextId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listPage(contextId, {
      marker: markers[pageIndex] ?? null,
      page_size: pageSize,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(includeDetails ? { include_details: true } : {}),
    })
      .then((response) => {
        if (cancelled) return;
        setItems(response.items);
        setNextMarker(response.next_marker);
      })
      .catch((cause) => {
        if (!cancelled) setError(extractApiError(cause, "Unexpected error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contextId, debouncedSearch, includeDetails, listPage, markers, pageIndex, pageSize, revision]);

  const load = useCallback((nextContextId: S3ExecutionContextSelector) => {
    if (contextRef.current !== nextContextId) {
      contextRef.current = nextContextId;
      setContextId(nextContextId);
      setSearchState("");
      setDebouncedSearch("");
      resetCursor();
      return;
    }
    setContextId(nextContextId);
    setRevision((value) => value + 1);
  }, [resetCursor]);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
  }, []);

  const setPageSize = useCallback((value: number) => {
    setPageSizeState(value);
    resetCursor();
  }, [resetCursor]);

  const nextPage = useCallback(() => {
    if (!nextMarker) return;
    setMarkers((current) => {
      const next = current.slice(0, pageIndex + 1);
      next.push(nextMarker);
      return next;
    });
    setPageIndex((value) => value + 1);
  }, [nextMarker, pageIndex]);

  const previousPage = useCallback(() => {
    if (pageIndex === 0) return;
    setPageIndex((value) => Math.max(0, value - 1));
  }, [pageIndex]);

  return {
    error,
    items,
    load,
    loading,
    setError,
    setItems,
    setLoading,
    search,
    setSearch,
    page: pageIndex + 1,
    pageSize,
    setPageSize,
    canPrevious: pageIndex > 0,
    canNext: Boolean(nextMarker),
    previousPage,
    nextPage,
  };
}
