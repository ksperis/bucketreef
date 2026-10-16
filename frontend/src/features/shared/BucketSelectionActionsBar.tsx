/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useRef, useState } from "react";

import { SettingsDialog, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import ModalActions from "../../components/ModalActions";
import ModalOptions from "../../components/ModalOptions";
import { ListActionButton } from "../../components/list/ListControls";
import UiActionMenu, { type UiActionMenuSection } from "../../components/ui/UiActionMenu";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { extractApiError } from "../../utils/apiError";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import ActionProgressCard from "./ActionProgressCard";
import type { ActionProgressState } from "./actionProgress";
import { bucketAction, BUCKET_ACTION_GROUP_LABELS } from "./bucketActionCatalog";
import type {
  BucketUiTagDefinition,
  BucketUiTagDefinitionPatch,
} from "../../api/bucketUiTags";
import BucketUiTagSettingsBadge from "./BucketUiTagSettingsBadge";
import {
  createBucketUiTagDrafts,
  type BucketUiTagDraft,
} from "./bucketOpsRowTagModel";
import { useSharedI18n } from "./sharedI18n";

type SelectionTagAction = "add" | "remove";
type SelectionExportFormat = "text" | "csv" | "json";

type BucketSelectionActionsBarProps = {
  selectedCount: number;
  hiddenSelectedCount: number;
  clearSelection: () => void;
  availableUiTags: BucketUiTagDefinition[];
  selectedUiTagSuggestions: BucketUiTagDefinition[];
  selectionTagAddInput: string;
  setSelectionTagAddInput: (value: string) => void;
  parsedSelectionTagAddInput: string[];
  selectionTagActionLoading: SelectionTagAction | null;
  applyUiTagToSelection: (
    tag: BucketUiTagDefinition | BucketUiTagDraft[],
    action: SelectionTagAction
  ) => Promise<string | null | void> | void;
  updateUiTagDefinition: (
    tag: BucketUiTagDefinition,
    changes: BucketUiTagDefinitionPatch
  ) => Promise<void> | void;
  updatingDefinitionIds: Set<number>;
  selectionExportLoading: SelectionExportFormat | null;
  exportSelectedBuckets: (format: SelectionExportFormat) => Promise<void> | void;
  selectionActionProgress?: ActionProgressState | null;
  isStorageOps: boolean;
  onShowConfigBackupModal?: () => void;
  onShowCompareModal: () => void;
  onShowIndexCheckModal?: () => void;
  onShowIntegrityModal: () => void;
  onShowPurgeModal?: () => void;
  onShowUsageStatsModal: () => void;
  openBulkUpdateModal: () => void;
};

export default function BucketSelectionActionsBar({
  selectedCount,
  hiddenSelectedCount,
  clearSelection,
  availableUiTags,
  selectedUiTagSuggestions,
  selectionTagAddInput,
  setSelectionTagAddInput,
  parsedSelectionTagAddInput,
  selectionTagActionLoading,
  applyUiTagToSelection,
  updateUiTagDefinition,
  updatingDefinitionIds,
  selectionExportLoading,
  exportSelectedBuckets,
  selectionActionProgress,
  isStorageOps,
  onShowConfigBackupModal,
  onShowCompareModal,
  onShowIndexCheckModal,
  onShowIntegrityModal,
  onShowPurgeModal,
  onShowUsageStatsModal,
  openBulkUpdateModal,
}: BucketSelectionActionsBarProps) {
  const { text: surfaceText } = useSharedI18n();
  const [dialog, setDialog] = useState<"tags" | "export" | null>(null);
  const [tagMode, setTagMode] = useState<SelectionTagAction>("add");
  const [customTagDrafts, setCustomTagDrafts] = useState<BucketUiTagDraft[]>([]);
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagPending, setTagPending] = useState(false);
  const tagSubmittingRef = useRef(false);
  const tagBusy = tagPending || selectionTagActionLoading !== null;
  const customTagDraftSequenceRef = useRef(0);

  const hasTagDraft = customTagDrafts.length > 0 || selectionTagAddInput.trim().length > 0;
  const closeTagDialog = () => {
    setDialog(null);
    setTagError(null);
    setCustomTagDrafts([]);
    setSelectionTagAddInput("");
  };
  const tagCloseGuard = useSettingsCloseGuard({
    hasUnsavedChanges: hasTagDraft,
    disabled: tagBusy,
    onClose: closeTagDialog,
  });
  const configureNewTags = () => {
    if (parsedSelectionTagAddInput.length === 0 || tagBusy) return;
    customTagDraftSequenceRef.current += 1;
    setCustomTagDrafts((current) => [
      ...current,
      ...createBucketUiTagDrafts(parsedSelectionTagAddInput, customTagDraftSequenceRef.current),
    ]);
    setSelectionTagAddInput("");
  };

  const applyTags = async (tag: BucketUiTagDefinition | BucketUiTagDraft[], action: SelectionTagAction) => {
    if (tagBusy || tagSubmittingRef.current) return;
    tagSubmittingRef.current = true;
    setTagPending(true);
    setTagError(null);
    try {
      const error = await applyUiTagToSelection(tag, action);
      if (error) {
        setTagError(error);
        return;
      }
      if (Array.isArray(tag)) {
        setCustomTagDrafts([]);
        if (!selectionTagAddInput.trim()) setDialog(null);
      } else if (!hasTagDraft) {
        setDialog(null);
      }
    } catch (error) {
      setTagError(extractApiError(error, surfaceText("Unable to update UI tags.")));
    } finally {
      tagSubmittingRef.current = false;
      setTagPending(false);
    }
  };

  if (selectedCount <= 0) return null;

  const surface = isStorageOps ? "storage-ops" : "ceph-admin";
  const action = (id: Parameters<typeof bucketAction>[0]) => {
    const descriptor = bucketAction(id);
    return { ...descriptor, label: surfaceText(descriptor.label) };
  };
  const indexSelectionAction = action("check-index-selection");
  const indexSelectionLimit = indexSelectionAction.maxSelection ?? 200;
  const runAndClose = (action: () => void) => {
    setDialog(null);
    action();
  };
  const sections: UiActionMenuSection[] = [
    {
      id: "selection",
      label: surfaceText(BUCKET_ACTION_GROUP_LABELS.selection),
      items: [
        { ...action("manage-tags"), onSelect: () => setDialog("tags") },
        { ...action("export-selection"), onSelect: () => setDialog("export") },
      ],
    },
    {
      id: "s3",
      label: surfaceText(BUCKET_ACTION_GROUP_LABELS.s3),
      items: [
        { ...action("configure-selection"), onSelect: openBulkUpdateModal },
        { ...action("check-integrity"), onSelect: onShowIntegrityModal },
        { ...action("calculate-stats"), onSelect: onShowUsageStatsModal },
        ...(!isStorageOps && onShowConfigBackupModal
          ? [{ ...action("backup-configs"), onSelect: onShowConfigBackupModal }]
          : []),
        ...(!isStorageOps ? [{ ...action("compare-buckets"), onSelect: onShowCompareModal }] : []),
      ],
    },
    ...(!isStorageOps && onShowIndexCheckModal
      ? [
          {
            id: "rgw",
            label: surfaceText(BUCKET_ACTION_GROUP_LABELS.rgw),
            items: [
              {
                ...indexSelectionAction,
                disabled: selectedCount > indexSelectionLimit,
                disabledReason: surfaceText("Bucket index checks are limited to {count} buckets. Narrow the selection to continue.", { count: indexSelectionLimit }),
                onSelect: onShowIndexCheckModal,
              },
            ],
          },
        ]
      : []),
    ...(onShowPurgeModal
      ? [
          {
            id: "destructive-s3",
            label: surfaceText(BUCKET_ACTION_GROUP_LABELS["destructive-s3"]),
            items: [{ ...action("purge-contents"), onSelect: onShowPurgeModal }],
          },
        ]
      : []),
  ];

  const tagOptions = tagMode === "add" ? availableUiTags : selectedUiTagSuggestions;

  return (
    <div className="ui-list-selection-bar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="ui-list-selection-summary">
            {surfaceText(
              selectedCount === 1 ? "{count} bucket selected" : "{count} buckets selected",
              { count: selectedCount },
            )}{hiddenSelectedCount > 0 && (
              <span className="ml-2 ui-caption font-semibold text-red-600 dark:text-red-400">
                {surfaceText(
                  hiddenSelectedCount === 1 ? " ({count} not visible)" : " ({count} not visible)",
                  { count: hiddenSelectedCount },
                )}</span>
            )}
          </p>
          <ListActionButton type="button" onClick={clearSelection} variant="secondary">
            {surfaceText("Clear selection")}</ListActionButton>
        </div>
        <UiActionMenu
          ariaLabel={surfaceText(
            selectedCount === 1 ? "Actions for {count} selected bucket" : "Actions for {count} selected buckets",
            { count: selectedCount },
          )}
          trigger={surfaceText("Actions…")}
          triggerClassName="ui-list-action ui-list-action-primary"
          sections={sections}
          minWidth={320}
          menuClassName="w-80"
        />
      </div>

      {selectionActionProgress && <ActionProgressCard progress={selectionActionProgress} busy className="mt-3" />}

      {dialog === "tags" && (
        <SettingsDialog title={surfaceText("Manage UI tags")} onClose={tagCloseGuard.requestClose}
          closeDisabled={tagBusy} closeOnEscape={!tagBusy} closeOnBackdropClick={!tagBusy} maxWidthClass="max-w-lg">
          <div className="settings-stack">
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {surfaceText(
                selectedCount === 1
                  ? "Update UI-only labels for {count} selected bucket in {surface}."
                  : "Update UI-only labels for {count} selected buckets in {surface}.",
                {
                  count: selectedCount,
                  surface: surface === "storage-ops" ? "Storage Ops" : "Ceph Admin",
                },
              )}
            </p>
            <UiSegmentedControl
              ariaLabel={surfaceText("UI tag operation")}
              value={tagMode}
              onChange={setTagMode}
              options={[
                { value: "add", label: surfaceText("Add tags"), disabled: tagBusy },
                { value: "remove", label: surfaceText("Remove tags"), disabled: tagBusy },
              ]}
            />
            <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-[color:var(--ui-border-soft)] p-2">
              {tagOptions.length === 0 ? (
                <p className={cx("px-2 py-3 ui-caption", uiMutedTextClass)}>
                  {surfaceText(tagMode === "add" ? "No existing UI tags yet." : "No UI tags found on this selection.")}
                </p>
              ) : (
                tagOptions.map((tag) => (
                  <div
                    key={`${tagMode}:${tag.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <BucketUiTagSettingsBadge
                      tag={tag}
                      isStorageOps={isStorageOps}
                      disabled={tagBusy || updatingDefinitionIds.has(tag.id)}
                      onChange={(changes) => updateUiTagDefinition(tag, changes)}
                    />
                    <UiButton
                      type="button" variant="secondary" size="sm"
                      disabled={tagBusy}
                      aria-label={surfaceText(tagMode === "add" ? "Add UI tag {tag}" : "Remove UI tag {tag}", { tag: tag.label })}
                      onClick={() => void applyTags(tag, tagMode)}
                    >
                      {surfaceText(tagMode === "add" ? "Add" : "Remove")}
                    </UiButton>
                  </div>
                ))
              )}
            </div>
            {tagMode === "add" && (
              <form className="settings-stack" aria-label={surfaceText("New UI tags")} onSubmit={(event) => {
                event.preventDefault();
                configureNewTags();
              }}>
                <label htmlFor="bucket-selection-custom-tag" className={cx("ui-caption font-semibold", uiTitleTextClass)}>
                  {surfaceText("New UI tags")}</label>
                {customTagDrafts.length > 0 && (
                  <div className="flex flex-wrap gap-2 rounded-md border border-[color:var(--ui-border-soft)] p-2">
                    {customTagDrafts.map((draft, index) => (
                      <BucketUiTagSettingsBadge
                        key={draft.draftId}
                        tag={draft}
                        isStorageOps={isStorageOps}
                        initiallyOpen={index === customTagDrafts.length - 1}
                        disabled={tagBusy}
                        onChange={(changes) =>
                          setCustomTagDrafts((current) =>
                            current.map((item) =>
                              item.draftId === draft.draftId
                                ? { ...item, ...changes }
                                : item
                            )
                          )
                        }
                        onRemove={() =>
                          setCustomTagDrafts((current) =>
                            current.filter((item) => item.draftId !== draft.draftId)
                          )
                        }
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <UiInput
                    id="bucket-selection-custom-tag"
                    type="text"
                    disabled={tagBusy}
                    value={selectionTagAddInput}
                    onChange={(event) => setSelectionTagAddInput(event.target.value)}
                    placeholder={surfaceText("new-tag")}
                    size="compact"
                    fieldClassName="min-w-0 flex-1"
                  />
                  <UiButton
                    type="submit"
                    size="sm"
                    disabled={parsedSelectionTagAddInput.length === 0 || tagBusy}
                  >
                    {surfaceText("Configure")}</UiButton>
                </div>
                {customTagDrafts.length > 0 && (
                  <div className="flex justify-end">
                    <UiButton
                      type="button"
                      size="sm"
                      disabled={tagBusy}
                      loading={tagBusy}
                      onClick={() => void applyTags(customTagDrafts, "add")}
                    >
                      {surfaceText(
                        customTagDrafts.length === 1 ? "Add {count} tag" : "Add {count} tags",
                        { count: customTagDrafts.length },
                      )}
                    </UiButton>
                  </div>
                )}
              </form>
            )}
            {selectionActionProgress && <ActionProgressCard progress={selectionActionProgress} busy />}
            {tagError && <UiInlineMessage tone="error" role="alert">{tagError}</UiInlineMessage>}
            <ModalActions>
              <UiButton variant="secondary" onClick={tagCloseGuard.requestClose} disabled={tagBusy}>{surfaceText("Close")}</UiButton>
            </ModalActions>
          </div>
        </SettingsDialog>
      )}

      {tagCloseGuard.confirmationDialog}
      <SettingsNavigationGuard dirty={dialog === "tags" && (hasTagDraft || tagBusy)} discardDisabled={tagBusy} onDiscard={closeTagDialog} />

      {dialog === "export" && (
        <SettingsDialog title={surfaceText("Export selection")} onClose={() => setDialog(null)} maxWidthClass="max-w-md">
          <div className="settings-stack">
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {surfaceText(
                selectedCount === 1
                  ? "Choose the output for {count} selected bucket."
                  : "Choose the output for {count} selected buckets.",
                { count: selectedCount },
              )}
            </p>
            <ModalOptions>
              {([
                ["text", "Text", "Bucket names only"],
                ["csv", "CSV", "Currently selected columns"],
                ["json", "JSON", "Currently selected columns"],
              ] as const).map(([format, label, helper]) => (
                <UiButton
                  key={format}
                  type="button"
                  variant="secondary"
                  disabled={selectionExportLoading !== null}
                  onClick={() => runAndClose(() => void exportSelectedBuckets(format))}
                >
                  <span className="modal-option-copy">
                    <span>{label}</span>
                    <span className="modal-option-description">{surfaceText(helper)}</span>
                  </span>
                </UiButton>
              ))}
            </ModalOptions>
            <ModalActions>
              <UiButton variant="secondary" onClick={() => setDialog(null)}>{surfaceText("Cancel")}</UiButton>
            </ModalActions>
          </div>
        </SettingsDialog>
      )}
    </div>
  );
}
