/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useRef, useState } from "react";

import {
  saveOnboardingJourney,
  type OnboardingDraft,
  type OnboardingJourney,
} from "../../api/onboarding";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import { createRuntimeId } from "../../utils/runtimeId";
import { createOnboardingDraft } from "./onboardingFormModel";

export default function useOnboardingJourneyDraft() {
  const journeyId = useRef(createRuntimeId());
  const [journey, setJourney] = useState<OnboardingJourney | null>(null);
  const {
    draft,
    setDraft,
    accept: acceptDraft,
    dirty: dirtyDraft,
  } = useSettingsDraft<OnboardingDraft>(createOnboardingDraft);

  const storeJourney = useCallback((value: OnboardingJourney) => {
    journeyId.current = value.id;
    setJourney(value);
    acceptDraft(value.draft);
  }, [acceptDraft]);

  const persistJourney = useCallback(async (value = draft) => {
    const saved = await saveOnboardingJourney(journeyId.current, value, journey?.revision);
    storeJourney(saved);
    return saved;
  }, [draft, journey?.revision, storeJourney]);

  const changeDraft = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, [setDraft]);

  const replaceDraft = useCallback((value: OnboardingDraft) => {
    setDraft(value);
  }, [setDraft]);

  const getJourneyId = useCallback(() => journeyId.current, []);

  return {
    journey,
    draft,
    dirtyDraft,
    storeJourney,
    persistJourney,
    changeDraft,
    replaceDraft,
    getJourneyId,
  };
}
