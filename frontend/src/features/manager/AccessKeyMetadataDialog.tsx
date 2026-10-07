/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { FormEvent, useEffect, useRef, useState } from "react";

import { SettingsDialog, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import SettingsForm from "../../components/settings/SettingsForm";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";

export type AccessKeyMetadataDraft = { name?: string | null; notes?: string | null };

type Props = {
  mode: "create" | "edit";
  initial?: AccessKeyMetadataDraft;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (metadata: AccessKeyMetadataDraft) => Promise<void> | void;
};

export default function AccessKeyMetadataDialog({ mode, initial, busy, error, onClose, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const nameRef = useRef<HTMLInputElement>(null);
  const initialName = initial?.name ?? "";
  const initialNotes = initial?.notes ?? "";
  const dirty = name !== initialName || notes !== initialNotes;
  const closeGuard = useSettingsCloseGuard({ hasUnsavedChanges: dirty, disabled: busy, onClose });

  useEffect(() => {
    setName(initial?.name ?? "");
    setNotes(initial?.notes ?? "");
  }, [initial?.name, initial?.notes]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit({
      name: name.trim() || null,
      notes: notes.trim() || null,
    });
  };

  const creating = mode === "create";
  return (
    <>
    <SettingsDialog
      title={creating ? "Create access key" : "Edit access-key details"}
      onClose={closeGuard.requestClose}
      closeDisabled={busy}
      closeOnBackdropClick={!busy}
      closeOnEscape={!busy}
      initialFocusRef={nameRef}
      maxWidthClass="max-w-xl"
    >
      <SettingsForm
        label={creating ? "Create access key" : "Edit access-key details"}
        presentation="dialog"
        busy={busy}
        onSubmit={submit}
        onCancel={closeGuard.requestClose}
        submitLabel={creating ? "Create key" : "Save details"}
        busyLabel={creating ? "Creating..." : "Saving..."}
      >
        <div className="settings-fields">
          <UiInlineMessage tone="info">
            Name and notes are stored only in BucketReef. They do not change the S3/IAM credential or its permissions.
          </UiInlineMessage>
          <UiInput
            ref={nameRef}
            label="Name"
            value={name}
            maxLength={128}
            placeholder="backup-service"
            hint="Optional short label for the application or workload using this key."
            onChange={(event) => setName(event.target.value)}
          />
          <UiTextarea
            label="Notes"
            value={notes}
            maxLength={2000}
            rows={5}
            placeholder="Used by the nightly backup job for project data."
            hint="Optional description of who uses the key and what it is used for."
            onChange={(event) => setNotes(event.target.value)}
          />
          {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
        </div>
      </SettingsForm>
    </SettingsDialog>
    {closeGuard.confirmationDialog}
    </>
  );
}
