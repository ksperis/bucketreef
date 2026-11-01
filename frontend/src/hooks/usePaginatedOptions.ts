/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useState } from "react";
import type { PaginatedResponse } from "../api/types";

export type PaginatedOptionsQuery = {
  page?: number;
  page_size?: number;
  search?: string;
};

export default function usePaginatedOptions<T>(
  loader: (query: PaginatedOptionsQuery) => Promise<PaginatedResponse<T>>,
  {
    enabled = true,
    initialPageSize = 25,
    debounceMs = 250,
  }: { enabled?: boolean; initialPageSize?: number; debounceMs?: number } = {},
) {
  const [items, setItems] = useState<T[]>([]);
  const [search, setSearchState] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), debounceMs);
    return () => window.clearTimeout(handle);
  }, [debounceMs, search]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoaded(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loader({
      page,
      page_size: pageSize,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }).then((response) => {
      if (cancelled) return;
      setItems(response.items);
      setTotal(response.total);
      setLoaded(true);
      const lastPage = Math.max(1, Math.ceil(response.total / pageSize));
      if (page > lastPage) setPage(lastPage);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unexpected error");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [debouncedSearch, enabled, loader, page, pageSize, revision]);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);
  const setPageSize = useCallback((value: number) => {
    setPageSizeState(value);
    setPage(1);
  }, []);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  return {
    items,
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
    total,
    loading,
    loaded,
    error,
    refresh,
  };
}
