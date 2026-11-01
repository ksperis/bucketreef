/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ONBOARDING_STATUS_EVENT, type OnboardingStatus } from "../../api/onboarding";
import { useOnboardingStatus } from "./useOnboardingStatus";

const mocks = vi.hoisted(() => ({
  fetchOnboardingStatus: vi.fn(),
}));

vi.mock("../../api/onboarding", async () => {
  const actual = await vi.importActual<typeof import("../../api/onboarding")>("../../api/onboarding");
  return {
    ...actual,
    fetchOnboardingStatus: mocks.fetchOnboardingStatus,
  };
});

const status = (complete: boolean): OnboardingStatus => ({
  dismissed: false,
  complete,
  source: "standard",
  journeys: [],
  can_configure: true,
});

describe("useOnboardingStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads eagerly and returns the refreshed status", async () => {
    const initial = status(false);
    const refreshed = status(true);
    mocks.fetchOnboardingStatus.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    const { result } = renderHook(() => useOnboardingStatus());

    await waitFor(() => expect(result.current.status).toEqual(initial));

    let returned: OnboardingStatus | null = null;
    await act(async () => {
      returned = await result.current.refresh();
    });

    expect(returned).toEqual(refreshed);
    expect(result.current.status).toEqual(refreshed);
    expect(result.current.error).toBeNull();
  });

  it("stores load errors and accepts announced status updates", async () => {
    mocks.fetchOnboardingStatus.mockRejectedValueOnce(new Error("network down"));
    const announced = status(true);
    const { result } = renderHook(() => useOnboardingStatus());

    await waitFor(() => expect(result.current.error).toBe("network down"));
    expect(result.current.status).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent<OnboardingStatus>(ONBOARDING_STATUS_EVENT, { detail: announced }));
    });

    expect(result.current.status).toEqual(announced);
    expect(result.current.error).toBeNull();
  });
});
