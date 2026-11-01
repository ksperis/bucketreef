/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import useAdminResourceController from "./useAdminResourceController";

export type PaginatedResource<T> = {
  items: T[];
  total: number;
};

type Args<T> = {
  loadPage: () => Promise<PaginatedResource<T>>;
  ensurePageInRange: (total: number) => boolean;
  formatError: (error: unknown) => string;
  onLoaded?: () => void;
  resetResourceOnError?: boolean;
};

export default function useAdminPaginatedResourceController<T>({
  loadPage,
  ensurePageInRange,
  formatError,
  onLoaded,
  resetResourceOnError = false,
}: Args<T>) {
  const acceptPage = useCallback(
    (response: PaginatedResource<T>) => ensurePageInRange(response.total),
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
  } = useAdminResourceController<PaginatedResource<T>>({
    loadResource: loadPage,
    initialResource: { items: [], total: 0 },
    formatError,
    acceptResource: acceptPage,
    onLoaded: handleLoaded,
    resetResourceOnError,
  });

  return {
    items: page.items,
    total: page.total,
    setPage,
    loading,
    error,
    setError,
    refresh,
  };
}
