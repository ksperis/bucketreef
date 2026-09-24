/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsButton, SettingsInput, SettingsSelect } from "../../../components/settings/SettingsControls";
import { SettingsItem, SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketObjectLockController } from "./useBucketObjectLockController";

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

  return (
    <BucketFeatureSection
      title="Object Lock"
      description="WORM / default retention."
      mode="graphical"
      visualState={visualState}
      successMessage={status}
      busy={saving || loading}
      testId="bucket-feature-object-lock"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SettingsButton
            type="button"
            onClick={reset}
            variant="secondary"
            disabled={loading || Boolean(loadError) || saving || !dirty}
          >
            Reset
          </SettingsButton>
          <SettingsButton
            type="submit"
            form={formId}
            disabled={saving || loading || Boolean(loadError) || !dirty}
            variant="primary"
          >
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        </div>
      }
    >
      <div className="space-y-2">
        {loading && <UiInlineMessage>Loading Object Lock configuration...</UiInlineMessage>}
        {loadError && <UiInlineMessage tone="error">{loadError}</UiInlineMessage>}
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        <form
          id={formId}
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <SettingsItem
            compact
            title="Enable Object Lock"
            description="Write-once retention controls for bucket objects."
            action={
              <SettingsSwitch
                checked={enabled ?? false}
                disabled={persistentlyEnabled || loading || Boolean(loadError) || notImplemented}
                ariaLabel="Enable object lock"
                onChange={(checked) => {
                  if (persistentlyEnabled) return;
                  updateEnabled(checked);
                  if (checked) onEnableVersioningDraft();
                }}
              />
            }
          />
          <p className={hintClass}>Enabling Object Lock automatically enables bucket versioning.</p>
          {persistentlyEnabled && (
            <p className={hintClass}>
              Object Lock cannot be disabled once it has been enabled on the bucket. Update only the default retention below.
            </p>
          )}
          {active ? (
            <>
              <UiInlineMessage tone="warning">
                Warning: while Object Lock is enabled, objects cannot be deleted until the specified retention period ends. Review mode and retention before saving changes.
              </UiInlineMessage>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <SettingsSelect
                  label="Mode"
                  value={mode}
                  onChange={(event) => updateMode(event.target.value)}
                  disabled={notImplemented}
                >
                  <option value="">(none)</option>
                  <option value="GOVERNANCE">Governance</option>
                  <option value="COMPLIANCE">Compliance</option>
                </SettingsSelect>
                <SettingsInput
                  label="Retention (days)"
                  type="number"
                  min={0}
                  step="1"
                  value={days}
                  onChange={(event) => updateDays(event.target.value)}
                  placeholder="e.g. 30"
                  disabled={notImplemented}
                />
                <SettingsInput
                  label="Retention (years)"
                  type="number"
                  min={0}
                  step="1"
                  value={years}
                  onChange={(event) => updateYears(event.target.value)}
                  placeholder="e.g. 1"
                  disabled={notImplemented}
                />
              </div>
              {configuration?.mode && (configuration.days != null || configuration.years != null) && (
                <p className={hintClass}>
                  Current retention: {configuration.mode}
                  {configuration.days != null ? ` · ${configuration.days} day(s)` : ""}
                  {configuration.years != null ? ` · ${configuration.years} year(s)` : ""}
                </p>
              )}
              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                Choose a mode plus days or years. Leave it empty to remove the default retention (Object Lock must already be enabled on the bucket).
              </p>
            </>
          ) : null}
        </form>
      </div>
    </BucketFeatureSection>
  );
}
