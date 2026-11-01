/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import useAdminResourceController from "./useAdminResourceController";

type PaginatedListResponse<T> = {
  items: T[];
  total: number;
};

type Args<T extends { id: number }> = {
  loadPage: () => Promise<PaginatedListResponse<T>>;
  ensurePageInRange: (total: number) => boolean;
  formatError: (error: unknown) => string;
  onLoaded?: () => void;
};

export default function useAdminPaginatedListController<T extends { id: number }>({
  loadPage,
  ensurePageInRange,
  formatError,
  onLoaded,
}: Args<T>) {
  const acceptPage = useCallback(
    (response: PaginatedListResponse<T>) => ensurePageInRange(response.total),
    [ensurePageInRange],
  );
  const handleLoaded = useCallback(() => onLoaded?.(), [onLoaded]);
  const {
    resource: page,
    setResource: setPage,
    loading,
    error,
    setError,
    refresh,
  } = useAdminResourceController<PaginatedListResponse<T>>({
    loadResource: loadPage,
    initialResource: { items: [], total: 0 },
    formatError,
    acceptResource: acceptPage,
    onLoaded: handleLoaded,
  });

  const updateItem = useCallback((id: number, update: (item: T) => T) => {
    setPage((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? update(item) : item)),
    }));
  }, [setPage]);

  return {
    items: page.items,
    total: page.total,
    loading,
    error,
    setError,
    refresh,
    updateItem,
  };
}
