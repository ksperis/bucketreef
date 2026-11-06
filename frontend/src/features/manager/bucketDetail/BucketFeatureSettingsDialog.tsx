/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  SettingsButton,
  SettingsDialog,
  useSettingsCloseGuard,
} from "../../../components/settings/SettingsControls";
import SettingsForm from "../../../components/settings/SettingsForm";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { useManagerI18n } from "../managerI18n";

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
  const { text } = useManagerI18n();
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
        <SettingsForm
          label={title}
          busy={busy}
          submitDisabled={saveDisabled || !dirty}
          onSubmit={() => onSave()}
          onCancel={closeGuard.requestClose}
          submitLabel={text(saveLabel)}
          busyLabel={text("Saving...")}
          presentation="dialog"
          actions={<>
            {dangerAction ? <div className="mr-auto">{dangerAction}</div> : null}
            <SettingsButton
              type="button"
              variant="secondary"
              onClick={closeGuard.requestClose}
              disabled={busy}
            >
              {text("Cancel")}
            </SettingsButton>
            <SettingsButton
              type="submit"
              variant="primary"
              disabled={busy || saveDisabled || !dirty}
            >
              {text(busy ? "Saving..." : saveLabel)}
            </SettingsButton>
          </>}
        >
          {children}
          {error ? <UiInlineMessage tone="error">{text(error)}</UiInlineMessage> : null}
        </SettingsForm>
      </SettingsDialog>
      {closeGuard.confirmationDialog}
    </>
  );
}
