/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useState } from "react";

import {
  previewOnboardingDraft,
  type OnboardingDraft,
  type OnboardingPreview,
} from "../../api/onboarding";
import { isCancelledError } from "../../utils/apiError";

export default function useOnboardingDraftPreview({
  draft,
  journeyId,
  enabled,
  formatError,
}: {
  draft: OnboardingDraft;
  journeyId?: string;
  enabled: boolean;
  formatError: (cause: unknown) => string;
}) {
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setPending(true);
    setError("");
    const timer = window.setTimeout(() => {
      previewOnboardingDraft(draft, controller.signal, journeyId)
        .then((value) => {
          if (!controller.signal.aborted) {
            setPreview(value);
            setPending(false);
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted && !isCancelledError(cause)) {
            setError(formatError(cause));
            setPending(false);
          }
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [draft, enabled, formatError, journeyId, retryNonce]);

  const syncPreview = useCallback((value: OnboardingPreview) => {
    setPreview(value);
    setPending(false);
    setError("");
  }, []);

  const invalidatePreview = useCallback((nextPending: boolean) => {
    setPreview(null);
    setPending(nextPending);
  }, []);

  const retryPreview = useCallback(() => {
    setRetryNonce((value) => value + 1);
  }, []);

  return {
    preview,
    pending,
    error,
    syncPreview,
    invalidatePreview,
    retryPreview,
  };
}
