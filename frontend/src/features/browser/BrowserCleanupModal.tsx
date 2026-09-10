/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ModalActions from "../../components/ModalActions";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Modal from "../../components/Modal";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { browserPanelCardClasses, formInputClasses } from "./browserConstants";
import UiButton from "../../components/ui/UiButton";
import { stableSignature } from "../../utils/stableSignature";
import type { BrowserVersionCleanupDraft } from "./useBrowserVersionCleanup";

type BrowserCleanupModalProps = {
  currentPath: string;
  draft: BrowserVersionCleanupDraft;
  error: string | null;
  loading: boolean;
  onApply: () => void;
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
  const currentSignature = useMemo(
    () => stableSignature(draft),
    [draft],
  );
  const [initialSignature] = useState(currentSignature);
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: currentSignature !== initialSignature,
    onClose,
    disabled: loading,
  });
  const updateDraft = <Key extends keyof BrowserVersionCleanupDraft>(
    key: Key,
    value: BrowserVersionCleanupDraft[Key],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));

  return (
    <Modal title="Clean old versions" onClose={closeGuard.requestClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4 ui-caption text-slate-600 dark:text-slate-300">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Context</p>
          <p className="break-all">{currentPath || "Select a bucket to get started."}</p>
        </div>
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        {summary && <UiInlineMessage tone="success">{summary}</UiInlineMessage>}
        <div className={browserPanelCardClasses}>
          <label className="ui-caption font-semibold text-slate-500 dark:text-slate-400">
            Keep only the N most recent versions per object
          </label>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className={`${formInputClasses} mt-2`}
            value={draft.keepLast}
            onChange={(event) => updateDraft("keepLast", event.target.value)}
            placeholder="e.g. 3"
          />
          <label className="mt-3 ui-caption font-semibold text-slate-500 dark:text-slate-400">
            Delete versions older than (days)
          </label>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className={`${formInputClasses} mt-2`}
            value={draft.olderThanDays}
            onChange={(event) => updateDraft("olderThanDays", event.target.value)}
            placeholder="e.g. 30"
          />
          <UiCheckboxField
            checked={draft.deleteOrphanMarkers}
            onChange={(event) => updateDraft("deleteOrphanMarkers", event.target.checked)}
            className="mt-3 ui-caption text-slate-500 dark:text-slate-400"
          >
            Delete orphan delete markers (runs after version cleanup)
          </UiCheckboxField>
        </div>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          If multiple rules are set, versions matching any rule are removed. The latest version is never deleted.
        </p>
        <ModalActions>
          <UiButton variant="secondary" onClick={closeGuard.requestClose}>
            Cancel
          </UiButton>
          <UiButton
            type="button"
            onClick={onApply}
            disabled={loading}
          >
            {loading ? "Cleaning..." : "Run cleanup"}
          </UiButton>
        </ModalActions>
      </div>
      {closeGuard.confirmationDialog}
    </Modal>
  );
}
