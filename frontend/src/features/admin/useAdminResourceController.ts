/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Args<T> = {
  loadResource: () => Promise<T>;
  initialResource: T;
  formatError: (error: unknown) => string;
  enabled?: boolean;
  acceptResource?: (resource: T) => boolean;
  onLoaded?: (resource: T) => void;
};

export default function useAdminResourceController<T>({
  loadResource,
  initialResource,
  formatError,
  enabled = true,
  acceptResource,
  onLoaded,
}: Args<T>) {
  const [resource, setResource] = useState<T>(initialResource);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [errorCause, setErrorCause] = useState<unknown>(null);
  const loadGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      loadGeneration.current += 1;
      setLoading(false);
      setError(null);
      setErrorCause(null);
      return;
    }
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    setErrorCause(null);
    try {
      const nextResource = await loadResource();
      if (generation !== loadGeneration.current) return;
      if (acceptResource && !acceptResource(nextResource)) return;
      setResource(nextResource);
      onLoaded?.(nextResource);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setErrorCause(cause);
      setError(formatError(cause));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [acceptResource, enabled, formatError, loadResource, onLoaded]);

  useEffect(() => {
    void refresh();
    return () => {
      loadGeneration.current += 1;
    };
  }, [refresh]);

  return {
    resource,
    setResource,
    loading,
    error,
    errorCause,
    setError,
    refresh,
  };
}
