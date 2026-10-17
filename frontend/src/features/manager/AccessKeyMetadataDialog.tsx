/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { FormEvent, useEffect, useRef, useState } from "react";

import { SettingsDialog, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import SettingsForm from "../../components/settings/SettingsForm";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import {
  ACCESS_KEY_NAME_MAX_LENGTH,
  ACCESS_KEY_NOTES_MAX_LENGTH,
  type AccessKeyMetadataInput,
} from "../../api/accessKeyContracts";
import { useManagerI18n } from "./managerI18n";

function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

type Props = {
  mode: "create" | "edit";
  initial?: AccessKeyMetadataInput;
  metadataEnabled?: boolean;
  expirationEnabled?: boolean;
  expirationLockedReason?: string | null;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (metadata: AccessKeyMetadataInput) => Promise<void> | void;
};

export default function AccessKeyMetadataDialog({
  mode,
  initial,
  metadataEnabled = true,
  expirationEnabled = false,
  expirationLockedReason,
  busy,
  error,
  onClose,
  onSubmit,
}: Props) {
  const { text } = useManagerI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [expiresAt, setExpiresAt] = useState(toLocalDateTimeInput(initial?.expires_at));
  const nameRef = useRef<HTMLInputElement>(null);
  const expirationRef = useRef<HTMLInputElement>(null);
  const initialName = initial?.name ?? "";
  const initialNotes = initial?.notes ?? "";
  const initialExpiration = toLocalDateTimeInput(initial?.expires_at);
  const expirationVisible = expirationEnabled || Boolean(initial?.expires_at);
  const expirationEditable = expirationEnabled && !expirationLockedReason;
  const dirty = (metadataEnabled && (name !== initialName || notes !== initialNotes))
    || (expirationEditable && expiresAt !== initialExpiration);
  const closeGuard = useSettingsCloseGuard({ hasUnsavedChanges: dirty, disabled: busy, onClose });

  useEffect(() => {
    setName(initial?.name ?? "");
    setNotes(initial?.notes ?? "");
    setExpiresAt(toLocalDateTimeInput(initial?.expires_at));
  }, [initial?.name, initial?.notes, initial?.expires_at]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: AccessKeyMetadataInput = {};
    if (metadataEnabled) {
      payload.name = name.trim() || null;
      payload.notes = notes.trim() || null;
    }
    if (expirationEditable) {
      payload.expires_at = expiresAt ? new Date(expiresAt).toISOString() : null;
    }
    void onSubmit(payload);
  };

  const creating = mode === "create";
  return (
    <>
    <SettingsDialog
      title={creating ? text("Create access key") : text("Edit access-key details")}
      onClose={closeGuard.requestClose}
      closeDisabled={busy}
      closeOnBackdropClick={!busy}
      closeOnEscape={!busy}
      initialFocusRef={metadataEnabled ? nameRef : expirationRef}
      maxWidthClass="max-w-xl"
    >
      <SettingsForm
        label={creating ? text("Create access key") : text("Edit access-key details")}
        presentation="dialog"
        busy={busy}
        onSubmit={submit}
        onCancel={closeGuard.requestClose}
        submitLabel={creating ? text("Create key") : text("Save details")}
        busyLabel={creating ? text("Creating...") : text("Saving...")}
      >
        <div className="settings-fields">
          {metadataEnabled && (
            <>
              <UiInput
                ref={nameRef}
                label={text("Name")}
                value={name}
                maxLength={ACCESS_KEY_NAME_MAX_LENGTH}
                placeholder={text("backup-service")}
                hint={text("Optional short label for the application or workload using this key.")}
                onChange={(event) => setName(event.target.value)}
              />
              <UiTextarea
                label={text("Notes")}
                value={notes}
                maxLength={ACCESS_KEY_NOTES_MAX_LENGTH}
                rows={5}
                placeholder={text("Used by the nightly backup job for project data.")}
                hint={text("Optional. Name and notes are stored in BucketReef.")}
                onChange={(event) => setNotes(event.target.value)}
              />
            </>
          )}
          {expirationVisible && (
            <>
              {!expirationEditable && (
                <UiInlineMessage tone={expirationLockedReason ? "warning" : "info"}>
                  {expirationLockedReason
                    ?? "This key already has an expiration. Re-enable Access-key expiration for this context to change it."}
                </UiInlineMessage>
              )}
              <UiInput
                ref={expirationRef}
                type="datetime-local"
                label={text("Expiration date and time")}
                value={expiresAt}
                disabled={!expirationEditable}
                min={toLocalDateTimeInput(new Date().toISOString())}
                hint={
                  <>
                    {expirationEditable && <span className="block">{text("Automatically disables the key, usually within one minute after expiration.")}</span>}
                    {text("Optional. The time is interpreted in your browser's local timezone. Clear the field to remove the expiration.")}
                  </>
                }
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </>
          )}
          {error && <UiInlineMessage tone="error" role="alert">{text(error)}</UiInlineMessage>}
        </div>
      </SettingsForm>
    </SettingsDialog>
    {closeGuard.confirmationDialog}
    </>
  );
}
