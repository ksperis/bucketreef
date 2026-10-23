/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { inlinePolicyNameFormatError, type IAMEntity, type NamingValidationProfile } from "../../utils/resourceNames";
import { useManagerI18n } from "./managerI18n";
import type { InlinePolicy } from "../../api/managerIamPolicies";
import type {
  InlinePolicyDraftEditorMode,
  InlinePolicyDraftEditorProps,
} from "./InlinePolicyDraftEditor";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";

export function useInlinePolicyDraftEditor(
  setError: Dispatch<SetStateAction<string | null>>,
  entity: IAMEntity = "user",
  profile: NamingValidationProfile | null = "standard",
) {
  const { text } = useManagerI18n();
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [inlineDraftName, setInlineDraftName] = useState("");
  const [inlinePolicyText, setInlinePolicyText] = useState("");
  const [inlineDrafts, setInlineDrafts] = useState<InlinePolicy[]>([]);
  const [selectedInlineDraftName, setSelectedInlineDraftName] = useState<string | null>(null);
  const [inlineDraftMode, setInlineDraftMode] = useState<InlinePolicyDraftEditorMode>("create");
  const [showInlinePolicyOptions, setShowInlinePolicyOptions] = useState(false);

  const resetInlinePolicyDraftEditor = useCallback(() => {
    setValidationAttempted(false);
    setInlineDrafts([]);
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setShowInlinePolicyOptions(false);
  }, []);

  const formatError = inlinePolicyNameFormatError(inlineDraftName.trim(), entity, profile ?? "standard");
  const inlineDraftNameError = formatError ? text(formatError)
    : validationAttempted && !inlineDraftName.trim() ? text("Inline policy name is required.") : undefined;

  const validateInlineDrafts = () => {
    const invalid = inlineDrafts.map(policy => inlinePolicyNameFormatError(policy.name, entity, profile ?? "standard")).find(Boolean);
    if (inlineDraftNameError) return false;
    if (profile === null || invalid) {
      setError(text(invalid ?? "Naming rules are unavailable. Reload the context before saving."));
      return false;
    }
    return true;
  };

  const handleAddInlineDraft = () => {
    setValidationAttempted(true);
    if (!validateInlineDrafts()) return;
    const trimmedName = inlineDraftName.trim();
    if (!trimmedName) {
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = inlinePolicyText.trim() ? JSON.parse(inlinePolicyText) : {};
    } catch {
      setError("Inline policy must be valid JSON.");
      return;
    }
    setInlineDrafts((previous) => {
      const filtered = previous.filter(
        (policy) => policy.name !== trimmedName && policy.name !== selectedInlineDraftName
      );
      return [...filtered, { name: trimmedName, document: parsed }];
    });
    setSelectedInlineDraftName(trimmedName);
    setInlineDraftName(trimmedName);
    setInlinePolicyText(JSON.stringify(parsed, null, 2));
    setInlineDraftMode("edit");
    setError(null);
  };

  const handleSelectInlineDraft = (name: string | null) => {
    setValidationAttempted(false);
    if (!name) {
      setSelectedInlineDraftName(null);
      setInlineDraftName("");
      setInlinePolicyText("");
      setInlineDraftMode(inlineDrafts.length > 0 ? "idle" : "create");
      setError(null);
      return;
    }
    const draft = inlineDrafts.find((policy) => policy.name === name);
    if (!draft) return;
    try {
      setInlinePolicyText(JSON.stringify(draft.document ?? {}, null, 2));
    } catch {
      setInlinePolicyText("");
    }
    setSelectedInlineDraftName(draft.name);
    setInlineDraftName(draft.name);
    setInlineDraftMode("edit");
    setError(null);
  };

  const handleRemoveInlineDraft = (name: string) => {
    setInlineDrafts((previous) => previous.filter((policy) => policy.name !== name));
    if (selectedInlineDraftName === name || inlineDraftName === name) {
      setValidationAttempted(false);
      setSelectedInlineDraftName(null);
      setInlineDraftName("");
      setInlinePolicyText("");
      setInlineDraftMode(inlineDrafts.length > 1 ? "idle" : "create");
    }
    setError(null);
  };

  const handleCreateInlineDraft = () => {
    setSelectedInlineDraftName(null);
    setValidationAttempted(false);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setError(null);
  };

  const handleClearInlineDrafts = () => {
    setInlineDrafts([]);
    setSelectedInlineDraftName(null);
    setValidationAttempted(false);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setError(null);
  };

  const editorProps: InlinePolicyDraftEditorProps = {
    drafts: inlineDrafts,
    selectedDraftName: selectedInlineDraftName,
    draftName: inlineDraftName,
    nameError: inlineDraftNameError,
    draftText: inlinePolicyText,
    entityLabel: entity,
    mode: inlineDraftMode,
    expanded: showInlinePolicyOptions,
    onCreateDraft: handleCreateInlineDraft,
    onSelectDraft: handleSelectInlineDraft,
    onDraftNameChange: (value) => {
      setInlineDraftName(value);
      setError(null);
    },
    onDraftTextChange: (value) => {
      setInlinePolicyText(value);
      setError(null);
    },
    onSaveDraft: handleAddInlineDraft,
    onRemoveDraft: handleRemoveInlineDraft,
    onClearDrafts: handleClearInlineDrafts,
    onInsertTemplate: () => setInlinePolicyText(DEFAULT_INLINE_POLICY_TEXT),
    onToggleExpanded: () => setShowInlinePolicyOptions((previous) => !previous),
  };

  return {
    editorProps,
    inlineDraftName,
    inlineDrafts,
    inlinePolicyText,
    resetInlinePolicyDraftEditor,
    validateInlineDrafts,
  };
}
