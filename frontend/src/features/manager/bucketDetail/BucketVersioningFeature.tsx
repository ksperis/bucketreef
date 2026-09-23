/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsButton } from "../../../components/settings/SettingsControls";
import { SettingsItem, SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketVersioningController } from "./useBucketVersioningController";

type BucketVersioningController = ReturnType<typeof useBucketVersioningController>;

type BucketVersioningFeatureProps = {
  controller: BucketVersioningController;
  disableBlocked: boolean;
};

export default function BucketVersioningFeature({
  controller,
  disableBlocked,
}: BucketVersioningFeatureProps) {
  const {
    dirty,
    draftEnabled,
    isEnabled,
    isSuspended,
    loadError,
    loading,
    save,
    saveError,
    saving,
    updateDraft,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(loadError);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured: isEnabled,
    unsaved: dirty,
  });

  return (
    <BucketFeatureSection
      title="Versioning"
      description="Enable or suspend S3 object versioning."
      mode="graphical"
      visualState={visualState}
      busy={saving || loading}
      testId="bucket-feature-versioning"
      actions={
        <SettingsButton
          type="button"
          onClick={() => void save(disableBlocked)}
          disabled={saving || loading || Boolean(loadError) || disableBlocked || !dirty}
          title={disableBlocked ? "Disable Object Lock to change versioning." : undefined}
          variant="primary"
        >
          {saving ? "Saving..." : "Save"}
        </SettingsButton>
      }
    >
      <div className="space-y-2">
        {loading && <UiInlineMessage>Loading versioning...</UiInlineMessage>}
        {loadError && <UiInlineMessage tone="error">{loadError}</UiInlineMessage>}
        {saveError && <UiInlineMessage tone="error">{saveError}</UiInlineMessage>}
        <SettingsItem
          compact
          title="Enable versioning"
          description="Keeps object history for restores and is required for Object Lock."
          action={
            <div className="flex items-center gap-2">
              {isSuspended && <UiBadge tone="warning">Suspended</UiBadge>}
              <SettingsSwitch
                checked={draftEnabled}
                disabled={saving || loading || Boolean(loadError) || disableBlocked}
                ariaLabel="Enable versioning"
                onChange={updateDraft}
              />
            </div>
          }
        />
      </div>
      {disableBlocked && (
        <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
          Versioning cannot be disabled while Object Lock is enabled.
        </p>
      )}
    </BucketFeatureSection>
  );
}
