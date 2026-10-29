/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

const selectedExecutionDestinations = new Map<string, number>();

export function setExecutionDestinationForContext(
  contextId: string,
  endpointId: number,
): void {
  selectedExecutionDestinations.set(contextId, endpointId);
}

export function clearExecutionDestinationForContext(contextId: string): void {
  selectedExecutionDestinations.delete(contextId);
}

export function getExecutionDestinationForContext(
  contextId: string,
): number | null {
  return selectedExecutionDestinations.get(contextId) ?? null;
}

export function clearExecutionDestinationState(): void {
  selectedExecutionDestinations.clear();
}
