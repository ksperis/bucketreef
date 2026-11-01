/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect } from "react";
import {
  fetchOnboardingStatus,
  ONBOARDING_STATUS_EVENT,
  type OnboardingStatus,
} from "../../api/onboarding";
import { extractApiError } from "../../utils/apiError";
import useAdminResourceController from "./useAdminResourceController";

export function useOnboardingStatus() {
  const formatError = useCallback(
    (cause: unknown) => extractApiError(cause, "Unable to load onboarding status."),
    [],
  );
  const {
    resource: status,
    error,
    setError,
    setResource: setStatus,
    refresh: refreshResource,
  } = useAdminResourceController<OnboardingStatus | null>({
    loadResource: fetchOnboardingStatus,
    initialResource: null,
    formatError,
  });
  const refresh = useCallback(async () => (await refreshResource()) ?? null, [refreshResource]);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<OnboardingStatus>).detail;
      if (detail) {
        setStatus(detail);
        setError(null);
      }
    };
    window.addEventListener(ONBOARDING_STATUS_EVENT, handle);
    return () => window.removeEventListener(ONBOARDING_STATUS_EVENT, handle);
  }, [setError, setStatus]);

  return { status, error, refresh, setStatus };
}
