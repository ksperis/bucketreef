/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";

import type {
  BucketUiTagDefinition,
  BucketUiTagDefinitionPatch,
  BucketUiTagVisibility,
} from "../../api/bucketUiTags";
import {
  UiTagBadge,
  UiTagColorPalette,
  UiTagScopeSettings,
  UiTagSettingsPopover,
} from "../../components/UiTagSettings";
import UiButton from "../../components/ui/UiButton";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import { uiLabelClass } from "../../components/ui/styles";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import type { BucketUiTagDraft } from "./bucketOpsRowTagModel";
import { useSharedI18n } from "./sharedI18n";

type ConfigurableBucketUiTag = BucketUiTagDefinition | BucketUiTagDraft;

type BucketUiTagSettingsBadgeProps = {
  tag: ConfigurableBucketUiTag;
  isStorageOps: boolean;
  disabled?: boolean;
  initiallyOpen?: boolean;
  onChange: (
    changes: BucketUiTagDefinitionPatch
  ) => void | BucketUiTagDefinition | Promise<void | BucketUiTagDefinition>;
  onRemove?: () => void;
  onCommit?: () => void | Promise<void>;
  className?: string;
};

const isPersisted = (
  tag: ConfigurableBucketUiTag
): tag is BucketUiTagDefinition => "id" in tag;

export default function BucketUiTagSettingsBadge({
  tag,
  isStorageOps,
  disabled = false,
  initiallyOpen = false,
  onChange,
  onRemove,
  onCommit,
  className,
}: BucketUiTagSettingsBadgeProps) {
  const { text: surfaceText } = useSharedI18n();
  const [open, setOpen] = useState(initiallyOpen);
  const [saving, setSaving] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const visibilityConfirmation = useConfirmActionDialog();
  const persisted = isPersisted(tag);
  const busy = disabled || saving || visibilityConfirmation.isConfirming;

  useEffect(() => {
    if (initiallyOpen) setOpen(true);
  }, [initiallyOpen]);

  const applyChange = async (changes: BucketUiTagDefinitionPatch) => {
    if (busy) return;
    setSaving(true);
    try {
      await onChange(changes);
    } catch {
      // The owning hook surfaces the request error in the workbench banner.
    } finally {
      setSaving(false);
    }
  };

  const changeVisibility = (visibility: BucketUiTagVisibility) => {
    if (visibility === tag.visibility || busy || isStorageOps) return;
    if (!persisted) {
      void applyChange({ visibility });
      return;
    }
    const toShared = visibility === "shared";
    visibilityConfirmation.requestConfirmation({
      title: surfaceText("Change UI tag visibility?"),
      description: toShared
        ? surfaceText("This UI tag will become visible and configurable to every Ceph Admin.")
        : surfaceText("This UI tag will become private to your Ceph Admin account."),
      confirmLabel: surfaceText(toShared ? "Make shared" : "Make private"),
      details: [
        { label: surfaceText("UI tag"), value: tag.label },
        { label: surfaceText("Current visibility"), value: surfaceText(tag.visibility === "shared" ? "Shared" : "Private") },
        { label: surfaceText("New visibility"), value: surfaceText(toShared ? "Shared" : "Private") },
      ],
      impacts: [
        surfaceText("The definition identifier and every existing bucket association will be preserved."),
        toShared
          ? surfaceText("Other Ceph Admins will see this tag and may change its settings.")
          : surfaceText("Other Ceph Admins will no longer see this tag."),
      ],
      onConfirm: () => applyChange({ visibility }),
      zIndexClass: "z-[100]",
    });
  };

  return (
    <>
      <span ref={anchorRef}>
        <UiTagBadge
          label={tag.label}
          colorKey={tag.color_key}
          visibility={tag.visibility}
          active={open}
          disabled={busy}
          className={className}
          onClick={() => setOpen((current) => !current)}
          onRemove={onRemove}
          removeAriaLabel={surfaceText("Remove UI tag {tag}, {visibility}", {
            tag: tag.label,
            visibility: surfaceText(tag.visibility === "shared" ? "Shared" : "Private"),
          })}
        />
      </span>
      <UiTagSettingsPopover
        open={open && !visibilityConfirmation.isConfirming}
        anchorRef={anchorRef}
        label={tag.label}
        colorKey={tag.color_key}
        visibility={tag.visibility}
        description={
          surfaceText(persisted
            ? tag.visibility === "shared"
              ? "Shared UI tag. Every Ceph Admin can use and configure it."
              : isStorageOps
                ? "Private UI tag. It is visible only to your Storage Ops account."
                : "Private UI tag. It is visible only to your Ceph Admin account."
            : "This new UI tag stays local until you add it.")
        }
        onDismiss={() => setOpen(false)}
        footer={
          !persisted && onCommit ? (
            <div className="flex justify-end border-t border-slate-200 pt-3 dark:border-slate-700">
              <UiButton
                type="button"
                size="sm"
                disabled={busy}
                loading={saving}
                onClick={() => void onCommit()}
              >
                {surfaceText("Add tag")}</UiButton>
            </div>
          ) : undefined
        }
      >
        <UiTagColorPalette
          label={tag.label}
          value={tag.color_key}
          disabled={busy}
          onChange={(color_key) => applyChange({ color_key })}
        />
        {!isStorageOps && (
          <div className="space-y-2">
            <span className={uiLabelClass}>{surfaceText("Visibility")}</span>
            <UiSegmentedControl
              ariaLabel={surfaceText("Visibility for UI tag {tag}", { tag: tag.label })}
              value={tag.visibility}
              onChange={changeVisibility}
              options={[
                { value: "private", label: surfaceText("Private"), disabled: busy },
                { value: "shared", label: surfaceText("Shared"), disabled: busy },
              ]}
            />
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {surfaceText("Private tags belong to one Ceph Admin. Shared tags are available to every Ceph Admin.")}</p>
          </div>
        )}
        <UiTagScopeSettings
          value="standard"
          readOnly
          help={surfaceText("Bucket UI tags always use the Standard scope.")}
        />
      </UiTagSettingsPopover>
      {visibilityConfirmation.confirmationDialog}
    </>
  );
}
