/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Args<T> = {
  loadItems: () => Promise<T[]>;
  formatError: (error: unknown) => string;
};

export default function useAdminListController<T>({
  loadItems,
  formatError,
}: Args<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const nextItems = await loadItems();
      if (generation !== loadGeneration.current) return;
      setItems(nextItems);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setError(formatError(cause));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [formatError, loadItems]);

  useEffect(() => {
    void refresh();
    return () => {
      loadGeneration.current += 1;
    };
  }, [refresh]);

  return {
    items,
    setItems,
    loading,
    error,
    setError,
    refresh,
  };
}
