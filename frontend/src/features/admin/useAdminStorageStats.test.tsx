import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import type { ManagerStats } from "../../api/stats";
import { useAdminStorageStats } from "./useAdminStorageStats";

const statsFixture = {} as ManagerStats;

describe("useAdminStorageStats", () => {
  it("loads stats for the selected resource", async () => {
    const fetchStats = vi.fn().mockResolvedValue(statsFixture);
    const { result } = renderHook(() =>
      useAdminStorageStats({
        id: 42,
        fetchStats,
        unavailableMessage: "Metrics unavailable.",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchStats).toHaveBeenCalledOnce();
    expect(fetchStats).toHaveBeenCalledWith(42);
    expect(result.current.stats).toBe(statsFixture);
    expect(result.current.error).toBeNull();
  });

  it("does not fetch while the resource is disabled", async () => {
    const fetchStats = vi.fn().mockResolvedValue(statsFixture);
    const { result } = renderHook(() =>
      useAdminStorageStats({
        id: 42,
        enabled: false,
        fetchStats,
        unavailableMessage: "Metrics unavailable.",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchStats).not.toHaveBeenCalled();
    expect(result.current.stats).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("keeps backend detail and falls back to the resource-specific 403 message", async () => {
    const detailedFetch = vi.fn().mockRejectedValue(
      new ApiError("Request failed", {
        response: {
          status: 403,
          data: { detail: "Metrics denied by endpoint policy." },
          headers: {},
        },
      }),
    );
    const detailed = renderHook(() =>
      useAdminStorageStats({
        id: 42,
        fetchStats: detailedFetch,
        unavailableMessage: "Metrics unavailable.",
      }),
    );

    await waitFor(() =>
      expect(detailed.result.current.error).toBe("Metrics denied by endpoint policy."),
    );

    detailed.unmount();

    const deniedFetch = vi.fn().mockRejectedValue(
      new ApiError("Request failed", {
        response: { status: 403, data: {}, headers: {} },
      }),
    );
    const denied = renderHook(() =>
      useAdminStorageStats({
        id: 7,
        fetchStats: deniedFetch,
        unavailableMessage: "Metrics unavailable.",
      }),
    );

    await waitFor(() =>
      expect(denied.result.current.error).toBe("Metrics unavailable."),
    );
  });
});
