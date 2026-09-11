/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { deleteCurrentUserAvatar, fetchCurrentUser, updateCurrentUser, uploadCurrentUserAvatar, type UserAvatarDescriptor } from "../../api/users";
import { getWorkspaceAccess } from "../../api/executionContexts";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useLanguage, type UiLanguagePreference } from "../../components/language";
import { useTheme } from "../../components/theme";
import UserAvatarEditor from "./UserAvatarEditor";
import { UserLanguageField, UserNotificationFields } from "./UserProfilePreferenceFields";
import { SettingsActions } from "../../components/settings/SettingsControls";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
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
  const { baseline, setBaseline, draft, setDraft, dirty: preferencesDirty } = useSettingsDraft<Preferences>(() => ({ theme, language: languagePreference, workspace: readStoredWorkspaceId(), tags: readSelectorTagsPreference(), quotaAlerts: true, quotaWatch: false }));
  useEffect(() => {
    const previousTheme = observedTheme.current;
    observedTheme.current = theme;
    setBaseline(previous => previous.theme === theme ? previous : { ...previous, theme });
    setDraft(previous => previous.theme !== previousTheme || previous.theme === theme ? previous : { ...previous, theme });
  }, [theme, setBaseline, setDraft]);
  const [fullName, setFullName] = useState(storedUser?.full_name ?? "");
  const [avatar, setAvatar] = useState<UserAvatarDescriptor | null>(storedUser?.avatar ?? null);
  const [loading, setLoading] = useState(!isS3Session);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ProfileMessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<"name" | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [avatarDirty, setAvatarDirty] = useState(false);
  const dialogDirty = dialog === "name" && nameDraft !== fullName;
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
  }, [isS3Session, canWatch, setLanguagePreference, setBaseline, setDraft]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (workspaceLoading || workspaceError) return;
    const normalize = (previous: Preferences) => {
      const workspace = workspaces.some(item => item.id === previous.workspace) ? previous.workspace : workspaces[0]?.id ?? null;
      return workspace === previous.workspace ? previous : { ...previous, workspace };
    };
    setBaseline(normalize);
    setDraft(normalize);
  }, [workspaces, workspaceLoading, workspaceError, setBaseline, setDraft]);
  useEffect(() => { onUnsavedChangesChange?.(preferencesDirty || Boolean(dialogDirty) || avatarDirty || saving); }, [preferencesDirty, dialogDirty, avatarDirty, saving, onUnsavedChangesChange]);
  const closeDialog = useCallback(() => {
    setDialog(null);
    setError(null);
  }, []);
  const dialogGuard = useProfileDraftGuard({ hasUnsavedChanges: Boolean(dialogDirty), onClose: closeDialog, disabled: saving });
  const cancelPreferences = useCallback(() => { setDraft(baseline); setError(null); }, [baseline, setDraft]);
  const preferencesGuard = useProfileDraftGuard({ hasUnsavedChanges: preferencesDirty, onClose: cancelPreferences, disabled: saving });
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setSuccess(null); setError(null); };
  const openDialog = (next: "name") => {
    setNameDraft(fullName);
    setError(null);
    setSuccess(null);
    setDialog(next);
  };

  const savePreferences = async () => {
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
      const updated = await updateCurrentUser({ full_name: nameDraft.trim() || null });
      setFullName(updated.full_name ?? "");
      updateStoredUserProfile({ fullName: updated.full_name });
      setSuccess("nameSaved");
      closeDialog();
    } catch (failure) { setError(profileError(failure, text, "saveError")); }
    finally { setSaving(false); }
  };
  const preferenceSwitch = (key: "tags" | "quotaAlerts" | "quotaWatch", label: ProfileMessageKey) => <SettingsSwitch checked={draft[key]} disabled={unavailable} onChange={value => change(key, value)} ariaLabel={text(label)} />;

  return (
    <div className="settings-compact settings-form">
      {loading && <p role="status" className="mb-3 settings-body text-[var(--ui-text-muted)]">{text("loading")}</p>}
      {loadError && <div className="mb-3"><UiInlineMessage tone="error" role="alert">{text("profileLoadError")}</UiInlineMessage><ProfileButton onClick={() => void load()}>{text("retry")}</ProfileButton></div>}
      <SettingsSection presentation="compact" title={text("identity")} description={text("identityHelp")}>
        <SettingsItem compact title={text("name")} description={<><span className="text-[var(--ui-text)]">{fullName || text("unknown")}</span>{!canEditName && <span className="block">{text("managedName")}</span>}</>} action={canEditName && <ProfileButton variant="secondary" disabled={unavailable} onClick={() => openDialog("name")} aria-label={text("editName")}>{text("edit")}</ProfileButton>} />
        <SettingsItem compact title={text("email")} description={storedUser?.email || text("unknown")} />
        <UserAvatarEditor avatar={avatar} name={fullName} email={storedUser?.email} text={text} disabled={unavailable}
          readOnly={isS3Session} onDirtyChange={setAvatarDirty} onBusyChange={setSaving} onSave={async draft => {
            const updated = draft.file && draft.preference === "uploaded" ? await uploadCurrentUserAvatar(draft.file)
              : draft.remove ? await deleteCurrentUserAvatar() : await updateCurrentUser({ avatar_preference: draft.preference });
            setAvatar(updated.avatar ?? null);
            updateStoredUserProfile({ avatar: updated.avatar });
            setSuccess("imageSaved");
          }} />
        {success && success !== "preferencesSaved" && <UiInlineMessage tone="success" role="status">{text(success)}</UiInlineMessage>}
      </SettingsSection>
      <form onSubmit={event => { event.preventDefault(); void savePreferences(); }} className="settings-preferences">
        <SettingsSection presentation="compact" title={text("display")} description={text("displayHelp")}>
          <UserLanguageField value={draft.language} onChange={value => change("language", value)} disabled={unavailable} text={text} />
          <SettingsItem compact title={text("theme")} description={text("localPreference")} action={<UiSelect aria-label={text("theme")} className="settings-control w-full sm:w-56" value={draft.theme} disabled={unavailable} onChange={event => change("theme", event.target.value as "light" | "dark")}><option value="light">{text("light")}</option><option value="dark">{text("dark")}</option></UiSelect>} />
          <SettingsItem compact title={text("workspace")} description={workspaceError ? <><span role="alert">{text("workspaceError")}</span><ProfileButton variant="ghost" onClick={() => void loadWorkspaces()}>{text("retry")}</ProfileButton></> : text("localPreference")} action={<UiSelect aria-label={text("workspace")} className="settings-control w-full sm:w-56" value={draft.workspace ?? ""} disabled={unavailable || workspaceLoading || workspaceError || !workspaces.length} onChange={event => change("workspace", event.target.value as WorkspaceId)}>{!workspaces.length && <option value="">{text(workspaceLoading ? "loading" : "noWorkspace")}</option>}{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{text(`workspace_${workspace.id}`)}</option>)}</UiSelect>} />
          <SettingsItem compact title={text("tags")} description={text("localPreference")} action={preferenceSwitch("tags", "tags")} />
        </SettingsSection>
        {!isS3Session && <UserNotificationFields quotaAlerts={draft.quotaAlerts} quotaWatch={draft.quotaWatch} canWatch={canWatch}
          onQuotaAlertsChange={value => change("quotaAlerts", value)} onQuotaWatchChange={value => change("quotaWatch", value)} disabled={unavailable} text={text} />}
        {error && !dialog && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
        {success === "preferencesSaved" && <UiInlineMessage tone="success" role="status">{text(success)}</UiInlineMessage>}
        <SettingsActions dirty={preferencesDirty} busy={saving} disabled={unavailable} onSave={() => void savePreferences()} onCancel={preferencesGuard.requestClose} saveLabel={text("save")} saveAriaLabel={text("savePreferences")} cancelLabel={text("cancel")} savingLabel={text("saving")} />
      </form>
      {dialog && <ProfileDialog title={text("editName")} onClose={dialogGuard.requestClose} closeOnEscape={!saving} initialFocusRef={nameInput}>
        <form onSubmit={saveIdentity} className="settings-form settings-stack">
          <UiInput ref={nameInput} label={text("name")} value={nameDraft} disabled={saving} maxLength={255} onChange={event => setNameDraft(event.target.value)} />
          {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
          <div className="flex flex-wrap justify-end gap-2"><ProfileButton variant="secondary" disabled={saving} onClick={dialogGuard.requestClose}>{text("cancel")}</ProfileButton><ProfileButton type="submit" disabled={unavailable || !dialogDirty}>{text(saving ? "saving" : "save")}</ProfileButton></div>
        </form>
      </ProfileDialog>}
      {dialogGuard.confirmationDialog}{preferencesGuard.confirmationDialog}
    </div>
  );
}
