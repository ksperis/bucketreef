/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExecutionContext } from "../api/executionContexts";
import {
  clearExecutionDestinationForContext,
  setExecutionDestinationForContext,
} from "../api/executionDestinationState";

type UseExecutionDestinationSelectionOptions = {
  selectedContextId: string | null;
  selectedContext: ExecutionContext | null;
  destinationSwitchingAvailable: boolean;
};

export function useExecutionDestinationSelection({
  selectedContextId,
  selectedContext,
  destinationSwitchingAvailable,
}: UseExecutionDestinationSelectionOptions) {
  const [selectedExecutionEndpointId, setSelectedExecutionEndpointId] = useState<number | null>(null);
  const previousExecutionContextIdRef = useRef<string | null>(null);
  const executionDestinationIds = useMemo(
    () => selectedContext?.execution_destinations?.map((item) => item.endpoint_id) ?? [],
    [selectedContext?.execution_destinations],
  );
  const selectedExecutionDestination = selectedContext?.execution_destinations?.find(
    (destination) => destination.endpoint_id === selectedExecutionEndpointId,
  ) ?? null;
  const selectedStorageEndpointCapabilities = selectedExecutionDestination?.storage_endpoint_capabilities
    ?? selectedContext?.storage_endpoint_capabilities
    ?? null;

  useEffect(() => {
    const contextChanged = previousExecutionContextIdRef.current !== selectedContextId;
    const originEndpointId = selectedContext?.endpoint_id ?? null;
    setSelectedExecutionEndpointId((current) => {
      if (!destinationSwitchingAvailable || originEndpointId == null) return null;
      if (contextChanged || current == null || !executionDestinationIds.includes(current)) {
        return originEndpointId;
      }
      return current;
    });
    previousExecutionContextIdRef.current = selectedContextId;
  }, [
    destinationSwitchingAvailable,
    executionDestinationIds,
    selectedContext?.endpoint_id,
    selectedContextId,
  ]);

  useEffect(() => {
    if (!selectedContextId) return;
    if (destinationSwitchingAvailable && selectedExecutionEndpointId != null) {
      setExecutionDestinationForContext(selectedContextId, selectedExecutionEndpointId);
    } else {
      clearExecutionDestinationForContext(selectedContextId);
    }
    return () => clearExecutionDestinationForContext(selectedContextId);
  }, [destinationSwitchingAvailable, selectedContextId, selectedExecutionEndpointId]);

  const setExecutionEndpointId = useCallback((endpointId: number) => {
    if (!destinationSwitchingAvailable || !executionDestinationIds.includes(endpointId)) return;
    if (selectedContextId) {
      setExecutionDestinationForContext(selectedContextId, endpointId);
    }
    setSelectedExecutionEndpointId(endpointId);
  }, [destinationSwitchingAvailable, executionDestinationIds, selectedContextId]);

  return {
    selectedExecutionEndpointId,
    selectedStorageEndpointCapabilities,
    setExecutionEndpointId,
  };
}
