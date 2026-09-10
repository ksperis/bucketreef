/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ModalActions from "../../components/ModalActions";
import { useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import { updatePortalStorageSpace } from "../../api/portal";
import { SettingsButton, SettingsDialog, SettingsField, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import { settingsLabels } from "../../components/settings/settingsLabels";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";

export default function StorageSpaceIdentityDialog({ accountId, space, onClose, onSaved, onDirtyChange }: {
  accountId: S3AccountSelector; space: PortalWorkspaceSpace; onClose: () => void;
  onSaved: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const labels = settingsLabels(t);
  const { draft, setDraft, baseline, dirty } = useSettingsDraft({ name: space.name, description: space.description });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; description?: string; save?: string }>({});
  const formRef = useRef<HTMLFormElement | null>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const guard = useSettingsCloseGuard({ hasUnsavedChanges: dirty, disabled: busy, onClose,
    title: labels.discardTitle, description: labels.discardDescription,
    confirmLabel: labels.discard, cancelLabel: labels.keepEditing, closeLabel: labels.close });
  const save = async () => {
    if (pending.current || !dirty) return;
    const name = draft.name.trim().replace(/\s+/g, " ");
    const invalid = {
      name: space.nameEditable && (!name || draft.name.length > 120)
        ? t({ en: "Enter a name of 1–120 characters.", fr: "Saisissez un nom de 1 à 120 caractères.", de: "Geben Sie einen Namen mit 1–120 Zeichen ein." }) : undefined,
      description: draft.description.length > 2000
        ? t({ en: "Use at most 2,000 characters.", fr: "Utilisez au maximum 2 000 caractères.", de: "Verwenden Sie höchstens 2.000 Zeichen." }) : undefined,
    };
    setErrors(invalid);
    if (Object.values(invalid).some(Boolean)) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    pending.current = true; setBusy(true);
    try {
      await updatePortalStorageSpace(accountId, space.id, {
        ...(space.nameEditable && name !== baseline.name ? { name } : {}),
        ...(draft.description !== baseline.description ? { description: draft.description.trim() || null } : {}),
      });
      if (!active.current) return;
      onSaved(); onClose();
    } catch (cause) {
      if (active.current) setErrors({ save: extractApiError(cause, t({ en: "Unable to update this space. Your changes are preserved.", fr: "Impossible de modifier cet espace. Vos saisies sont conservées.", de: "Dieser Bereich konnte nicht aktualisiert werden. Ihre Eingaben bleiben erhalten." })) });
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <>
    <SettingsDialog title={t({ en: "Edit space details", fr: "Modifier les détails de l’espace", de: "Bereichsdetails bearbeiten" })}
      onClose={guard.requestClose} initialFocusRef={focusRef} closeLabel={labels.close} closeAriaLabel={labels.close}
      closeOnBackdropClick={!busy} closeOnEscape={!busy}>
      <form ref={(node) => { formRef.current = node; focusRef.current = node?.querySelector('input:not([disabled])') ?? null; }}
        noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} className="settings-stack">
        <label className="block settings-label">{t({ en: "Space name", fr: "Nom de l’espace", de: "Name des Bereichs" })}
          {space.nameEditable ? <SettingsField label={t({ en: "Space name", fr: "Nom de l’espace", de: "Name des Bereichs" })}
            value={draft.name} disabled={busy} maxLength={120} error={errors.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            : <span className="settings-readonly block">{space.name} — {t({ en: "Name locked for this space", fr: "Nom verrouillé pour cet espace", de: "Name für diesen Bereich gesperrt" })}</span>}
        </label>
        <label className="block settings-label">{t({ en: "Space description", fr: "Description de l’espace", de: "Beschreibung des Bereichs" })}
          <SettingsField label={t({ en: "Space description", fr: "Description de l’espace", de: "Beschreibung des Bereichs" })}
            value={draft.description} disabled={busy} maxLength={2000} error={errors.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        {errors.save && <UiInlineMessage tone="error" role="alert">{errors.save}</UiInlineMessage>}
        <ModalActions>
          <SettingsButton variant="secondary" disabled={busy} onClick={guard.requestClose}>{labels.cancel}</SettingsButton>
          <SettingsButton type="submit" disabled={!dirty || busy} loading={busy}>{t({ en: "Save", fr: "Enregistrer", de: "Speichern" })}</SettingsButton>
        </ModalActions>
      </form>
    </SettingsDialog>
    {guard.confirmationDialog}
  </>;
}
