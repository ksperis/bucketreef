/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import UiInlineMessage from "../ui/UiInlineMessage";
import { SettingsButton, SettingsDialog } from "./SettingsControls";
import SettingsForm from "./SettingsForm";
import { useSettingsFormController } from "./useSettingsFormController";

/** Mount for one draft. Callers own validation, permissions and persistence. */
export default function SettingsFormDialog({
  title, draftKey, busy = false, disabled = false, submitDisabled = false, error, submitLabel,
  danger = false, completed = false, onSubmit, onClose, children,
  maxWidthClass = "max-w-lg", maxBodyHeightClass, className,
}: {
  title: string;
  draftKey: string;
  busy?: boolean;
  disabled?: boolean;
  submitDisabled?: boolean;
  error?: string | null;
  submitLabel: string;
  danger?: boolean;
  completed?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  /** Navigation already has a destination; close without rewriting the URL. */
  onClose: (reason?: "navigation") => void;
  children: ReactNode;
  maxWidthClass?: string;
  maxBodyHeightClass?: string;
  className?: string;
}) {
  const [baseline] = useState(draftKey);
  const initialFocus = useRef<HTMLElement | null>(null);
  const { t, labels, locked, requestClose, submit, confirmationDialog, navigationGuard } = useSettingsFormController({
    dirty: baseline !== draftKey, busy, disabled, completed, onSubmit, onClose,
  });

  return <>
    <SettingsDialog title={title} onClose={requestClose} closeDisabled={locked}
      closeOnBackdropClick={!locked} closeOnEscape={!locked} closeLabel={labels.close}
      closeAriaLabel={labels.close} initialFocusRef={initialFocus}
      maxWidthClass={maxWidthClass} maxBodyHeightClass={maxBodyHeightClass} className={className}>
      <SettingsForm label={title} onSubmit={submit} presentation="dialog" noValidate={false}
        busy={locked} disabled={disabled}
        submitDisabled={submitDisabled || completed || baseline === draftKey} onCancel={requestClose}
        submitLabel={submitLabel} busyLabel={submitLabel}
        formRef={(node) => {
          initialFocus.current = node?.querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? null;
        }}
        actions={<>
          <SettingsButton variant="secondary" onClick={requestClose} disabled={locked}>
            {completed ? t({ en: "Done", fr: "Terminer", de: "Fertig", zh: "完成" }) : labels.cancel}
          </SettingsButton>
          {!completed && <SettingsButton type="submit" variant={danger ? "danger" : "primary"}
            disabled={locked || disabled || submitDisabled || baseline === draftKey} loading={locked}>{submitLabel}</SettingsButton>}
        </>}>
        {children}
        {error ? <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage> : null}
      </SettingsForm>
    </SettingsDialog>
    {confirmationDialog}
    {navigationGuard}
  </>;
}
