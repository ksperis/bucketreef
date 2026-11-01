/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingDraft, OnboardingJourney } from "../../api/onboarding";
import { createOnboardingDraft } from "./onboardingFormModel";
import useOnboardingJourneyDraft from "./useOnboardingJourneyDraft";

const mocks = vi.hoisted(() => ({
  saveOnboardingJourney: vi.fn(),
}));

vi.mock("../../api/onboarding", () => ({
  saveOnboardingJourney: mocks.saveOnboardingJourney,
}));

const preview = { review_token: "a".repeat(64), features: [], changes: [], blockers: [] };

function journey(id: string, draft: OnboardingDraft, revision = 3): OnboardingJourney {
  return {
    id,
    revision,
    draft,
    resources: {},
    configured: false,
    preview,
    links: {},
    created_at: "2026-11-01T12:00:00Z",
    updated_at: "2026-11-01T12:00:00Z",
  };
}

describe("useOnboardingJourneyDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tracks draft dirtiness and rebases when a journey is stored", () => {
    const { result } = renderHook(() => useOnboardingJourneyDraft());
    expect(result.current.dirtyDraft).toBe(false);

    act(() => result.current.changeDraft({ portal: true }));
    expect(result.current.dirtyDraft).toBe(true);

    const savedDraft = { ...createOnboardingDraft(), portal: true };
    act(() => result.current.storeJourney(journey("journey-1", savedDraft)));
    expect(result.current.draft).toEqual(savedDraft);
    expect(result.current.dirtyDraft).toBe(false);
    expect(result.current.getJourneyId()).toBe("journey-1");
  });

  it("persists with the stored journey revision and rebases to the response", async () => {
    const { result } = renderHook(() => useOnboardingJourneyDraft());
    const initial = journey("journey-2", createOnboardingDraft(), 4);
    act(() => result.current.storeJourney(initial));
    const changed = { ...initial.draft, supervision: true };
    const saved = journey(initial.id, changed, 5);
    mocks.saveOnboardingJourney.mockResolvedValue(saved);

    await act(async () => {
      await result.current.persistJourney(changed);
    });

    expect(mocks.saveOnboardingJourney).toHaveBeenCalledWith("journey-2", changed, 4);
    expect(result.current.journey).toEqual(saved);
    expect(result.current.draft).toEqual(changed);
    expect(result.current.dirtyDraft).toBe(false);
  });
});
