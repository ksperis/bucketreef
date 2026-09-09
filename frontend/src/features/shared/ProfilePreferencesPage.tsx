/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { deleteCurrentUserAvatar, fetchCurrentUser, updateCurrentUser, uploadCurrentUserAvatar, type UserAvatarDescriptor, type UserAvatarPreference } from "../../api/users";
import { getWorkspaceAccess } from "../../api/executionContexts";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useLanguage, type UiLanguagePreference } from "../../components/language";
import { useTheme } from "../../components/theme";
import UserAvatar from "../../components/UserAvatar";
import { SettingsItem, SettingsSection, SettingsSwitch } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { readSelectorTagsPreference, writeSelectorTagsPreference } from "../../utils/selectorTagsPreference";
import { isAdminLikeRole, readStoredUser, readStoredWorkspaceId, resolveAvailableWorkspacesWithFlags, WORKSPACE_STORAGE_KEY, type WorkspaceId, type WorkspaceContextAvailability } from "../../utils/workspaces";
import { ProfileButton, ProfileDialog, useProfileDraftGuard } from "./ProfileControls";
import { profileError, useProfileI18n, type ProfileMessageKey } from "./profileMessages";
import { updateStoredUserProfile } from "./profileStoredUser";

type Preferences = {
  theme: "light" | "dark";
  language: UiLanguagePreference;
  workspace: WorkspaceId | null;
  tags: boolean;
  quotaAlerts: boolean;
  quotaWatch: boolean;
};

