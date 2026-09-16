/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useState } from "react";
import { useSettingsDraft } from "./useSettingsDraft";
import { extractApiError } from "../../utils/apiError";

/** One mounted editor owns its load, draft and retry state. */
export function useSettingsRemoteDraft<T>(initial: () => T, load: () => Promise<T>, errorMessage = "Unable to load settings.") {
  const [initialValue] = useState(initial);
  const state = useSettingsDraft(initialValue);
  const { accept } = state;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    void load().then(value => {
      if (active) accept(value);
    }).catch(error => {
      if (active) setLoadError(extractApiError(error, errorMessage));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [accept, load, revision, errorMessage]);
  return { ...state, loading, loadError, retry: () => setRevision(value => value + 1) };
}
