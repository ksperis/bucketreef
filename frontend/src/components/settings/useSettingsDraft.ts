/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useState } from "react";

export const equalSettings = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export function useSettingsDraft<T>(initial: T | (() => T)) {
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const accept = useCallback((value: T) => {
    setBaseline(value);
    setDraft(value);
  }, []);
  const cancel = useCallback(() => setDraft(baseline), [baseline]);
  return {
    baseline,
    setBaseline,
    draft,
    setDraft,
    accept,
    cancel,
    dirty: !equalSettings(baseline, draft),
  };
}
