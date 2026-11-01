/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { BucketFeatureEditorMode } from "./BucketFeatureEditorDialog";
import { formatBucketJsonValue } from "./bucketFeatureState";

type BucketFeatureEditorParseResult<T> = {
  draft: T | null;
  error: string | null;
};

type UseBucketFeatureEditorSessionOptions<T> = {
  initialDraft: T;
  initialJsonText: string;
  parseJson: (text: string) => BucketFeatureEditorParseResult<T>;
  clearTargetOnVisual?: boolean;
};

export function useBucketFeatureEditorSession<T>({
  initialDraft,
  initialJsonText,
  parseJson,
  clearTargetOnVisual = true,
}: UseBucketFeatureEditorSessionOptions<T>) {
  const [draft, setDraft] = useState<T>(() => initialDraft);
  const [jsonText, setJsonText] = useState(initialJsonText);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<BucketFeatureEditorMode>("visual");
  const [editorTargetIndex, setEditorTargetIndex] = useState<number | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const replaceDraft = useCallback((nextDraft: T) => {
    setDraft(nextDraft);
    setJsonText(formatBucketJsonValue(nextDraft));
  }, []);

  const openEditorDraft = useCallback((
    nextDraft: T,
    mode: BucketFeatureEditorMode,
    targetIndex: number | null,
  ) => {
    replaceDraft(nextDraft);
    setEditorMode(mode);
    setEditorTargetIndex(targetIndex);
    setEditorError(null);
    setStatus(null);
    setEditorOpen(true);
  }, [replaceDraft]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorTargetIndex(null);
    setEditorError(null);
  }, []);

  const updateJsonText = useCallback((value: string) => {
    setJsonText(value);
    setEditorError(null);
  }, []);

  const updateEditorMode = useCallback((nextMode: BucketFeatureEditorMode): T | null => {
    if (nextMode === editorMode) return null;
    setEditorError(null);
    if (nextMode === "json") {
      setJsonText(formatBucketJsonValue(draft));
      setEditorMode("json");
      return null;
    }

    const parsed = parseJson(jsonText);
    if (parsed.draft === null) {
      setEditorError(parsed.error);
      return null;
    }
    setDraft(parsed.draft);
    if (clearTargetOnVisual) {
      setEditorTargetIndex(null);
    }
    setEditorMode("visual");
    return parsed.draft;
  }, [clearTargetOnVisual, draft, editorMode, jsonText, parseJson]);

  return {
    closeEditor,
    draft,
    editorError,
    editorMode,
    editorOpen,
    editorTargetIndex,
    jsonText,
    openEditorDraft,
    replaceDraft,
    setDraft,
    setEditorError,
    setEditorOpen,
    setEditorTargetIndex,
    setJsonText,
    setStatus,
    status,
    updateEditorMode,
    updateJsonText,
  };
}
