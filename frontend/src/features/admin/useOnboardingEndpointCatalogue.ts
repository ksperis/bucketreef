/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useRef, useState } from "react";

import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import { extractApiError } from "../../utils/apiError";

export default function useOnboardingEndpointCatalogue(loadErrorMessage: string) {
  const mountedRef = useRef(false);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const value = await listStorageEndpoints();
      if (mountedRef.current) {
        setEndpoints(value);
        setError("");
      }
      return value;
    } catch (cause) {
      if (mountedRef.current) {
        setError(extractApiError(cause, loadErrorMessage));
      }
      throw cause;
    }
  }, [loadErrorMessage]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  return { endpoints, error, refresh };
}
