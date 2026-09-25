/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import type { BucketPublicAccessBlock } from "../../../api/bucketContracts";
import { SettingsButton } from "../../../components/settings/SettingsControls";
import { SettingsItem, SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import BucketFeatureSettingsDialog from "./BucketFeatureSettingsDialog";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketPublicAccessController } from "./useBucketPublicAccessController";

type BucketPublicAccessController = ReturnType<typeof useBucketPublicAccessController>;

type BucketPublicAccessFeatureProps = {
  controller: BucketPublicAccessController;
};

const publicAccessOptions: {
  key: keyof BucketPublicAccessBlock;
  label: string;
  description: string;
}[] = [
  {
    key: "block_public_acls",
    label: "BlockPublicAcls",
    description: "S3 rejects new PUT ACLs that grant public access to buckets or objects.",
  },
  {
    key: "ignore_public_acls",
    label: "IgnorePublicAcls",
    description: "Ignores any existing ACLs that grant public permissions on objects.",
  },
  {
    key: "block_public_policy",
    label: "BlockPublicPolicy",
    description: "Prevents bucket policies that grant public access from being set.",
  },
  {
    key: "restrict_public_buckets",
    label: "RestrictPublicBuckets",
    description: "Blocks access to buckets with public policies for all but the bucket owner.",
  },
];

export default function BucketPublicAccessFeature({ controller }: BucketPublicAccessFeatureProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const {
    config,
    dirty,
    error,
    fullyEnabled,
    loading,
    partiallyEnabled,
    reset,
    save,
    saving,
    status,
    update,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured: fullyEnabled || partiallyEnabled,
    unsaved: dirty,
  });
  const enabledCount = publicAccessOptions.filter((option) => Boolean(config[option.key])).length;
  const closeEditor = () => {
    reset();
    setEditorOpen(false);
  };

  return (
    <>
      <BucketFeatureSection
        title="Block public access"
        description="S3 public-access protection flags."
        mode="graphical"
        visualState={visualState}
        stateLabel={dirty ? undefined : fullyEnabled ? "Enabled" : partiallyEnabled ? "Partial" : "Inactive"}
        stateTone={partiallyEnabled ? "warning" : fullyEnabled ? "primary" : "neutral"}
        successMessage={status}
        busy={loading}
        testId="bucket-feature-block-public-access"
      >
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        <div className="bucket-feature-summary-row">
          <div className="bucket-feature-summary-value">
            <strong>{enabledCount} of 4</strong> protections enabled
          </div>
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={() => setEditorOpen(true)}
            disabled={notImplemented || loading || saving}
          >
            Edit
          </SettingsButton>
        </div>
        <div className="bucket-feature-flags">
          {publicAccessOptions.map((option) => (
            <div key={option.key} className="bucket-feature-flag">
              <span>{option.label}</span>
              <UiBadge tone={config[option.key] ? "primary" : "neutral"}>
                {config[option.key] ? "On" : "Off"}
              </UiBadge>
            </div>
          ))}
        </div>
      </BucketFeatureSection>

      {editorOpen ? (
        <BucketFeatureSettingsDialog
          title="Edit block public access"
          dirty={dirty}
          busy={saving}
          error={error}
          saveDisabled={notImplemented || loading}
          onSave={save}
          onClose={closeEditor}
        >
          <div>
            {publicAccessOptions.map((option) => (
              <SettingsItem
                key={option.key}
                compact
                title={option.label}
                description={option.description}
                action={
                  <SettingsSwitch
                    checked={Boolean(config[option.key])}
                    ariaLabel={option.label}
                    onChange={(checked) => update(option.key, checked)}
                    disabled={notImplemented || loading || saving}
                  />
                }
              />
            ))}
          </div>
        </BucketFeatureSettingsDialog>
      ) : null}
    </>
  );
}
