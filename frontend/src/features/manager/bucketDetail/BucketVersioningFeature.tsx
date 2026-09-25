/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsButton } from "../../../components/settings/SettingsControls";
import { SettingsSwitch } from "../../../components/settings/SettingsLayout";
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
      stateLabel={dirty ? undefined : isEnabled ? "Enabled" : isSuspended ? "Suspended" : "Inactive"}
      stateTone={isSuspended ? "warning" : isEnabled ? "primary" : "neutral"}
      busy={saving || loading}
      testId="bucket-feature-versioning"
      actions={
        dirty ? (
          <SettingsButton
            type="button"
            onClick={() => void save(disableBlocked)}
            disabled={saving || loading || Boolean(loadError) || disableBlocked}
            title={disableBlocked ? "Disable Object Lock to change versioning." : undefined}
            variant="primary"
          >
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        ) : undefined
      }
    >
      {loading && <UiInlineMessage>Loading versioning...</UiInlineMessage>}
      {loadError && <UiInlineMessage tone="error">{loadError}</UiInlineMessage>}
      {saveError && <UiInlineMessage tone="error">{saveError}</UiInlineMessage>}
      <div className="bucket-feature-summary-row">
        <div className="bucket-feature-summary-value">
          {draftEnabled
            ? "Object versions are retained."
            : isSuspended
              ? "New object versions are suspended."
              : "Object version history is disabled."}
        </div>
        <SettingsSwitch
          checked={draftEnabled}
          disabled={saving || loading || Boolean(loadError) || disableBlocked}
          ariaLabel="Enable versioning"
          onChange={updateDraft}
        />
      </div>
      {disableBlocked && (
        <p className="mt-2 bucket-feature-summary-muted">
          Versioning cannot be disabled while Object Lock is enabled.
        </p>
      )}
    </BucketFeatureSection>
  );
}
