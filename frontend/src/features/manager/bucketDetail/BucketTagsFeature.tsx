/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsButton, SettingsInput } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketTagsController } from "./useBucketTagsController";

type BucketTagsController = ReturnType<typeof useBucketTagsController>;

type BucketTagsFeatureProps = {
  controller: BucketTagsController;
  onRequestClear: () => void;
};

export default function BucketTagsFeature({
  controller,
  onRequestClear,
}: BucketTagsFeatureProps) {
  const {
    add,
    clearing,
    configured,
    dirty,
    error,
    loading,
    remove,
    save,
    saving,
    status,
    tags,
    update,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: dirty,
  });

  return (
    <BucketFeatureSection
      title="Bucket tags"
      description="S3 key/value tags associated with this bucket."
      mode="graphical"
      visualState={visualState}
      successMessage={status}
      busy={saving || clearing || loading}
      testId="bucket-feature-tags"
      actions={
        <div className="flex flex-wrap gap-2">
          <SettingsButton
            type="button"
            onClick={onRequestClear}
            variant="danger"
            disabled={notImplemented || loading || saving || clearing || tags.length === 0}
          >
            {clearing ? "Clearing..." : "Clear"}
          </SettingsButton>
          <SettingsButton
            type="button"
            onClick={save}
            variant="primary"
            disabled={notImplemented || loading || saving || clearing || !dirty}
          >
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        </div>
      }
    >
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      {loading ? (
        <UiInlineMessage>Loading bucket tags...</UiInlineMessage>
      ) : (
        <div className="space-y-2">
          {tags.length === 0 && (
            <p className="settings-description">No tags configured on this bucket.</p>
          )}
          {tags.map((tag) => (
            <div
              key={tag.uiId}
              data-tag-row
              className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <SettingsInput
                type="text"
                value={tag.key}
                aria-label="Tag key"
                onChange={(event) => update(tag.uiId, { key: event.target.value })}
                placeholder="Tag key"
                disabled={notImplemented || saving || clearing}
              />
              <SettingsInput
                type="text"
                value={tag.value}
                aria-label="Tag value"
                onChange={(event) => update(tag.uiId, { value: event.target.value })}
                placeholder="Tag value"
                disabled={notImplemented || saving || clearing}
              />
              <SettingsButton
                type="button"
                onClick={() => remove(tag.uiId)}
                variant="secondary"
                disabled={notImplemented || saving || clearing}
              >
                Remove
              </SettingsButton>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <SettingsButton
              type="button"
              onClick={add}
              variant="secondary"
              disabled={notImplemented || saving || clearing}
            >
              Add tag
            </SettingsButton>
            <p className="settings-description">Tag keys must be unique and cannot be empty.</p>
          </div>
        </div>
      )}
    </BucketFeatureSection>
  );
}
