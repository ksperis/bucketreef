import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearExecutionDestinationState,
  getExecutionDestinationForContext,
} from "../api/executionDestinationState";
import { buildExecutionContext } from "../test/executionContexts";
import { useExecutionDestinationSelection } from "./useExecutionDestinationSelection";

const context = buildExecutionContext("conn-1", {
  endpoint_id: 10,
  storage_endpoint_capabilities: { metrics: true },
  execution_destinations: [
    {
      endpoint_id: 10,
      name: "Zone A",
      endpoint_url: "https://zone-a.example.test",
      provider: "ceph",
      region: null,
      realm_id: "realm-a",
      zonegroup_id: "zonegroup-a",
      zone_id: "zone-a",
      is_default: true,
      storage_endpoint_capabilities: { metrics: true },
    },
    {
      endpoint_id: 11,
      name: "Zone B",
      endpoint_url: "https://zone-b.example.test",
      provider: "ceph",
      region: null,
      realm_id: "realm-a",
      zonegroup_id: "zonegroup-a",
      zone_id: "zone-b",
      is_default: false,
      storage_endpoint_capabilities: { metrics: false },
    },
  ],
});

describe("useExecutionDestinationSelection", () => {
  beforeEach(() => {
    clearExecutionDestinationState();
  });

  it("selects, registers, switches, and cleans up an execution destination", async () => {
    const { result, unmount } = renderHook(() => useExecutionDestinationSelection({
      selectedContextId: context.id,
      selectedContext: context,
      destinationSwitchingAvailable: true,
    }));

    await waitFor(() => expect(result.current.selectedExecutionEndpointId).toBe(10));
    expect(getExecutionDestinationForContext(context.id)).toBe(10);
    expect(result.current.selectedStorageEndpointCapabilities).toEqual({ metrics: true });

    act(() => result.current.setExecutionEndpointId(11));
    expect(result.current.selectedExecutionEndpointId).toBe(11);
    expect(getExecutionDestinationForContext(context.id)).toBe(11);
    expect(result.current.selectedStorageEndpointCapabilities).toEqual({ metrics: false });

    unmount();
    expect(getExecutionDestinationForContext(context.id)).toBeNull();
  });

  it("ignores unavailable destinations and clears registered state when switching is disabled", async () => {
    const { result } = renderHook(() => useExecutionDestinationSelection({
      selectedContextId: context.id,
      selectedContext: context,
      destinationSwitchingAvailable: false,
    }));

    await waitFor(() => expect(result.current.selectedExecutionEndpointId).toBeNull());
    act(() => result.current.setExecutionEndpointId(11));

    expect(result.current.selectedExecutionEndpointId).toBeNull();
    expect(getExecutionDestinationForContext(context.id)).toBeNull();
    expect(result.current.selectedStorageEndpointCapabilities).toEqual({ metrics: true });
  });
});
