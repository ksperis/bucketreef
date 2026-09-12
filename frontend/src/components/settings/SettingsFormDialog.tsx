/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import UiInlineMessage from "../ui/UiInlineMessage";
import { useI18n } from "../../i18n";
import { SettingsButton, SettingsDialog, useSettingsCloseGuard } from "./SettingsControls";
import SettingsNavigationGuard from "./SettingsNavigationGuard";
import SettingsForm from "./SettingsForm";
import { settingsLabels } from "./settingsLabels";

/** Mount for one draft. Callers own validation, permissions and persistence. */
export default function SettingsFormDialog({
  title, draftKey, busy = false, disabled = false, error, submitLabel,
  danger = false, completed = false, onSubmit, onClose, children,
  maxWidthClass = "max-w-lg", maxBodyHeightClass,
}: {
  title: string;
  draftKey: string;
  busy?: boolean;
  disabled?: boolean;
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
}) {
  const { t } = useI18n();
  const labels = settingsLabels(t);
  const [baseline] = useState(draftKey);
  const [closing, setClosing] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const initialFocus = useRef<HTMLElement | null>(null);
  const locked = busy || pending;
  const dirty = !completed && !closing && baseline !== draftKey;
  const guardLabels = {
    title: labels.discardTitle,
    description: labels.discardDescription,
    confirmLabel: labels.discard,
    cancelLabel: labels.keepEditing,
    closeLabel: labels.close,
  };
  const close = () => {
    // A close handler may remove a URL query parameter. Do not guard it twice.
    flushSync(() => setClosing(true));
    onClose();
  };
  const guard = useSettingsCloseGuard({
    hasUnsavedChanges: dirty, disabled: locked, onClose: close, ...guardLabels,
  });
  const requestClose = () => { if (!submitting.current) guard.requestClose(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked || disabled || completed || submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      await onSubmit(event);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return <>
    <SettingsDialog title={title} onClose={requestClose} closeDisabled={locked}
      closeOnBackdropClick={!locked} closeOnEscape={!locked} closeLabel={labels.close}
      closeAriaLabel={labels.close} initialFocusRef={initialFocus}
      maxWidthClass={maxWidthClass} maxBodyHeightClass={maxBodyHeightClass}>
      <SettingsForm label={title} onSubmit={submit} presentation="dialog" noValidate={false}
        busy={locked} submitDisabled={disabled || completed} onCancel={requestClose}
        submitLabel={submitLabel} busyLabel={submitLabel}
        formRef={(node) => {
          initialFocus.current = node?.querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? null;
        }}
        actions={<>
          <SettingsButton variant="secondary" onClick={requestClose} disabled={locked}>
            {completed ? t({ en: "Done", fr: "Terminer", de: "Fertig" }) : labels.cancel}
          </SettingsButton>
          {!completed && <SettingsButton type="submit" variant={danger ? "danger" : "primary"}
            disabled={locked || disabled} loading={locked}>{submitLabel}</SettingsButton>}
        </>}>
        {children}
        {error ? <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage> : null}
      </SettingsForm>
    </SettingsDialog>
    {guard.confirmationDialog}
    <SettingsNavigationGuard dirty={dirty || locked} discardDisabled={locked}
      onDiscard={() => onClose("navigation")} {...guardLabels}
      title={locked ? t({ en: "Operation in progress", fr: "Opération en cours", de: "Vorgang läuft" }) : guardLabels.title}
      description={locked ? t({
        en: "Wait for the operation to finish before leaving this page.",
        fr: "Attendez la fin de l’opération avant de quitter cette page.",
        de: "Warten Sie, bis der Vorgang abgeschlossen ist, bevor Sie diese Seite verlassen.",
      }) : guardLabels.description} />
  </>;
}
