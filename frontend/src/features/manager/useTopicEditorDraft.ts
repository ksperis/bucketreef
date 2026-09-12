/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useState } from "react";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import { extractApiError } from "../../utils/apiError";

/** One mounted topic/executor owns its load, draft and retry state. */
export function useTopicEditorDraft<T>(initial: () => T, load: () => Promise<T>) {
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
      if (active) setLoadError(extractApiError(error, "Unable to load topic settings."));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [accept, load, revision]);
  return { ...state, loading, loadError, retry: () => setRevision(value => value + 1) };
}
