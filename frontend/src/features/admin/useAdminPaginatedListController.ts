/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

type PaginatedListResponse<T> = {
  items: T[];
  total: number;
};

type Args<T extends { id: number }> = {
  loadPage: () => Promise<PaginatedListResponse<T>>;
  ensurePageInRange: (total: number) => boolean;
  formatError: (error: unknown) => string;
};

export default function useAdminPaginatedListController<T extends { id: number }>({
  loadPage,
  ensurePageInRange,
  formatError,
}: Args<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await loadPage();
      if (!ensurePageInRange(response.total)) return;
      setItems(response.items);
      setTotal(response.total);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setLoading(false);
    }
  }, [ensurePageInRange, formatError, loadPage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateItem = useCallback((id: number, update: (item: T) => T) => {
    setItems((current) => current.map((item) => (item.id === id ? update(item) : item)));
  }, []);

  return {
    items,
    total,
    loading,
    error,
    refresh,
    updateItem,
  };
}
