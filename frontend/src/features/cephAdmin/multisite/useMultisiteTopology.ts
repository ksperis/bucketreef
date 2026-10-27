/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getMultisiteTopology, type MultisiteTopology } from "../../../api/cephMultisite";
import { extractApiError, isCancelledError } from "../../../utils/apiError";

export function useMultisiteTopology(endpointId: number | null, errorFallback: string) {
  const [data, setData] = useState<MultisiteTopology | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setData(null);
    setError(null);
    if (endpointId == null) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void getMultisiteTopology(endpointId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && requestId.current === id) setData(next);
      })
      .catch((failure) => {
        if (controller.signal.aborted || requestId.current !== id || isCancelledError(failure)) return;
        setError(extractApiError(failure, errorFallback));
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId.current === id) setLoading(false);
      });
    return () => controller.abort();
  }, [endpointId, errorFallback, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading, error, reload };
}
