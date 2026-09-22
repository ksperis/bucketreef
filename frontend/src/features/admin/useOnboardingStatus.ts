/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useState } from "react";
import {
  fetchOnboardingStatus,
  ONBOARDING_STATUS_EVENT,
  type OnboardingStatus,
} from "../../api/onboarding";
import { extractApiError } from "../../utils/apiError";

export function useOnboardingStatus() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const value = await fetchOnboardingStatus();
      setStatus(value);
      setError(null);
      return value;
    } catch (cause) {
      setError(extractApiError(cause, "Unable to load onboarding status."));
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<OnboardingStatus>).detail;
      if (detail) {
        setStatus(detail);
        setError(null);
      }
    };
    window.addEventListener(ONBOARDING_STATUS_EVENT, handle);
    return () => window.removeEventListener(ONBOARDING_STATUS_EVENT, handle);
  }, [refresh]);

  return { status, error, refresh, setStatus };
}
