/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton, SettingsInput } from "../../../components/settings/SettingsControls";
import { SettingsAutocomplete } from "../../../components/settings/SettingsAutocomplete";
import { SettingsItem, SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import { useBucketFeatureSuggestions } from "./BucketFeatureSuggestions";
import BucketFeatureSettingsDialog from "./BucketFeatureSettingsDialog";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketAccessLoggingController } from "./useBucketAccessLoggingController";
import { useManagerI18n } from "../managerI18n";

type BucketAccessLoggingController = ReturnType<typeof useBucketAccessLoggingController>;

type BucketAccessLoggingFeatureProps = {
  controller: BucketAccessLoggingController;
  onRequestDisable: () => void;
};

export default function BucketAccessLoggingFeature({
  controller,
  onRequestDisable,
}: BucketAccessLoggingFeatureProps) {
  const { text } = useManagerI18n();
  const [editorOpen, setEditorOpen] = useState(false);
  const {
    clearing,
    configured,
    dirty,
    error,
    loading,
    loggingEnabled,
    reset,
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
  const { buckets } = useBucketFeatureSuggestions();
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: dirty,
  });
  const closeEditor = () => {
    reset();
    setEditorOpen(false);
  };

  return (
    <>
      <BucketFeatureSection
        title={text("Server access logging")}
        description={text("Deliver S3 access logs to another bucket.")}
        mode="graphical"
        visualState={visualState}
        stateLabel={dirty || notImplemented ? undefined : text(configured ? "Enabled" : "Inactive")}
        successMessage={status}
        busy={loading}
        testId="bucket-feature-access-logging"
      >
        {error ? <UiInlineMessage tone="error">{text(error)}</UiInlineMessage> : null}
        <div className="bucket-feature-summary-row">
          <div className={configured ? "bucket-feature-summary-value" : "bucket-feature-summary-muted"}>
            {configured ? (
              <>
                <strong>{targetBucket}</strong>
                <div className="bucket-feature-summary-muted font-mono">
                  {targetPrefix || text("No target prefix")}
                </div>
              </>
            ) : (
              "Server access logging is disabled."
            )}
          </div>
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={() => setEditorOpen(true)}
            disabled={notImplemented || loading || saving || clearing}
          >
            {text(configured ? "Edit" : "Configure")}
          </SettingsButton>
        </div>
      </BucketFeatureSection>

      {editorOpen ? (
        <BucketFeatureSettingsDialog
          title={text("Edit server access logging")}
          dirty={dirty}
          busy={saving || clearing}
          error={error}
          saveDisabled={notImplemented || loading}
          onSave={save}
          onClose={closeEditor}
          dangerAction={
            <SettingsButton
              type="button"
              onClick={onRequestDisable}
              disabled={notImplemented || clearing || !configured}
              variant="danger"
            >
              {text(clearing ? "Disabling..." : "Disable")}
            </SettingsButton>
          }
        >
          <SettingsItem
            compact
            title={text("Enable server access logging")}
            action={
              <SettingsSwitch
                ariaLabel={text("Enable server access logging")}
                checked={loggingEnabled}
                onChange={updateEnabled}
                disabled={notImplemented || loading || saving || clearing}
              />
            }
          />
          <div className="grid gap-3 md:grid-cols-2">
            <SettingsAutocomplete
              label={text("Target bucket")}
              value={targetBucket}
              onChange={updateTargetBucket}
              placeholder={text("logs-bucket")}
              disabled={notImplemented || loading || saving || clearing}
              {...buckets}
            />
            <SettingsInput
              label={text("Target prefix (optional)")}
              type="text"
              value={targetPrefix}
              onChange={(event) => updateTargetPrefix(event.target.value)}
              placeholder={text("access-logs/")}
              disabled={notImplemented || loading || saving || clearing}
            />
          </div>
          <p className="settings-description">
            {text("The target bucket must allow log delivery (for example ACL")}{" "}
            <code className="font-mono ui-caption">{text("log-delivery-write")}</code> {text("or an equivalent policy).")}
          </p>
        </BucketFeatureSettingsDialog>
      ) : null}
    </>
  );
}
