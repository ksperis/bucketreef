/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildStorageEndpoint } from "../../test/storageEndpoints";
import useOnboardingEndpointCatalogue from "./useOnboardingEndpointCatalogue";

const mocks = vi.hoisted(() => ({
  listStorageEndpoints: vi.fn(),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: mocks.listStorageEndpoints,
}));

describe("useOnboardingEndpointCatalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the endpoint catalogue and refreshes it on demand", async () => {
    const initial = buildStorageEndpoint(1, { name: "Primary" });
    const refreshed = buildStorageEndpoint(2, { name: "Secondary" });
    mocks.listStorageEndpoints.mockResolvedValueOnce([initial]).mockResolvedValueOnce([refreshed]);

    const { result } = renderHook(() =>
      useOnboardingEndpointCatalogue("Unable to load configured endpoints."),
    );

    await waitFor(() => expect(result.current.endpoints).toEqual([initial]));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.endpoints).toEqual([refreshed]);
    expect(result.current.error).toBe("");
    expect(mocks.listStorageEndpoints).toHaveBeenCalledTimes(2);
  });

  it("stores load errors and clears them after a successful refresh", async () => {
    const recovered = buildStorageEndpoint(3, { name: "Recovered" });
    mocks.listStorageEndpoints
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([recovered]);

    const { result } = renderHook(() =>
      useOnboardingEndpointCatalogue("Unable to load configured endpoints."),
    );

    await waitFor(() => expect(result.current.error).toBe("network down"));
    expect(result.current.endpoints).toEqual([]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.endpoints).toEqual([recovered]);
    expect(result.current.error).toBe("");
  });
});
