/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";
import InlineSummary from "../../components/InlineSummary";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import { stableSignature } from "../../utils/stableSignature";
import type { BrowserBulkRestoreDraft, BrowserBulkRestorePreview } from "./useBrowserBulkRestore";

type BrowserBulkRestoreModalProps = {
  draft: BrowserBulkRestoreDraft;
  error: string | null;
  fileCount: number;
  folderCount: number;
  loading: boolean;
  onApply: () => void | Promise<void>;
  onClose: () => void;
  preview?: BrowserBulkRestorePreview | null;
  setDraft: Dispatch<SetStateAction<BrowserBulkRestoreDraft>>;
  summary: string | null;
  targetPath?: string | null;
};

export default function BrowserBulkRestoreModal({
  draft,
  error,
  fileCount,
  folderCount,
  loading,
  onApply,
  onClose,
  preview,
  setDraft,
  summary,
  targetPath,
}: BrowserBulkRestoreModalProps) {
  const updateDraft = <Key extends keyof BrowserBulkRestoreDraft>(
    key: Key,
    value: BrowserBulkRestoreDraft[Key],
  ) =>
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "restoreDeleted" && value === true
        ? { deleteMissing: false }
        : {}),
    }));

  return (
    <SettingsFormDialog title="Restore to date" draftKey={stableSignature(draft)}
      busy={loading} error={error} onSubmit={onApply} onClose={onClose}
      submitLabel={loading ? (draft.dryRun ? "Previewing..." : "Restoring...") : draft.dryRun ? "Preview changes" : "Run restore"}
      maxWidthClass="max-w-2xl">
      <InlineSummary label="Targets" items={[
        { label: "Files", value: fileCount },
        { label: "Folders", value: folderCount, hint: folderCount > 0 ? "Folders use prefix history." : undefined },
      ]} />
      {targetPath && <p className="settings-description break-all">Path: {targetPath}</p>}
      {summary && <UiInlineMessage tone="success" role="status">{summary}</UiInlineMessage>}
      <UiCheckboxField className="settings-choice" checked={draft.restoreDeleted}
        onChange={(event) => updateDraft("restoreDeleted", event.target.checked)}>
        Restore deleted objects to their latest version
      </UiCheckboxField>
      <UiInput label="Target date" type="datetime-local" value={draft.date}
        onChange={(event) => updateDraft("date", event.target.value)} disabled={draft.restoreDeleted}
        hint={draft.restoreDeleted ? "Date is ignored while latest deleted-object restore is enabled." : undefined} />
      <UiCheckboxField className="settings-choice" checked={draft.deleteMissing} disabled={draft.restoreDeleted}
        onChange={(event) => updateDraft("deleteMissing", event.target.checked)}>
        Delete objects not present at the selected date
      </UiCheckboxField>
      <UiCheckboxField className="settings-choice" checked={draft.dryRun}
        onChange={(event) => updateDraft("dryRun", event.target.checked)}>
        Dry run (preview only)
      </UiCheckboxField>
      {preview && <section aria-label="Restore preview" className="settings-stack">
        <InlineSummary label="Preview" items={[
          { label: "Restore", value: preview.totalRestore },
          { label: "Delete", value: preview.totalDelete },
          { label: "Unchanged", value: preview.totalUnchanged },
        ]} />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Restore", keys: preview.restoreKeys, total: preview.totalRestore },
            { label: "Delete", keys: preview.deleteKeys, total: preview.totalDelete },
            { label: "Unchanged", keys: preview.unchangedKeys, total: preview.totalUnchanged },
          ].map(({ label, keys, total }) => <div key={label} className="min-w-0 space-y-1">
            <h3 className="settings-label">{label}</h3>
            {keys.length === 0 ? <p className="settings-description">No items</p> :
              <ul className="settings-description">{keys.map((key) =>
                <li key={key} className="break-all whitespace-pre-wrap">{key}</li>)}</ul>}
            {total > keys.length && <p className="settings-description">+{total - keys.length} more</p>}
          </div>)}
        </div>
      </section>}
      <p className="settings-description">
        {draft.restoreDeleted
          ? "Restores deleted objects to their latest non-delete-marker version. Target date is ignored in this mode."
          : "Restores the latest version at or before the selected date. Objects with a delete marker at that date are skipped unless deletion is enabled or deleted-object restore is selected."}
      </p>
    </SettingsFormDialog>
  );
}
