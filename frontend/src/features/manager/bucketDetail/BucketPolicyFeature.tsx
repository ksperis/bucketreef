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
import type { useBucketPolicyController } from "./useBucketPolicyController";

type BucketPolicyController = ReturnType<typeof useBucketPolicyController>;

type BucketPolicyFeatureProps = {
  bucketName?: string;
  controller: BucketPolicyController;
  onRequestDelete: () => void;
};

function buildPolicyExample(bucketName?: string) {
  return `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${bucketName || "bucket"}/*"
    }
  ]
}`;
}

export default function BucketPolicyFeature({
  bucketName,
  controller,
  onRequestDelete,
}: BucketPolicyFeatureProps) {
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
  const example = buildPolicyExample(bucketName);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: dirty,
  });

  return (
    <BucketFeatureSection
      title="Bucket policy"
      description="IAM-like JSON applied directly on the bucket."
      mode="json"
      visualState={visualState}
      presentation="workbench"
      busy={saving || deleting || loading}
      testId="bucket-feature-policy"
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
        label="Bucket policy (JSON)"
        rows={12}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="settings-control font-mono"
        placeholder='{"Version":"2012-10-17","Statement":[...]}'
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
