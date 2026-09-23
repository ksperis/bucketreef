/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketPublicAccessBlock } from "../../../api/bucketContracts";
import { SettingsButton } from "../../../components/settings/SettingsControls";
import { SettingsItem, SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
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
  const {
    config,
    dirty,
    error,
    fullyEnabled,
    loading,
    partiallyEnabled,
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

  return (
    <BucketFeatureSection
      title="Block public access"
      description="Manage the four S3 public access block flags. Configure each option below."
      mode="graphical"
      visualState={visualState}
      successMessage={status}
      busy={saving || loading}
      testId="bucket-feature-block-public-access"
      actions={
        <SettingsButton
          type="button"
          onClick={save}
          disabled={notImplemented || loading || saving || !dirty}
          variant="primary"
        >
          {saving ? "Saving..." : "Save"}
        </SettingsButton>
      }
    >
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
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
    </BucketFeatureSection>
  );
}
