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
import { useBrowserI18n } from "./browserI18n";

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
  const { text } = useBrowserI18n();
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
    <SettingsFormDialog title={text("Restore to date")} draftKey={stableSignature(draft)}
      busy={loading} error={error} onSubmit={onApply} onClose={onClose}
      submitLabel={loading ? (draft.dryRun ? text("Previewing...") : text("Restoring...")) : draft.dryRun ? text("Preview changes") : text("Run restore")}
      maxWidthClass="max-w-2xl">
      <InlineSummary label={text("Targets")} items={[
        { label: text("Files"), value: fileCount },
        { label: text("Folders"), value: folderCount, hint: folderCount > 0 ? text("Folders use prefix history.") : undefined },
      ]} />
      {targetPath && <p className="settings-description break-all">{text("Path: {path}", { path: targetPath })}</p>}
      {summary && <UiInlineMessage tone="success" role="status">{summary}</UiInlineMessage>}
      <UiCheckboxField className="settings-choice" checked={draft.restoreDeleted}
        onChange={(event) => updateDraft("restoreDeleted", event.target.checked)}>
        {text("Restore deleted objects to their latest version")}</UiCheckboxField>
      <UiInput label={text("Target date")} type="datetime-local" value={draft.date}
        onChange={(event) => updateDraft("date", event.target.value)} disabled={draft.restoreDeleted}
        hint={draft.restoreDeleted ? text("Date is ignored while latest deleted-object restore is enabled.") : undefined} />
      <UiCheckboxField className="settings-choice" checked={draft.deleteMissing} disabled={draft.restoreDeleted}
        onChange={(event) => updateDraft("deleteMissing", event.target.checked)}>
        {text("Delete objects not present at the selected date")}</UiCheckboxField>
      <UiCheckboxField className="settings-choice" checked={draft.dryRun}
        onChange={(event) => updateDraft("dryRun", event.target.checked)}>
        {text("Dry run (preview only)")}</UiCheckboxField>
      {preview && <section aria-label={text("Restore preview")} className="settings-stack">
        <InlineSummary label={text("Preview")} items={[
          { label: text("Restore"), value: preview.totalRestore },
          { label: text("Delete"), value: preview.totalDelete },
          { label: text("Unchanged"), value: preview.totalUnchanged },
        ]} />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: text("Restore"), keys: preview.restoreKeys, total: preview.totalRestore },
            { label: text("Delete"), keys: preview.deleteKeys, total: preview.totalDelete },
            { label: text("Unchanged"), keys: preview.unchangedKeys, total: preview.totalUnchanged },
          ].map(({ label, keys, total }) => <div key={label} className="min-w-0 space-y-1">
            <h3 className="settings-label">{label}</h3>
            {keys.length === 0 ? <p className="settings-description">{text("No items")}</p> :
              <ul className="settings-description">{keys.map((key) =>
                <li key={key} className="break-all whitespace-pre-wrap">{key}</li>)}</ul>}
            {total > keys.length && <p className="settings-description">{text("+{count} more", { count: total - keys.length })}</p>}
          </div>)}
        </div>
      </section>}
      <p className="settings-description">
        {draft.restoreDeleted
          ? text("Restores deleted objects to their latest non-delete-marker version. Target date is ignored in this mode.")
          : text("Restores the latest version at or before the selected date. Objects with a delete marker at that date are skipped unless deletion is enabled or deleted-object restore is selected.")}
      </p>
    </SettingsFormDialog>
  );
}
