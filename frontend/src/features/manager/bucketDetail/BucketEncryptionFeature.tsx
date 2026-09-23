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
import EndpointFeatureDisabledNotice from "./EndpointFeatureDisabledNotice";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketEncryptionController } from "./useBucketEncryptionController";

type BucketEncryptionController = ReturnType<typeof useBucketEncryptionController>;

type BucketEncryptionFeatureProps = {
  controller: BucketEncryptionController;
  enabled: boolean;
  onRequestDelete: () => void;
};

const defaultEncryptionExample = `[
  {
    "ApplyServerSideEncryptionByDefault": {
      "SSEAlgorithm": "AES256"
    }
  }
]`;

export default function BucketEncryptionFeature({
  controller,
  enabled,
  onRequestDelete,
}: BucketEncryptionFeatureProps) {
  const [showExample, setShowExample] = useState(false);
  const {
    clearStatus,
    configured,
    deleting,
    dirty,
    error,
    loading,
    save,
    saving,
    setText,
    status,
    text,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const disabled = !enabled || notImplemented;
  const visualState = resolveFeatureVisualState({
    disabled,
    configured,
    unsaved: dirty,
  });

  return (
    <BucketFeatureSection
      title="Server-side encryption"
      description="Bucket default encryption rules (S3 API Rules array)."
      mode="json"
      visualState={visualState}
      presentation="workbench"
      successMessage={status}
      busy={saving || deleting || loading}
      testId="bucket-feature-encryption"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SettingsButton
            type="button"
            onClick={onRequestDelete}
            disabled={disabled || deleting || !configured}
            variant="danger"
          >
            {deleting ? "Disabling..." : "Disable"}
          </SettingsButton>
          <SettingsButton
            type="button"
            onClick={save}
            disabled={disabled || saving || loading || !dirty}
            variant="primary"
          >
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        </div>
      }
    >
      {!enabled && <EndpointFeatureDisabledNotice featureLabel="Server-side encryption" />}
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      <UiTextarea
        label="Encryption rules (JSON)"
        rows={6}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (status) clearStatus();
        }}
        className="settings-control font-mono"
        placeholder='[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]'
        spellCheck={false}
        disabled={disabled || loading || saving || deleting}
      />
      <BucketFeatureJsonExample
        show={showExample}
        onToggle={() => setShowExample((current) => !current)}
        example={defaultEncryptionExample}
        onUseExample={() => setText(defaultEncryptionExample)}
        disabled={disabled}
        helperText={
          <span className="settings-description">
            Leave <code>Rules</code> empty to disable default encryption.
          </span>
        }
      />
    </BucketFeatureSection>
  );
}
