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
  reloadToken?: unknown;
  clearErrorOnLoad?: boolean;
  resetResourceOnLoad?: boolean;
  resetResourceOnError?: boolean;
  resetResourceWhenDisabled?: boolean;
  initialLoading?: boolean;
};

export default function useAdminResourceController<T>({
  loadResource,
  initialResource,
  formatError,
  enabled = true,
  acceptResource,
  onLoaded,
  reloadToken,
  clearErrorOnLoad = true,
  resetResourceOnLoad = false,
  resetResourceOnError = false,
  resetResourceWhenDisabled = false,
  initialLoading,
}: Args<T>) {
  const initialResourceRef = useRef(initialResource);
  const [resource, setResource] = useState<T>(initialResource);
  const [loading, setLoading] = useState(initialLoading ?? enabled);
  const [error, setError] = useState<string | null>(null);
  const [errorCause, setErrorCause] = useState<unknown>(null);
  const loadGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      loadGeneration.current += 1;
      if (resetResourceWhenDisabled) setResource(initialResourceRef.current);
      setLoading(false);
      setError(null);
      setErrorCause(null);
      return;
    }
    const generation = ++loadGeneration.current;
    setLoading(true);
    if (resetResourceOnLoad) setResource(initialResourceRef.current);
    if (clearErrorOnLoad) {
      setError(null);
      setErrorCause(null);
    }
    try {
      const nextResource = await loadResource();
      if (generation !== loadGeneration.current) return;
      if (acceptResource && !acceptResource(nextResource)) return;
      setResource(nextResource);
      setError(null);
      setErrorCause(null);
      onLoaded?.(nextResource);
      return nextResource;
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      if (resetResourceOnError) setResource(initialResourceRef.current);
      setErrorCause(cause);
      setError(formatError(cause));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [
    acceptResource,
    clearErrorOnLoad,
    enabled,
    formatError,
    loadResource,
    onLoaded,
    resetResourceOnError,
    resetResourceOnLoad,
    resetResourceWhenDisabled,
  ]);

  useEffect(() => {
    void refresh();
    return () => {
      loadGeneration.current += 1;
    };
  }, [refresh, reloadToken]);

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
