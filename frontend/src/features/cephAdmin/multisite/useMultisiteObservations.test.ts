/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MultisiteObservation, MultisiteSyncStatus } from "../../../api/cephMultisite";
import { compareMultisiteObservation, useMultisiteAutoRefresh, useMultisiteObservations } from "./useMultisiteObservations";

function observation(marker: string, generation = "3"): MultisiteObservation<MultisiteSyncStatus> {
  return {
    availability: "available", data: { family: "bucket-index", phase: "incremental-sync", raw_status: "incremental-sync",
      expected_shards: null, period: null, realm_epoch: null, instance_id: null, generation,
      shards: [{ shard_id: 0, phase: "incremental-sync", raw_status: "incremental-sync", marker, timestamp: null, details: {} }], details: {} },
    collected_at: marker, last_success_at: marker, stale: false, reason_code: null,
    provenance: { endpoint_id: 1, realm_id: "r", local_zone_id: "z2", source_zone_id: "z1", operation: "bucket_status", http_status: 200, duration_ms: 1, collection_id: "c" },
  };
}
describe("multisite session observations", () => {
  it("compares opaque marker equality and restarts on generation/instance changes", () => {
    const first = compareMultisiteObservation(undefined, observation("9"), "tenant/bucket:instance", 0)!;
    expect(first.change).toBe("first_observation");
    expect(compareMultisiteObservation(first, observation("9"), "tenant/bucket:instance", 1)?.change).toBe("unchanged");
    expect(compareMultisiteObservation(first, observation("1"), "tenant/bucket:instance", 1)?.change).toBe("changed");
    expect(compareMultisiteObservation(first, observation("1", "4"), "tenant/bucket:instance", 1)?.change).toBe("new_context");
    expect(compareMultisiteObservation(first, observation("9"), "tenant/bucket:new-instance", 1)?.change).toBe("new_context");
    expect(compareMultisiteObservation(first, observation("9"), "tenant/bucket:instance", 1800001)?.change).toBe("first_observation");
    expect(compareMultisiteObservation(first, { ...observation("9"), stale: true }, "scope")).toBeNull();
    const unknown = observation("9");
    unknown.data!.phase = "unknown";
    unknown.data!.raw_status = "future-phase-a";
    const unknownFirst = compareMultisiteObservation(undefined, unknown, "scope", 0)!;
    unknown.data!.raw_status = "future-phase-b";
    expect(compareMultisiteObservation(unknownFirst, unknown, "scope", 1)?.change).toBe("changed");
  });
  it("bounds history and removes the previous scope immediately", () => {
    const { result, rerender } = renderHook(({ scope }) => useMultisiteObservations(scope), { initialProps: { scope: "A" } });
    for (let index = 0; index < 25; index++) act(() => result.current.record(observation(String(index))));
    expect(result.current.observations).toHaveLength(20);
    rerender({ scope: "B" });
    expect(result.current.observations).toEqual([]);
    act(() => result.current.record(observation("new")));
    expect(result.current.observations[0].change).toBe("first_observation");
    act(() => result.current.reset());
    expect(result.current.observations).toEqual([]);
  });
  it("refreshes only when opted in and visible, and stops on unmount", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const { result, unmount } = renderHook(() => useMultisiteAutoRefresh(refresh));
    act(() => vi.advanceTimersByTime(30000));
    expect(refresh).not.toHaveBeenCalled();
    act(() => result.current.setAutoRefresh(true));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => vi.advanceTimersByTime(30000));
    expect(refresh).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => vi.advanceTimersByTime(30000));
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    act(() => vi.advanceTimersByTime(30000));
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks(); vi.useRealTimers();
  });
  it("expires observations after 30 minutes even without another collection", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useMultisiteObservations("scope"));
    act(() => result.current.record(observation("first")));
    expect(result.current.observations).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1800000));
    expect(result.current.observations).toHaveLength(0);
    unmount();
    vi.useRealTimers();
  });
});
