/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import Modal from "../../components/Modal";
import type { BrowserActionId, BrowserActionState } from "./browserActions";
import {
  bulkDangerClasses,
  toolbarButtonClasses,
  toolbarPrimaryClasses,
} from "./browserConstants";
import { DownloadIcon, MoreIcon, OpenIcon } from "./browserIcons";

type BrowserMobileSelectionActionsProps = {
  actions: BrowserActionState[];
  canDownload: boolean;
  canOpen: boolean;
  onDownload: () => void;
  onOpen: () => void;
  onRunAction: (actionId: BrowserActionId) => void;
  summary: string;
};

export default function BrowserMobileSelectionActions({
  actions,
  canDownload,
  canOpen,
  onDownload,
  onOpen,
  onRunAction,
  summary,
}: BrowserMobileSelectionActionsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div
        role="toolbar"
        aria-label="Selected object actions"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 gap-2 border-t border-slate-200 bg-white/95 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur dark:border-slate-700 dark:bg-slate-950/95"
      >
        <button
          type="button"
          className={`${toolbarButtonClasses} min-h-11 justify-center`}
          onClick={onOpen}
          disabled={!canOpen}
        >
          <OpenIcon className="h-4 w-4" />
          Open
        </button>
        <button
          type="button"
          className={`${toolbarPrimaryClasses} min-h-11 justify-center`}
          onClick={onDownload}
          disabled={!canDownload}
        >
          <DownloadIcon className="h-4 w-4" />
          Download
        </button>
        <button
          type="button"
          className={`${toolbarButtonClasses} min-h-11 justify-center`}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          <MoreIcon className="h-4 w-4" />
          More
        </button>
      </div>

      {sheetOpen && (
        <Modal
          title={summary}
          titleAs="h2"
          variant="bottom-sheet"
          onClose={() => setSheetOpen(false)}
          closeAriaLabel="Close actions"
        >
          <p className="mb-3 ui-caption text-[var(--ui-text-muted)]">
            Available actions for the current selection
          </p>
          <div className="grid gap-2">
            {actions
              .filter(
                (action) =>
                  action.id !== "open" && action.id !== "download",
              )
              .map((action) => (
                <button
                  key={action.id}
                  type="button"
                  aria-label={action.label}
                  className={`${action.id === "delete" ? bulkDangerClasses : toolbarButtonClasses} min-h-11 w-full justify-start`}
                  disabled={!action.enabled}
                  title={action.disabledReason}
                  onClick={() => {
                    onRunAction(action.id);
                    setSheetOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 text-left">
                    {action.label}
                  </span>
                  {!action.enabled && action.disabledReason && (
                    <span className="ml-3 max-w-[55%] text-right ui-caption font-normal text-[var(--ui-text-muted)]">
                      {action.disabledReason}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}
