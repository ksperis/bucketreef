/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsButton } from "../../../components/settings/SettingsControls";
import { SettingsItem, SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { cx, uiInputClass } from "../../../components/ui/styles";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketAccessLoggingController } from "./useBucketAccessLoggingController";

type BucketAccessLoggingController = ReturnType<typeof useBucketAccessLoggingController>;

type BucketAccessLoggingFeatureProps = {
  controller: BucketAccessLoggingController;
  onRequestDisable: () => void;
};

const inputClass = cx(uiInputClass, "settings-control");
const labelClass = "settings-label flex flex-col gap-1";

export default function BucketAccessLoggingFeature({
  controller,
  onRequestDisable,
}: BucketAccessLoggingFeatureProps) {
  const {
    clearing,
    configured,
    dirty,
    error,
    loading,
    loggingEnabled,
    save,
    saving,
    status,
    targetBucket,
    targetPrefix,
    updateEnabled,
    updateTargetBucket,
    updateTargetPrefix,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: dirty,
  });

  return (
    <BucketFeatureSection
      title="Server access logging"
      description="Deliver S3 server access logs to another bucket."
      mode="graphical"
      visualState={visualState}
      successMessage={status}
      busy={saving || clearing || loading}
      testId="bucket-feature-access-logging"
      actions={
        <div className="flex flex-wrap gap-2">
          <SettingsButton
            type="button"
            onClick={onRequestDisable}
            disabled={notImplemented || clearing || !configured}
            variant="danger"
          >
            {clearing ? "Disabling..." : "Disable"}
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
      <SettingsItem
        compact
        title="Enable server access logging"
        action={
          <SettingsSwitch
            ariaLabel="Enable server access logging"
            checked={loggingEnabled}
            onChange={updateEnabled}
            disabled={notImplemented || loading || saving || clearing}
          />
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>
          Target bucket
          <input
            type="text"
            value={targetBucket}
            onChange={(event) => updateTargetBucket(event.target.value)}
            className={inputClass}
            placeholder="logs-bucket"
            disabled={notImplemented || loading || saving || clearing}
          />
        </label>
        <label className={labelClass}>
          Target prefix (optional)
          <input
            type="text"
            value={targetPrefix}
            onChange={(event) => updateTargetPrefix(event.target.value)}
            className={inputClass}
            placeholder="access-logs/"
            disabled={notImplemented || loading || saving || clearing}
          />
        </label>
      </div>
      <p className="settings-description">
        The target bucket must allow log delivery (e.g., ACL <code className="font-mono ui-caption">log-delivery-write</code>
        or an equivalent policy).
      </p>
    </BucketFeatureSection>
  );
}
