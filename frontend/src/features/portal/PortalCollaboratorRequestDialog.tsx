/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { SettingsButton, SettingsDialog } from "../../components/settings/SettingsControls";
import SettingsForm from "../../components/settings/SettingsForm";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiSelect from "../../components/ui/UiSelect";
import type { PortalRequestedRole } from "../../api/portalRequests";
import { extractApiError } from "../../utils/apiError";
import { PortalMemberIdentityFields } from "./PortalRequestFields";
import { portalAccountRoleLabel } from "./portalI18n";

export default function PortalCollaboratorRequestDialog({ initialName, initialEmail, onSubmit, onClose, onDraftStateChange }: {
  initialName: string;
  initialEmail: string;
  onSubmit: (payload: { targetName: string; targetEmail: string; portalRole: PortalRequestedRole }) => Promise<void>;
  onClose: () => void;
  onDraftStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [portalRole, setPortalRole] = useState<PortalRequestedRole>("portal_user");
  const [error, setError] = useState<string | null>(null);
  const initialFocus = useRef<HTMLElement | null>(null);
  const dirty = name !== initialName || email !== initialEmail || portalRole !== "portal_user";
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
        await onSubmit({ targetName: name.trim(), targetEmail: email.trim(), portalRole });
        close();
      } catch (cause) {
        setError(extractApiError(cause, controller.t({ en: "Unable to send the request.", fr: "Impossible d'envoyer la demande.", de: "Anfrage kann nicht gesendet werden.", zh: "无法发送请求。" })));
      }
    },
  });
  const { t, labels, locked, requestClose, submit, confirmationDialog, navigationGuard } = controller;
  useEffect(() => {
    onDraftStateChange?.({ dirty, busy: locked });
  }, [dirty, locked, onDraftStateChange]);
  useEffect(() => () => onDraftStateChange?.({ dirty: false, busy: false }), [onDraftStateChange]);
  const title = t({ en: "Request collaborator access", fr: "Demander l'ajout d'un collaborateur", de: "Mitwirkenden-Zugriff anfragen", zh: "申请添加协作者" });
  return createPortal(<>
    <SettingsDialog title={title} onClose={requestClose} closeDisabled={locked}
      initialFocusRef={initialFocus}
      closeOnBackdropClick={!locked} closeOnEscape={!locked} closeLabel={labels.close} closeAriaLabel={labels.close}>
      <SettingsForm label={title} presentation="dialog" busy={locked} submitDisabled={disabled}
        formRef={node => { initialFocus.current = node?.querySelector("input:not(:disabled)") ?? null; }}
        onSubmit={submit} onCancel={requestClose} noValidate={false}
        submitLabel={t({ en: "Send request", fr: "Envoyer la demande", de: "Anfrage senden", zh: "发送请求" })}
        busyLabel={t({ en: "Sending...", fr: "Envoi...", de: "Wird gesendet...", zh: "正在发送…" })}
        actions={<>
          <SettingsButton variant="secondary" disabled={locked} onClick={requestClose}>{labels.cancel}</SettingsButton>
          <SettingsButton type="submit" disabled={locked || disabled} loading={locked}>{locked
            ? t({ en: "Sending...", fr: "Envoi...", de: "Wird gesendet...", zh: "正在发送…" })
            : t({ en: "Send request", fr: "Envoyer la demande", de: "Anfrage senden", zh: "发送请求" })}</SettingsButton>
        </>}>
        <p className="settings-description">{t({
          en: portalRole === "portal_manager"
            ? "Ask an admin to add this person as a project manager. Once approved, they can access and manage every project space."
            : "Ask an admin to add this person to the project. Once they are added, you can invite them to the space.",
          fr: portalRole === "portal_manager"
            ? "Demandez à un admin d'ajouter cette personne comme gestionnaire du projet. Une fois la demande approuvée, elle pourra accéder à tous les espaces du projet et les gérer."
            : "Demandez à un admin d'ajouter cette personne au projet. Une fois ajoutée, vous pourrez l'inviter dans l'espace.",
          de: portalRole === "portal_manager"
            ? "Bitten Sie einen Admin, diese Person als Projektmanager hinzuzufügen. Nach der Genehmigung kann sie auf alle Projektbereiche zugreifen und sie verwalten."
            : "Bitten Sie einen Admin, diese Person zum Projekt hinzuzufügen. Danach können Sie sie in den Bereich einladen.",
          zh: portalRole === "portal_manager"
            ? "请让管理员将此人添加为项目管理员。获批后，此人可以访问并管理项目中的所有空间。"
            : "请让管理员将此人添加到项目。添加后，你就可以邀请其加入空间。",
        })}</p>
        <PortalMemberIdentityFields name={name} email={email} onNameChange={setName} onEmailChange={setEmail} />
        <UiSelect
          label={t({ en: "Project role", fr: "Rôle dans le projet", de: "Projektrolle", zh: "项目角色" })}
          value={portalRole}
          onChange={(event) => setPortalRole(event.target.value as PortalRequestedRole)}
          disabled={locked}
        >
          <option value="portal_user">{portalAccountRoleLabel("portal_user", t)}</option>
          <option value="portal_manager">{portalAccountRoleLabel("portal_manager", t)}</option>
        </UiSelect>
        {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
      </SettingsForm>
    </SettingsDialog>
    {confirmationDialog}
    {/* The enclosing workflow guards both drafts with one route blocker. */}
    {!onDraftStateChange && navigationGuard}
  </>, document.body);
}
