/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import useAdminPaginatedResourceController, {
  type PaginatedResource,
} from "./useAdminPaginatedResourceController";

type Args<T extends { id: number }> = {
  loadPage: () => Promise<PaginatedResource<T>>;
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
  const {
    items,
    total,
    setPage,
    loading,
    error,
    setError,
    refresh,
  } = useAdminPaginatedResourceController({
    loadPage,
    ensurePageInRange,
    formatError,
    onLoaded,
  });

  const updateItem = useCallback((id: number, update: (item: T) => T) => {
    setPage((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? update(item) : item)),
    }));
  }, [setPage]);

  return {
    items,
    total,
    loading,
    error,
    setError,
    refresh,
    updateItem,
  };
}
