/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useRef, useState } from "react";

type LoadState = "idle" | "loading" | "loaded" | "error";

export type LazyListEnsureOptions = {
  retryOnError?: boolean;
};

export default function useLazyListLoader<T>(
  loader: () => Promise<T[]>,
  onError?: (error: unknown) => void,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadStateRef = useRef<LoadState>("idle");

  const refresh = useCallback(async () => {
    if (loadStateRef.current === "loading") return;
    loadStateRef.current = "loading";
    setLoading(true);
    try {
      const data = await loader();
      setItems(data);
      setLoaded(true);
      loadStateRef.current = "loaded";
    } catch (error) {
      loadStateRef.current = "error";
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }, [loader, onError]);

  const ensure = useCallback(
    async (options?: LazyListEnsureOptions) => {
      const loadState = loadStateRef.current;
      if (loadState === "loaded" || loadState === "loading") return;
      if (loadState === "error" && !options?.retryOnError) return;
      await refresh();
    },
    [refresh],
  );

  return { items, loading, loaded, refresh, ensure };
}
