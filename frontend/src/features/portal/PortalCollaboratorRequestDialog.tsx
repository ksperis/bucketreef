/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { SettingsButton, SettingsDialog } from "../../components/settings/SettingsControls";
import SettingsForm from "../../components/settings/SettingsForm";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { extractApiError } from "../../utils/apiError";
import { PortalMemberIdentityFields } from "./PortalRequestFields";

export default function PortalCollaboratorRequestDialog({ initialName, initialEmail, onSubmit, onClose, onDraftStateChange }: {
  initialName: string;
  initialEmail: string;
  onSubmit: (payload: { targetName: string; targetEmail: string }) => Promise<void>;
  onClose: () => void;
  onDraftStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const initialFocus = useRef<HTMLElement | null>(null);
  const dirty = name !== initialName || email !== initialEmail;
  const disabled = !name.trim() || !email.trim();
  const close = () => {
    // Enable the invitation's trigger before Modal restores focus to it.
    if (onDraftStateChange) flushSync(() => onDraftStateChange({ dirty: false, busy: false }));
    onClose();
  };
  const controller = useSettingsFormController({
    dirty, disabled, onClose: close,
    onSubmit: async () => {
      setError(null);
      try {
        await onSubmit({ targetName: name.trim(), targetEmail: email.trim() });
        close();
      } catch (cause) {
        setError(extractApiError(cause, controller.t({ en: "Unable to send the request.", fr: "Impossible d'envoyer la demande.", de: "Anfrage kann nicht gesendet werden." })));
      }
    },
  });
  const { t, labels, locked, requestClose, submit, confirmationDialog, navigationGuard } = controller;
  useEffect(() => {
    onDraftStateChange?.({ dirty, busy: locked });
  }, [dirty, locked, onDraftStateChange]);
  useEffect(() => () => onDraftStateChange?.({ dirty: false, busy: false }), [onDraftStateChange]);
  const title = t({ en: "Request collaborator access", fr: "Demander l'ajout d'un collaborateur", de: "Mitwirkenden-Zugriff anfragen" });
  return createPortal(<>
    <SettingsDialog title={title} onClose={requestClose} closeDisabled={locked}
      initialFocusRef={initialFocus}
      closeOnBackdropClick={!locked} closeOnEscape={!locked} closeLabel={labels.close} closeAriaLabel={labels.close}>
      <SettingsForm label={title} presentation="dialog" busy={locked} submitDisabled={disabled}
        formRef={node => { initialFocus.current = node?.querySelector("input:not(:disabled)") ?? null; }}
        onSubmit={submit} onCancel={requestClose} noValidate={false}
        submitLabel={t({ en: "Send request", fr: "Envoyer la demande", de: "Anfrage senden" })}
        busyLabel={t({ en: "Sending...", fr: "Envoi...", de: "Wird gesendet..." })}
        actions={<>
          <SettingsButton variant="secondary" disabled={locked} onClick={requestClose}>{labels.cancel}</SettingsButton>
          <SettingsButton type="submit" disabled={locked || disabled} loading={locked}>{locked
            ? t({ en: "Sending...", fr: "Envoi...", de: "Wird gesendet..." })
            : t({ en: "Send request", fr: "Envoyer la demande", de: "Anfrage senden" })}</SettingsButton>
        </>}>
        <p className="settings-description">{t({
          en: "Ask an admin to add this person to the project. Once they are added, you can invite them to the space.",
          fr: "Demandez à un admin d'ajouter cette personne au projet. Une fois ajoutée, vous pourrez l'inviter dans l'espace.",
          de: "Bitten Sie einen Admin, diese Person zum Projekt hinzuzufügen. Danach können Sie sie in den Bereich einladen.",
        })}</p>
        <PortalMemberIdentityFields name={name} email={email} onNameChange={setName} onEmailChange={setEmail} />
        {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
      </SettingsForm>
    </SettingsDialog>
    {confirmationDialog}
    {/* The enclosing workflow guards both drafts with one route blocker. */}
    {!onDraftStateChange && navigationGuard}
  </>, document.body);
}
