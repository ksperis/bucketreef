/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton, SettingsInput } from "../../../components/settings/SettingsControls";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import BucketFeatureSettingsDialog from "./BucketFeatureSettingsDialog";
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
  const [editorOpen, setEditorOpen] = useState(false);
  const {
    add,
    clearing,
    configured,
    dirty,
    error,
    loading,
    remove,
    reset,
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
  const closeEditor = () => {
    reset();
    setEditorOpen(false);
  };
  const visibleTags = tags.filter((tag) => tag.key !== "" || tag.value !== "");

  return (
    <>
      <BucketFeatureSection
        title="Bucket tags"
        description="S3 key/value metadata attached to the bucket."
        mode="graphical"
        visualState={visualState}
        stateLabel={dirty ? undefined : configured ? `${visibleTags.length} ${visibleTags.length === 1 ? "tag" : "tags"}` : "Inactive"}
        successMessage={status}
        busy={loading}
        testId="bucket-feature-tags"
      >
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        {loading ? (
          <UiInlineMessage>Loading bucket tags...</UiInlineMessage>
        ) : (
          <div className="bucket-feature-summary-row">
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {visibleTags.length === 0 ? (
                <span className="bucket-feature-summary-muted">No tags configured on this bucket.</span>
              ) : (
                <>
                  {visibleTags.slice(0, 3).map((tag) => (
                    <UiBadge key={tag.uiId} tone="neutral">
                      {tag.key}={tag.value}
                    </UiBadge>
                  ))}
                  {visibleTags.length > 3 ? <UiBadge tone="neutral">+{visibleTags.length - 3}</UiBadge> : null}
                </>
              )}
            </div>
            <SettingsButton
              type="button"
              variant="secondary"
              onClick={() => setEditorOpen(true)}
              disabled={notImplemented || loading || saving || clearing}
            >
              {configured ? "Edit" : "Configure"}
            </SettingsButton>
          </div>
        )}
      </BucketFeatureSection>

      {editorOpen ? (
        <BucketFeatureSettingsDialog
          title="Edit bucket tags"
          dirty={dirty}
          busy={saving || clearing}
          error={error}
          onSave={save}
          onClose={closeEditor}
          dangerAction={
          <SettingsButton
            type="button"
            onClick={onRequestClear}
            variant="danger"
            disabled={notImplemented || loading || saving || clearing || tags.length === 0}
          >
            {clearing ? "Clearing..." : "Clear"}
          </SettingsButton>
          }
        >
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
        </BucketFeatureSettingsDialog>
      ) : null}
    </>
  );
}
