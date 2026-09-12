/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n";
import { useSettingsCloseGuard } from "./SettingsControls";
import SettingsNavigationGuard from "./SettingsNavigationGuard";
import { settingsLabels } from "./settingsLabels";

/** One close, navigation and submission contract for editable pages and dialogs. */
export function useSettingsFormController({
  dirty, busy = false, disabled = false, completed = false, onSubmit, onClose,
}: {
  dirty: boolean;
  busy?: boolean;
  disabled?: boolean;
  completed?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: (reason?: "navigation") => void;
}) {
  const { t } = useI18n();
  const labels = settingsLabels(t);
  const [closing, setClosing] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const locked = busy || pending;
  const unsaved = dirty && !completed && !closing;
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
    hasUnsavedChanges: unsaved, disabled: locked, onClose: close, ...guardLabels,
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

  return {
    t, labels, locked, requestClose, submit,
    confirmationDialog: guard.confirmationDialog,
    navigationGuard: (<SettingsNavigationGuard dirty={unsaved || locked} discardDisabled={locked}
      onDiscard={() => onClose("navigation")} {...guardLabels}
      title={locked ? t({ en: "Operation in progress", fr: "Opération en cours", de: "Vorgang läuft" }) : guardLabels.title}
      description={locked ? t({
        en: "Wait for the operation to finish before leaving this page.",
        fr: "Attendez la fin de l’opération avant de quitter cette page.",
        de: "Warten Sie, bis der Vorgang abgeschlossen ist, bevor Sie diese Seite verlassen.",
      }) : guardLabels.description} />),
  };
}
