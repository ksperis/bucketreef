/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton, SettingsInput, SettingsSelect } from "../../../components/settings/SettingsControls";
import { SettingsItem, SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import BucketFeatureSettingsDialog from "./BucketFeatureSettingsDialog";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketObjectLockController } from "./useBucketObjectLockController";
import { useManagerI18n } from "../managerI18n";

type BucketObjectLockController = ReturnType<typeof useBucketObjectLockController>;

type BucketObjectLockFeatureProps = {
  controller: BucketObjectLockController;
  onEnableVersioningDraft: () => void;
};

const formId = "bucket-object-lock-form";
const hintClass = "settings-description";

export default function BucketObjectLockFeature({
  controller,
  onEnableVersioningDraft,
}: BucketObjectLockFeatureProps) {
  const { text } = useManagerI18n();
  const [editorOpen, setEditorOpen] = useState(false);
  const {
    active,
    configuration,
    days,
    dirty,
    enabled,
    error,
    loadError,
    loading,
    mode,
    persistentlyEnabled,
    reset,
    save,
    saving,
    status,
    updateDays,
    updateEnabled,
    updateMode,
    updateYears,
    years,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(loadError);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured: persistentlyEnabled,
    unsaved: dirty,
  });
  const closeEditor = () => {
    reset();
    setEditorOpen(false);
  };
  const retentionSummary = configuration?.mode && (configuration.days != null || configuration.years != null)
    ? `${configuration.mode}${configuration.days != null ? ` · ${configuration.days} day(s)` : ""}${configuration.years != null ? ` · ${configuration.years} year(s)` : ""}`
    : text("No default retention policy.");

  return (
    <>
      <BucketFeatureSection
        title={text("Object Lock")}
        description={text("WORM retention and legal-hold prerequisites.")}
        mode="graphical"
        visualState={visualState}
        stateLabel={dirty ? undefined : text(persistentlyEnabled ? "Enabled" : "Inactive")}
        successMessage={status}
        busy={loading}
        testId="bucket-feature-object-lock"
      >
        {loading && <UiInlineMessage>{text("Loading Object Lock configuration...")}</UiInlineMessage>}
        {loadError && <UiInlineMessage tone="error">{text(loadError)}</UiInlineMessage>}
        <div className="bucket-feature-summary-row">
          <div className={persistentlyEnabled ? "bucket-feature-summary-value" : "bucket-feature-summary-muted"}>
            {persistentlyEnabled ? retentionSummary : text("No default retention policy.")}
          </div>
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={() => setEditorOpen(true)}
            disabled={loading || Boolean(loadError) || notImplemented}
          >
            {text(persistentlyEnabled ? "Edit" : "Configure")}
          </SettingsButton>
        </div>
      </BucketFeatureSection>

      {editorOpen ? (
        <BucketFeatureSettingsDialog
          title={text("Configure Object Lock")}
          dirty={dirty}
          busy={saving}
          error={error}
          saveDisabled={loading || Boolean(loadError)}
          onSave={save}
          onClose={closeEditor}
        >
          <div id={formId} className="space-y-2">
          <SettingsItem
            compact
            title={text("Enable Object Lock")}
            description={text("Write-once retention controls for bucket objects.")}
            action={
              <SettingsSwitch
                checked={enabled ?? false}
                disabled={persistentlyEnabled || loading || Boolean(loadError) || notImplemented}
                ariaLabel={text("Enable object lock")}
                onChange={(checked) => {
                  if (persistentlyEnabled) return;
                  updateEnabled(checked);
                  if (checked) onEnableVersioningDraft();
                }}
              />
            }
          />
          <p className={hintClass}>{text("Enabling Object Lock automatically enables bucket versioning.")}</p>
          {persistentlyEnabled && (
            <p className={hintClass}>
              {text("Object Lock cannot be disabled once it has been enabled on the bucket. Update only the default retention below.")}
            </p>
          )}
          {active ? (
            <>
              <UiInlineMessage tone="warning">
                {text("Warning: while Object Lock is enabled, objects cannot be deleted until the specified retention period ends. Review mode and retention before saving changes.")}
              </UiInlineMessage>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <SettingsSelect
                  label={text("Mode")}
                  value={mode}
                  onChange={(event) => updateMode(event.target.value)}
                  disabled={notImplemented}
                >
                  <option value="">{text("(none)")}</option>
                  <option value="GOVERNANCE">{text("Governance")}</option>
                  <option value="COMPLIANCE">{text("Compliance")}</option>
                </SettingsSelect>
                <SettingsInput
                  label={text("Retention (days)")}
                  type="number"
                  min={0}
                  step="1"
                  value={days}
                  onChange={(event) => updateDays(event.target.value)}
                  placeholder={text("e.g. 30")}
                  disabled={notImplemented}
                />
                <SettingsInput
                  label={text("Retention (years)")}
                  type="number"
                  min={0}
                  step="1"
                  value={years}
                  onChange={(event) => updateYears(event.target.value)}
                  placeholder={text("e.g. 1")}
                  disabled={notImplemented}
                />
              </div>
              {configuration?.mode && (configuration.days != null || configuration.years != null) && (
                <p className={hintClass}>
                  {text("Current retention:")} {configuration.mode}
                  {configuration.days != null ? ` · ${configuration.days} day(s)` : ""}
                  {configuration.years != null ? ` · ${configuration.years} year(s)` : ""}
                </p>
              )}
              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                {text("Choose a mode plus days or years. Leave it empty to remove the default retention (Object Lock must already be enabled on the bucket).")}
              </p>
            </>
          ) : null}
          </div>
        </BucketFeatureSettingsDialog>
      ) : null}
    </>
  );
}
