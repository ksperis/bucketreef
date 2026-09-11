/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { UserAvatarDescriptor, UserAvatarPreference } from "../../api/users";
import UserAvatar from "../../components/UserAvatar";
import { SettingsButton, SettingsDialog, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import { SettingsItem } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { profileError, type ProfileText } from "./profileMessages";

type UserAvatarDraft = { preference: UserAvatarPreference; file: File | null; remove: boolean };

export default function UserAvatarEditor({ avatar, name, email, text, disabled, readOnly, onSave, onDirtyChange, onBusyChange }: {
  avatar?: UserAvatarDescriptor | null; name?: string | null; email?: string | null; text: ProfileText;
  disabled?: boolean; readOnly?: boolean;
  onSave: (draft: UserAvatarDraft) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<UserAvatarDraft>({ preference: "auto", file: null, remove: false });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false), sourceInput = useRef<HTMLSelectElement>(null);
  const dirty = open && Boolean(draft.file || draft.remove || draft.preference !== (avatar?.preference ?? "auto"));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange(false); }, [onDirtyChange]);
  useEffect(() => () => { onBusyChange(false); }, [onBusyChange]);
  useEffect(() => {
    if (!draft.file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(draft.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.file]);
  const close = () => { setOpen(false); setDraft({ preference: "auto", file: null, remove: false }); setError(null); };
  const guard = useSettingsCloseGuard({ hasUnsavedChanges: dirty, onClose: close, disabled: busy,
    title: text("discardTitle"), description: text("discardDescription"), cancelLabel: text("keepEditing"),
    confirmLabel: text("discard"), closeLabel: text("close") });
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 1024 * 1024) { setError(text("imageFormat")); return; }
    setDraft({ preference: "uploaded", file, remove: false }); setError(null);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (savingRef.current || disabled || !dirty || readOnly) return;
    savingRef.current = true; setBusy(true); onBusyChange(true); setError(null);
    try { await onSave(draft); close(); }
    catch (failure) { setError(profileError(failure, text, "saveError")); }
    finally { savingRef.current = false; setBusy(false); onBusyChange(false); }
  };
  const preview: UserAvatarDescriptor | null | undefined = previewUrl && draft.preference === "uploaded"
    ? { preference: "uploaded", source: "uploaded", initials: avatar?.initials ?? "", url: previewUrl }
    : draft.preference === "initials" || draft.remove
      ? { preference: "initials", source: "initials", initials: avatar?.initials ?? "", url: null } : avatar;
  return <>
    <SettingsItem compact title={text("image")} icon={<UserAvatar avatar={avatar} name={name} email={email} size="md" decorative />}
      description={avatar?.source === "gravatar" ? "Gravatar" : text(avatar?.source ?? "initials")}
      action={!readOnly && <SettingsButton variant="secondary" disabled={disabled} aria-label={text("editImage")} onClick={() => {
        setDraft({ preference: avatar?.preference ?? "auto", file: null, remove: false }); setError(null); setOpen(true);
      }}>{text("edit")}</SettingsButton>} />
    {open && createPortal(<SettingsDialog title={text("editImage")} onClose={guard.requestClose} closeOnEscape={!busy}
      closeLabel={text("close")} closeAriaLabel={text("close")} initialFocusRef={sourceInput}>
      <form onSubmit={save} className="settings-form settings-stack">
        <div className="flex items-center gap-4"><UserAvatar avatar={preview} name={name} email={email} size="xl" title={text("image")} />
          <p className="settings-body text-[var(--ui-text-muted)]">{text("imageHelp")}</p></div>
        <UiSelect ref={sourceInput} label={text("imageSource")} value={draft.preference} disabled={busy}
          onChange={event => { setDraft(previous => ({ ...previous, preference: event.target.value as UserAvatarPreference, remove: false })); setError(null); }}>
          <option value="auto">{text("auto")}</option><option value="gravatar">Gravatar</option><option value="initials">{text("initials")}</option>
          {(avatar?.source === "uploaded" || draft.file) && <option value="uploaded">{text("uploaded")}</option>}
        </UiSelect>
        <p className="settings-body text-[var(--ui-text-muted)]">{text("autoImageHelp")}</p>
        <UiInput label={text("chooseImage")} type="file" accept="image/png,image/jpeg" disabled={busy} onChange={chooseFile} />
        {draft.file && <p className="break-all settings-body">{draft.file.name}</p>}
        {avatar?.source === "uploaded" && <SettingsButton variant="ghost" disabled={busy || draft.remove}
          onClick={() => setDraft({ preference: "auto", file: null, remove: true })}>{text("removeImage")}</SettingsButton>}
        {draft.remove && <p role="status" className="settings-body">{text("imageRemovedDraft")}</p>}
        {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
        <div className="flex flex-wrap justify-end gap-2">
          <SettingsButton variant="secondary" disabled={busy} onClick={guard.requestClose}>{text("cancel")}</SettingsButton>
          <SettingsButton type="submit" disabled={busy || !dirty}>{text(busy ? "saving" : "save")}</SettingsButton>
        </div>
      </form>
    </SettingsDialog>, document.body)}
    {guard.confirmationDialog}
  </>;
}