export default function ProfilePreferencesPage({ onUnsavedChangesChange }: { onUnsavedChangesChange?: (dirty: boolean) => void }) {
  const { text } = useProfileI18n();
  const { generalSettings } = useGeneralSettings();
  const { theme, setTheme } = useTheme();
  const observedTheme = useRef(theme);
  const nameInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLSelectElement>(null);
  const { languagePreference, setLanguagePreference } = useLanguage();
  const storedUser = useMemo(() => readStoredUser(), []);
  const isS3Session = storedUser?.authType === "s3_session";
  const canEditName = !isS3Session && generalSettings.allow_user_profile_name_edit;
  const canWatch = isAdminLikeRole(storedUser?.role);
  const [workspaceAccess, setWorkspaceAccess] = useState<WorkspaceContextAvailability>({ manager: false, browser: false, portal: false });
  const [workspaceLoading, setWorkspaceLoading] = useState(!isS3Session);
  const [workspaceError, setWorkspaceError] = useState(false);
  const workspaces = useMemo(() => resolveAvailableWorkspacesWithFlags(storedUser, generalSettings, isS3Session ? undefined : workspaceAccess), [storedUser, generalSettings, isS3Session, workspaceAccess]);
  const loadWorkspaces = useCallback(async () => {
    if (isS3Session) return;
    setWorkspaceLoading(true);
    setWorkspaceError(false);
    try {
      const access = await getWorkspaceAccess();
      setWorkspaceAccess({ manager: access.manager.available, browser: access.browser.available, portal: access.portal.available });
    } catch { setWorkspaceError(true); }
    finally { setWorkspaceLoading(false); }
  }, [isS3Session]);
  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);
  const [baseline, setBaseline] = useState<Preferences>(() => ({ theme, language: languagePreference, workspace: readStoredWorkspaceId(), tags: readSelectorTagsPreference(), quotaAlerts: true, quotaWatch: false }));
  const [draft, setDraft] = useState(baseline);
  useEffect(() => {
    const previousTheme = observedTheme.current;
    observedTheme.current = theme;
    setBaseline(previous => previous.theme === theme ? previous : { ...previous, theme });
    setDraft(previous => previous.theme !== previousTheme || previous.theme === theme ? previous : { ...previous, theme });
  }, [theme]);
  const [fullName, setFullName] = useState(storedUser?.full_name ?? "");
  const [avatar, setAvatar] = useState<UserAvatarDescriptor | null>(storedUser?.avatar ?? null);
  const [loading, setLoading] = useState(!isS3Session);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ProfileMessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<"name" | "avatar" | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [avatarPreference, setAvatarPreference] = useState<UserAvatarPreference>("auto");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const preferencesDirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const avatarDirty = Boolean(avatarFile || removeAvatar || avatarPreference !== (avatar?.preference ?? "auto"));
  const dialogDirty = dialog === "name" ? nameDraft !== fullName : dialog === "avatar" && avatarDirty;
  const unavailable = loading || loadError || saving;

  const load = useCallback(async () => {
    if (isS3Session) return;
    setLoading(true);
    setLoadError(false);
    try {
      const user = await fetchCurrentUser();
      setFullName(user.full_name ?? "");
      setAvatar(user.avatar ?? null);
      const serverPreferences = { language: user.ui_language ?? "auto" as const, quotaAlerts: user.quota_alerts_enabled !== false, quotaWatch: canWatch && Boolean(user.quota_alerts_global_watch) };
      setBaseline(previous => ({ ...previous, ...serverPreferences }));
      setDraft(previous => ({ ...previous, ...serverPreferences }));
      setLanguagePreference(user.ui_language ?? "auto");
      updateStoredUserProfile({ fullName: user.full_name, avatar: user.avatar, uiLanguage: user.ui_language });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [isS3Session, canWatch, setLanguagePreference]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (workspaceLoading || workspaceError) return;
    const normalize = (previous: Preferences) => {
      const workspace = workspaces.some(item => item.id === previous.workspace) ? previous.workspace : workspaces[0]?.id ?? null;
      return workspace === previous.workspace ? previous : { ...previous, workspace };
    };
    setBaseline(normalize);
    setDraft(normalize);
  }, [workspaces, workspaceLoading, workspaceError]);
  useEffect(() => { onUnsavedChangesChange?.(preferencesDirty || Boolean(dialogDirty) || saving); }, [preferencesDirty, dialogDirty, saving, onUnsavedChangesChange]);
  useEffect(() => {
    if (!avatarFile) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(avatarFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setAvatarFile(null);
    setRemoveAvatar(false);
    setError(null);
  }, []);
  const dialogGuard = useProfileDraftGuard({ hasUnsavedChanges: Boolean(dialogDirty), onClose: closeDialog, disabled: saving });
  const cancelPreferences = useCallback(() => { setDraft(baseline); setError(null); }, [baseline]);
  const preferencesGuard = useProfileDraftGuard({ hasUnsavedChanges: preferencesDirty, onClose: cancelPreferences, disabled: saving });
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setSuccess(null); setError(null); };
  const openDialog = (next: "name" | "avatar") => {
    setNameDraft(fullName);
    setAvatarPreference(avatar?.preference ?? "auto");
    setAvatarFile(null);
    setRemoveAvatar(false);
    setError(null);
    setSuccess(null);
    setDialog(next);
  };

  const savePreferences = async (event: FormEvent) => {
    event.preventDefault();
    if (!preferencesDirty || unavailable) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      let applied = { ...draft };
      if (!isS3Session) {
        // Commit server preferences before applying any local appearance changes.
        const updated = await updateCurrentUser({ ui_language: draft.language === "auto" ? null : draft.language, quota_alerts_enabled: draft.quotaAlerts, quota_alerts_global_watch: canWatch && draft.quotaWatch });
        applied = { ...applied, language: updated.ui_language ?? "auto", quotaAlerts: updated.quota_alerts_enabled !== false, quotaWatch: canWatch && Boolean(updated.quota_alerts_global_watch) };
        updateStoredUserProfile({ uiLanguage: updated.ui_language });
      }
      if (applied.workspace) writeClientStorage(WORKSPACE_STORAGE_KEY, applied.workspace);
      else removeClientStorage(WORKSPACE_STORAGE_KEY);
      writeSelectorTagsPreference(applied.tags);
      setTheme(applied.theme);
      setLanguagePreference(applied.language);
      setBaseline(applied);
      setDraft(applied);
      setSuccess("preferencesSaved");
    } catch (failure) {
      setError(profileError(failure, text, "saveError"));
    } finally { setSaving(false); }
  };

  const saveIdentity = async (event: FormEvent) => {
    event.preventDefault();
    if (unavailable || !dialogDirty || isS3Session) return;
    if (dialog === "name" && !canEditName) return;
    setSaving(true);
    setError(null);
    try {
      if (dialog === "name") {
        const updated = await updateCurrentUser({ full_name: nameDraft.trim() || null });
        setFullName(updated.full_name ?? "");
        updateStoredUserProfile({ fullName: updated.full_name });
        setSuccess("nameSaved");
      } else {
        const updated = avatarFile && avatarPreference === "uploaded" ? await uploadCurrentUserAvatar(avatarFile) : removeAvatar ? await deleteCurrentUserAvatar() : await updateCurrentUser({ avatar_preference: avatarPreference });
        setAvatar(updated.avatar ?? null);
        updateStoredUserProfile({ avatar: updated.avatar });
        setSuccess("imageSaved");
      }
      closeDialog();
    } catch (failure) { setError(profileError(failure, text, "saveError")); }
    finally { setSaving(false); }
  };
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 1024 * 1024) { setError(text("imageFormat")); return; }
    setAvatarFile(file);
    setRemoveAvatar(false);
    setAvatarPreference("uploaded");
    setError(null);
  };
  const previewAvatar: UserAvatarDescriptor | null = previewUrl && avatarPreference === "uploaded" ? { preference: "uploaded", source: "uploaded", initials: avatar?.initials ?? "", url: previewUrl } : avatarPreference === "initials" || removeAvatar ? { preference: "initials", source: "initials", initials: avatar?.initials ?? "", url: null } : avatar;
  const preferenceSwitch = (key: "tags" | "quotaAlerts" | "quotaWatch", label: ProfileMessageKey) => <SettingsSwitch checked={draft[key]} disabled={unavailable} onChange={value => change(key, value)} ariaLabel={text(label)} />;

  return (
    <div className="settings-compact settings-form">
      {loading && <p role="status" className="mb-3 text-sm text-[var(--ui-text-muted)]">{text("loading")}</p>}
      {loadError && <div className="mb-3"><UiInlineMessage tone="error" role="alert">{text("profileLoadError")}</UiInlineMessage><ProfileButton onClick={() => void load()}>{text("retry")}</ProfileButton></div>}
      <SettingsSection presentation="compact" title={text("identity")} description={text("identityHelp")}>
        <SettingsItem compact title={text("name")} description={<><span className="text-[var(--ui-text)]">{fullName || text("unknown")}</span>{!canEditName && <span className="block">{text("managedName")}</span>}</>} action={canEditName && <ProfileButton variant="secondary" disabled={unavailable} onClick={() => openDialog("name")} aria-label={text("editName")}>{text("edit")}</ProfileButton>} />
        <SettingsItem compact title={text("email")} description={storedUser?.email || text("unknown")} />
        <SettingsItem compact title={text("image")} icon={<UserAvatar avatar={avatar} name={fullName} email={storedUser?.email} size="md" decorative />} description={avatar?.source === "gravatar" ? "Gravatar" : text(avatar?.source ?? "initials")} action={!isS3Session && <ProfileButton variant="secondary" disabled={unavailable} onClick={() => openDialog("avatar")} aria-label={text("editImage")}>{text("edit")}</ProfileButton>} />
        {success && success !== "preferencesSaved" && <UiInlineMessage tone="success" role="status">{text(success)}</UiInlineMessage>}
      </SettingsSection>
      <form onSubmit={savePreferences} className="settings-preferences">
        <SettingsSection presentation="compact" title={text("display")} description={text("displayHelp")}>
          <SettingsItem compact title={text("language")} action={<UiSelect aria-label={text("language")} className="settings-control w-full sm:w-56" value={draft.language} disabled={unavailable} onChange={event => change("language", event.target.value as UiLanguagePreference)}><option value="auto">{text("browserAuto")}</option><option value="fr">Français</option><option value="en">English</option><option value="de">Deutsch</option></UiSelect>} />
          <SettingsItem compact title={text("theme")} description={text("localPreference")} action={<UiSelect aria-label={text("theme")} className="settings-control w-full sm:w-56" value={draft.theme} disabled={unavailable} onChange={event => change("theme", event.target.value as "light" | "dark")}><option value="light">{text("light")}</option><option value="dark">{text("dark")}</option></UiSelect>} />
          <SettingsItem compact title={text("workspace")} description={workspaceError ? <><span role="alert">{text("workspaceError")}</span><ProfileButton variant="ghost" onClick={() => void loadWorkspaces()}>{text("retry")}</ProfileButton></> : text("localPreference")} action={<UiSelect aria-label={text("workspace")} className="settings-control w-full sm:w-56" value={draft.workspace ?? ""} disabled={unavailable || workspaceLoading || workspaceError || !workspaces.length} onChange={event => change("workspace", event.target.value as WorkspaceId)}>{!workspaces.length && <option value="">{text(workspaceLoading ? "loading" : "noWorkspace")}</option>}{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{text(`workspace_${workspace.id}`)}</option>)}</UiSelect>} />
          <SettingsItem compact title={text("tags")} description={text("localPreference")} action={preferenceSwitch("tags", "tags")} />
        </SettingsSection>
        {!isS3Session && <SettingsSection presentation="compact" title={text("notifications")} description={text("notificationsHelp")}>
          <SettingsItem compact title={text("quotaAlerts")} action={preferenceSwitch("quotaAlerts", "quotaAlerts")} />
          {canWatch && <SettingsItem compact title={text("quotaWatch")} description={text("quotaWatchHelp")} action={preferenceSwitch("quotaWatch", "quotaWatch")} />}
        </SettingsSection>}
        {error && !dialog && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
        {success === "preferencesSaved" && <UiInlineMessage tone="success" role="status">{text(success)}</UiInlineMessage>}
        {preferencesDirty && <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--ui-border-soft)] py-3">
          <ProfileButton variant="secondary" disabled={saving} onClick={preferencesGuard.requestClose}>{text("cancel")}</ProfileButton>
          <ProfileButton type="submit" disabled={unavailable} aria-label={text("savePreferences")}>{text(saving ? "saving" : "save")}</ProfileButton>
        </div>}
      </form>
      {dialog && <ProfileDialog title={text(dialog === "name" ? "editName" : "editImage")} onClose={dialogGuard.requestClose} closeOnEscape={!saving} initialFocusRef={dialog === "name" ? nameInput : sourceInput}>
        <form onSubmit={saveIdentity} className="settings-form space-y-4">
          {dialog === "name" ? <UiInput ref={nameInput} label={text("name")} value={nameDraft} disabled={saving} maxLength={255} onChange={event => setNameDraft(event.target.value)} /> : <>
            <div className="flex items-center gap-4"><UserAvatar avatar={previewAvatar} name={fullName} email={storedUser?.email} size="xl" title={text("image")} /><p className="text-sm text-[var(--ui-text-muted)]">{text("imageHelp")}</p></div>
            <UiSelect ref={sourceInput} label={text("imageSource")} value={avatarPreference} disabled={saving} onChange={event => { setAvatarPreference(event.target.value as UserAvatarPreference); setRemoveAvatar(false); setError(null); }}>
              <option value="auto">{text("auto")}</option><option value="gravatar">Gravatar</option><option value="initials">{text("initials")}</option>{(avatar?.source === "uploaded" || avatarFile) && <option value="uploaded">{text("uploaded")}</option>}
            </UiSelect>
            <p className="text-sm text-[var(--ui-text-muted)]">{text("autoImageHelp")}</p>
            <UiInput label={text("chooseImage")} type="file" accept="image/png,image/jpeg" disabled={saving} onChange={chooseFile} />
            {avatarFile && <p className="break-all text-sm">{avatarFile.name}</p>}
            {avatar?.source === "uploaded" && <ProfileButton variant="ghost" disabled={saving || removeAvatar} onClick={() => { setRemoveAvatar(true); setAvatarFile(null); setAvatarPreference("auto"); }}>{text("removeImage")}</ProfileButton>}
            {removeAvatar && <p role="status" className="text-sm">{text("imageRemovedDraft")}</p>}
          </>}
          {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
          <div className="flex flex-wrap justify-end gap-2"><ProfileButton variant="secondary" disabled={saving} onClick={dialogGuard.requestClose}>{text("cancel")}</ProfileButton><ProfileButton type="submit" disabled={unavailable || !dialogDirty}>{text(saving ? "saving" : "save")}</ProfileButton></div>
        </form>
      </ProfileDialog>}
      {dialogGuard.confirmationDialog}{preferencesGuard.confirmationDialog}
    </div>
  );
}
