/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useEffect, useRef, useState } from "react";

import {
  detectStorageEndpointFeatures,
  type StorageEndpointFeatureDetectionPayload,
  type StorageEndpointFeatureDetectionResult,
} from "../../api/storageEndpoints";
import { extractApiError } from "../../utils/apiError";

export type StorageEndpointLiveValidationState = {
  status: "idle" | "loading" | "done";
  result: StorageEndpointFeatureDetectionResult | null;
  error: string | null;
};

const IDLE_STATE: StorageEndpointLiveValidationState = {
  status: "idle",
  result: null,
  error: null,
};

export function useStorageEndpointLiveValidation({
  enabled,
  payload,
  debounceMs = 450,
}: {
  enabled: boolean;
  payload: StorageEndpointFeatureDetectionPayload | null;
  debounceMs?: number;
}): StorageEndpointLiveValidationState {
  const [state, setState] = useState<StorageEndpointLiveValidationState>(IDLE_STATE);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !payload) {
      requestIdRef.current += 1;
      setState(IDLE_STATE);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setState({ status: "loading", result: null, error: null });
      try {
        const result = await detectStorageEndpointFeatures(payload);
        if (cancelled || requestIdRef.current !== requestId) return;
        setState({ status: "done", result, error: null });
      } catch (cause) {
        if (cancelled || requestIdRef.current !== requestId) return;
        setState({
          status: "done",
          result: null,
          error: extractApiError(cause, "Unable to validate this endpoint."),
        });
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [debounceMs, enabled, payload]);

  return state;
}
