/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

type LoadState = "idle" | "loading" | "loaded" | "error";

type LazyListEnsureOptions = {
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
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (loadStateRef.current === "loading") return;
    loadStateRef.current = "loading";
    if (mountedRef.current) setLoading(true);
    try {
      const data = await loader();
      loadStateRef.current = "loaded";
      if (mountedRef.current) {
        setItems(data);
        setLoaded(true);
      }
    } catch (error) {
      loadStateRef.current = "error";
      if (mountedRef.current) onError?.(error);
    } finally {
      if (mountedRef.current) setLoading(false);
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
