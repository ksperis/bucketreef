/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import { stableSignature } from "../../utils/stableSignature";
import type { BrowserVersionCleanupDraft } from "./useBrowserVersionCleanup";

type BrowserCleanupModalProps = {
  currentPath: string;
  draft: BrowserVersionCleanupDraft;
  error: string | null;
  loading: boolean;
  onApply: () => void | Promise<void>;
  onClose: () => void;
  setDraft: Dispatch<SetStateAction<BrowserVersionCleanupDraft>>;
  summary: string | null;
};

export default function BrowserCleanupModal({
  currentPath,
  draft,
  error,
  loading,
  onApply,
  onClose,
  setDraft,
  summary,
}: BrowserCleanupModalProps) {
  const updateDraft = <Key extends keyof BrowserVersionCleanupDraft>(
    key: Key,
    value: BrowserVersionCleanupDraft[Key],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));

  return (
    <SettingsFormDialog title="Clean old versions" draftKey={stableSignature(draft)}
      busy={loading} error={error} onSubmit={onApply} onClose={onClose}
      submitLabel={loading ? "Cleaning..." : "Run cleanup"} danger maxWidthClass="max-w-2xl">
      <p className="settings-description break-all">
        Context: {currentPath || "Select a bucket to get started."}
      </p>
      {summary && <UiInlineMessage tone="success" role="status">{summary}</UiInlineMessage>}
      <UiInput label="Keep only the N most recent versions per object" type="number"
        min={1} inputMode="numeric" placeholder="e.g. 3" value={draft.keepLast}
        onChange={(event) => updateDraft("keepLast", event.target.value)} />
      <UiInput label="Delete versions older than (days)" type="number"
        min={1} inputMode="numeric" placeholder="e.g. 30" value={draft.olderThanDays}
        onChange={(event) => updateDraft("olderThanDays", event.target.value)} />
      <UiCheckboxField className="settings-choice" checked={draft.deleteOrphanMarkers}
        onChange={(event) => updateDraft("deleteOrphanMarkers", event.target.checked)}>
        Delete orphan delete markers (runs after version cleanup)
      </UiCheckboxField>
      <p className="settings-description">
        If multiple rules are set, versions matching any rule are removed. The latest version is never deleted.
      </p>
    </SettingsFormDialog>
  );
}
