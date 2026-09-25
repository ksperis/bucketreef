/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import ModalActions from "../../../components/ModalActions";
import {
  SettingsButton,
  SettingsDialog,
  useSettingsCloseGuard,
} from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";

export default function BucketFeatureSettingsDialog({
  title,
  dirty,
  busy = false,
  error,
  saveLabel = "Save changes",
  saveDisabled = false,
  dangerAction,
  onSave,
  onClose,
  children,
  maxWidthClass = "max-w-2xl",
}: {
  title: string;
  dirty: boolean;
  busy?: boolean;
  error?: string | null;
  saveLabel?: string;
  saveDisabled?: boolean;
  dangerAction?: ReactNode;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
}) {
  const closeGuard = useSettingsCloseGuard({
    hasUnsavedChanges: dirty,
    disabled: busy,
    onClose,
  });

  return (
    <>
      <SettingsDialog
        title={title}
        onClose={closeGuard.requestClose}
        closeDisabled={busy}
        closeOnBackdropClick={!busy}
        closeOnEscape={!busy}
        maxWidthClass={maxWidthClass}
      >
        <div className="settings-stack">
          <fieldset className="settings-fields" disabled={busy}>
            {children}
          </fieldset>
          {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
          <ModalActions>
            {dangerAction ? <div className="mr-auto">{dangerAction}</div> : null}
            <SettingsButton
              type="button"
              variant="secondary"
              onClick={closeGuard.requestClose}
              disabled={busy}
            >
              Cancel
            </SettingsButton>
            <SettingsButton
              type="button"
              variant="primary"
              onClick={() => void onSave()}
              disabled={busy || saveDisabled || !dirty}
            >
              {busy ? "Saving..." : saveLabel}
            </SettingsButton>
          </ModalActions>
        </div>
      </SettingsDialog>
      {closeGuard.confirmationDialog}
    </>
  );
}
