/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOnboardingDraft } from "./onboardingFormModel";
import useOnboardingDraftPreview from "./useOnboardingDraftPreview";

const mocks = vi.hoisted(() => ({
  previewOnboardingDraft: vi.fn(),
}));

vi.mock("../../api/onboarding", () => ({
  previewOnboardingDraft: mocks.previewOnboardingDraft,
}));

const preview = { review_token: "a".repeat(64), features: [], changes: [], blockers: [] };
const formatError = () => "preview failed";

describe("useOnboardingDraftPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces enabled preview requests and stores the result", async () => {
    mocks.previewOnboardingDraft.mockResolvedValue(preview);
    const draft = createOnboardingDraft();
    const { result } = renderHook(() =>
      useOnboardingDraftPreview({ draft, journeyId: "journey-1", enabled: true, formatError }),
    );

    expect(result.current.pending).toBe(true);
    expect(mocks.previewOnboardingDraft).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(250));

    expect(mocks.previewOnboardingDraft).toHaveBeenCalledWith(
      draft,
      expect.any(AbortSignal),
      "journey-1",
    );
    expect(result.current.preview).toEqual(preview);
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("can invalidate, synchronize, and retry the current preview", async () => {
    mocks.previewOnboardingDraft.mockResolvedValue(preview);
    const draft = createOnboardingDraft();
    const { result } = renderHook(() =>
      useOnboardingDraftPreview({ draft, enabled: true, formatError }),
    );

    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(mocks.previewOnboardingDraft).toHaveBeenCalledTimes(1);

    act(() => result.current.syncPreview(preview));
    expect(result.current.preview).toEqual(preview);

    act(() => result.current.invalidatePreview(true));
    expect(result.current.preview).toBeNull();
    expect(result.current.pending).toBe(true);

    act(() => result.current.retryPreview());
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(mocks.previewOnboardingDraft).toHaveBeenCalledTimes(2);
    expect(result.current.preview).toEqual(preview);
    expect(result.current.pending).toBe(false);
  });
});
