/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiTextarea from "../../../components/ui/UiTextarea";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureSection from "./BucketFeatureSection";
import { resolveFeatureVisualState } from "./bucketFeatureState";

type BucketJsonFeatureController = {
  configured: boolean;
  deleting: boolean;
  dirty: boolean;
  error: string | null;
  loading: boolean;
  save: () => Promise<void>;
  saving: boolean;
  setText: (text: string) => void;
  text: string;
};

type BucketJsonFeatureEditorProps = {
  controller: BucketJsonFeatureController;
  description: string;
  example: string;
  label: string;
  onRequestDelete: () => void;
  placeholder: string;
  rows: number;
  testId: string;
  title: string;
};

export default function BucketJsonFeatureEditor({
  controller,
  description,
  example,
  label,
  onRequestDelete,
  placeholder,
  rows,
  testId,
  title,
}: BucketJsonFeatureEditorProps) {
  const [showExample, setShowExample] = useState(false);
  const {
    configured,
    deleting,
    dirty,
    error,
    loading,
    save,
    saving,
    setText,
    text,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: dirty,
  });

  return (
    <BucketFeatureSection
      title={title}
      description={description}
      mode="json"
      visualState={visualState}
      presentation="workbench"
      busy={saving || deleting || loading}
      testId={testId}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SettingsButton
            type="button"
            onClick={onRequestDelete}
            disabled={notImplemented || deleting || !configured}
            variant="danger"
          >
            {deleting ? "Deleting..." : "Delete"}
          </SettingsButton>
          <SettingsButton
            type="button"
            onClick={save}
            disabled={notImplemented || saving || loading || !dirty}
            variant="primary"
          >
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        </div>
      }
    >
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      <UiTextarea
        label={label}
        rows={rows}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="settings-control font-mono"
        placeholder={placeholder}
        spellCheck={false}
        disabled={notImplemented}
      />
      <BucketFeatureJsonExample
        show={showExample}
        onToggle={() => setShowExample((current) => !current)}
        example={example}
        onUseExample={() => setText(example)}
        disabled={notImplemented}
      />
    </BucketFeatureSection>
  );
}
