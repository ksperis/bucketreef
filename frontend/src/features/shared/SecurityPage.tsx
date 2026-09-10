/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  beginSecurityPasskey, finishSecurityPasskey, listExternalIdentities, listSecurityCredentials,
  listSecuritySessions, logoutAllSessions, regenerateRecoveryCodes, revokeExternalIdentity,
  revokeSecurityCredential, revokeSecuritySession,
  type SecurityCredential, type SecuritySession, type ExternalIdentity,
} from "../../api/security";
import { updateCurrentUser } from "../../api/users";
import { createPasskey } from "../../auth/webauthn";
import { useSession } from "../../auth/SessionProvider";
import { recoveryCodeHandoff } from "../../auth/recoveryCodeHandoff";
import { isRecentWebAuthnVerificationCancelled, useRecentWebAuthnStepUp } from "../../auth/useRecentWebAuthnStepUp";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { SettingsItem, SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import UiBadge from "../../components/ui/UiBadge";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { readStoredUser } from "../../utils/workspaces";
import { ProfileButton, ProfileConfirmation, ProfileDialog, useProfileDraftGuard } from "./ProfileControls";
import { profileError, useProfileI18n, type ProfileMessageKey } from "./profileMessages";
import { openSecuritySessions, securityDate, sessionActivity, sessionDevice } from "./securityPresentation";
import { ShieldIcon, UserIcon, FileIcon } from "../browser/browserIcons";
import AccountControlIcon from "../../components/AccountControlIcon";

type Resource<T> = { data: T[]; loading: boolean; error: unknown | null };
type Confirmation = { kind: "key"; value: SecurityCredential } | { kind: "identity"; value: ExternalIdentity } | { kind: "session"; value: SecuritySession } | { kind: "codes" | "all" };
type Panel = "keys" | "add" | "password" | "identities" | null;
function useSecurityResource<T>(fetcher: () => Promise<T[]>) {
  const [state, setState] = useState<Resource<T>>({ data: [], loading: true, error: null });
  const load = useCallback(async () => {
    setState((old) => ({ ...old, loading: true, error: null }));
    try { setState({ data: await fetcher(), loading: false, error: null }); }
    catch (error) { setState({ data: [], loading: false, error }); }
  }, [fetcher]);
  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

function ResourceStatus({ resource, errorKey, children }: { resource: Resource<unknown> & { reload: () => Promise<void> }; errorKey: ProfileMessageKey; children: ReactNode }) {
  const { text } = useProfileI18n();
  if (resource.loading) return <span role="status">{text("loading")}</span>;
  if (resource.error) return <div className="flex flex-wrap items-center gap-2"><span role="alert">{profileError(resource.error, text, errorKey)}</span><ProfileButton variant="secondary" onClick={() => void resource.reload()}>{text("retry")}</ProfileButton></div>;
  return children;
}

export default function SecurityPage({ onUnsavedChangesChange }: { onUnsavedChangesChange?: (dirty: boolean) => void }) {
  const { text, locale } = useProfileI18n();
  const firstInput = useRef<HTMLInputElement>(null);
  const { clear } = useSession();
  const user = readStoredUser();
  const { generalSettings } = useGeneralSettings();
  const canChangePassword = user?.has_local_password ?? user?.authType === "password";
  const required = user?.role === "ui_admin" || user?.role === "ui_superadmin" ? generalSettings.require_passkey_for_admins : generalSettings.require_passkey_for_users;
  const keys = useSecurityResource(listSecurityCredentials);
  const sessions = useSecurityResource(listSecuritySessions);
  const identities = useSecurityResource(listExternalIdentities);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [details, setDetails] = useState<SecuritySession | null>(null);
  const [keyName, setKeyName] = useState("");
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const openSessions = useMemo(() => openSecuritySessions(sessions.data, now), [sessions.data, now]);
  const dirty = (panel === "add" && keyName.length > 0) || (panel === "password" && Object.values(password).some(Boolean));
  useEffect(() => { onUnsavedChangesChange?.(dirty); }, [dirty, onUnsavedChangesChange]);
  const closePanel = () => { if (busy) return; setPanel(null); setKeyName(""); setPassword({ current: "", next: "", confirm: "" }); setShowPasswords(false); setInvalid(false); setError(null); };
  const guard = useProfileDraftGuard({ hasUnsavedChanges: dirty, onClose: closePanel, disabled: busy });
  const labels = useMemo(() => ({ title: text("verify"), description: text("verifyHelp"), cancel: text("cancel"), close: text("close"), cancelled: text("verifyCancelled"), failure: (failure: unknown) => profileError(failure, text, "verifyError") }), [text]);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp(labels);
  const signOut = () => { onUnsavedChangesChange?.(false); clear(); window.location.replace("/login"); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await runWithStepUp(action); return true; }
    catch (failure) { if (!isRecentWebAuthnVerificationCancelled(failure)) setError(profileError(failure, text)); return false; }
    finally { setBusy(false); }
  };
  const openPanel = (next: Panel) => { setError(null); setInvalid(false); setPanel(next); };
  const confirm = (next: Confirmation) => { setError(null); setConfirmation(next); };
  const addKey = async (event: FormEvent) => {
    event.preventDefault(); setInvalid(true);
    if (!keyName.trim()) return;
    if (await run(async () => { const credential = await createPasskey(await beginSecurityPasskey()); await finishSecurityPasskey(credential, keyName.trim()); })) signOut();
  };
  const savePassword = async (event: FormEvent) => {
    event.preventDefault(); setInvalid(true);
    if (!password.current || password.next.length < 12 || password.next !== password.confirm || !canChangePassword) return;
    if (await run(async () => { await updateCurrentUser({ current_password: password.current, new_password: password.next }); })) signOut();
  };
  const executeConfirmation = async () => {
    const pending = confirmation;
    if (!pending) return;
    const succeeded = await run(async () => {
      if (pending.kind === "key") await revokeSecurityCredential(pending.value.id);
      if (pending.kind === "identity") await revokeExternalIdentity(pending.value.id);
      if (pending.kind === "session") await revokeSecuritySession(pending.value.id);
      if (pending.kind === "all") await logoutAllSessions();
      if (pending.kind === "codes") {
        const handoff = recoveryCodeHandoff.begin();
        try { handoff.complete(await regenerateRecoveryCodes()); }
        catch (failure) { handoff.cancel(); throw failure; }
      }
    });
    if (!succeeded) return;
    setConfirmation(null);
    if (pending.kind === "codes") return;
    if (pending.kind === "session" && !pending.value.current) { setMessage(text("sessionRemoved")); await sessions.reload(); }
    else signOut();
  };
  const keyDescription = keys.data.length ? `${text(keys.data.length === 1 ? "onePasskey" : "manyPasskeys", { count: new Intl.NumberFormat(locale).format(keys.data.length) })} · ${text("enrolled")}` : `${text("noPasskeys")} ${text(required ? "required" : "optional")}`;
  const date = (value?: string | null) => securityDate(value, locale, text("unknown"));
  const panelTitle = panel === "keys" ? "manageKeys" : panel === "add" ? "addKey" : panel === "password" ? "changePassword" : "externalIdentities";
  const confirmationTitle = confirmation?.kind === "key" ? "removeKey" : confirmation?.kind === "identity" ? "unlink" : confirmation?.kind === "codes" ? "renewCodes" : confirmation?.kind === "all" ? "disconnectAll" : "disconnectSession";
  const confirmationDescription = confirmation?.kind === "key" ? "removeKeyHelp" : confirmation?.kind === "identity" ? "unlinkHelp" : confirmation?.kind === "codes" ? "renewHelp" : confirmation?.kind === "all" ? "globalImpact" : "disconnectHelp";
  const confirmationName = confirmation && "value" in confirmation ? confirmation.kind === "key" ? confirmation.value.name : confirmation.kind === "identity" ? confirmation.value.email ?? confirmation.value.provider_id : sessionDevice(confirmation.value, text) : null;

  return <div className="settings-compact" data-profile-view="security">
    <SettingsSection presentation="compact" title={text("signIn")} description={text("signInHelp")}>
      <SettingsItem compact title={text("passkeys")} icon={<ShieldIcon className="h-5 w-5" />} description={<ResourceStatus resource={keys} errorKey="loadKeysError">{keyDescription}</ResourceStatus>} action={<ProfileButton disabled={keys.loading || Boolean(keys.error) || busy} onClick={() => openPanel(keys.data.length ? "keys" : "add")}>{text(keys.data.length ? "manageKeys" : "addKey")}</ProfileButton>} />
      <SettingsItem compact title={text("password")} icon={<ShieldIcon className="h-5 w-5" />} description={text(canChangePassword ? "localPassword" : "externalPassword")} action={canChangePassword && <ProfileButton variant="secondary" onClick={() => openPanel("password")}>{text("edit")}</ProfileButton>} />
      <SettingsItem compact title={text("externalIdentities")} icon={<UserIcon className="h-5 w-5" />} description={<ResourceStatus resource={identities} errorKey="loadIdentitiesError">{identities.data.length ? identities.data.map((identity) => identity.email ?? identity.provider_id).join(", ") : text("noIdentities")}</ResourceStatus>} action={identities.data.length > 0 && <ProfileButton variant="secondary" onClick={() => openPanel("identities")}>{text("manageIdentities")}</ProfileButton>} />
    </SettingsSection>
    <SettingsSection presentation="compact" title={text("recovery")} description={text("recoveryHelp")}>
      <SettingsItem compact title={text("codes")} icon={<FileIcon className="h-5 w-5" />} description={keys.loading ? text("loading") : keys.error ? text("loadKeysError") : text(keys.data.length ? "codesHelp" : "codesNeedKey")} action={keys.data.length > 0 && !keys.error && <ProfileButton variant="secondary" onClick={() => confirm({ kind: "codes" })}>{text("renewCodes")}</ProfileButton>} />
    </SettingsSection>
    <SettingsSection presentation="compact" title={text("sessions")} description={text("sessionsHelp")}>
      <ResourceStatus resource={sessions} errorKey="loadSessionsError">
        {openSessions.length === 0 && <p className="py-3 settings-body text-[var(--ui-text-muted)]">{text("noSessions")}</p>}
        {openSessions.map((session) => <SettingsItem compact key={session.id} title={sessionDevice(session, text)} icon={<AccountControlIcon className="h-5 w-5" />} status={session.current && <UiBadge tone="primary">{text("currentSession")}</UiBadge>} description={sessionActivity(session.last_activity_at, now, locale, text)} action={<div className="flex flex-wrap gap-2">
          <ProfileButton variant="ghost" aria-label={`${text("details")} — ${sessionDevice(session, text)}${session.current ? ` — ${text("currentSession")}` : ""}`} onClick={() => setDetails(session)}>{text("details")}</ProfileButton>
          {!session.current && <ProfileButton variant="secondary" onClick={() => confirm({ kind: "session", value: session })}>{text("disconnect")}</ProfileButton>}
        </div>} />)}
      </ResourceStatus>
      <div className="mt-2 flex justify-end"><ProfileButton variant="ghost" className="text-rose-700 dark:text-rose-300" onClick={() => confirm({ kind: "all" })}>{text("disconnectAll")}</ProfileButton></div>
      {message && <UiInlineMessage tone="success" role="status">{message}</UiInlineMessage>}
    </SettingsSection>
    {panel && <ProfileDialog initialFocusRef={panel === "add" || panel === "password" ? firstInput : undefined} title={text(panelTitle)} onClose={guard.requestClose} closeOnBackdropClick={!busy} closeOnEscape={!busy} maxWidthClass={panel === "keys" || panel === "identities" ? "max-w-2xl" : "max-w-lg"}>
      <div className="settings-form settings-stack">
        {panel === "keys" && <><ul>{keys.data.map((key) => <li key={key.id} className="border-b border-[var(--ui-border-soft)] settings-list-item first:pt-0"><div className="flex flex-wrap items-center justify-between gap-3"><strong className="min-w-0 break-words settings-body">{key.name}</strong><ProfileButton variant="secondary" disabled={busy || Boolean(required && keys.data.length === 1)} onClick={() => confirm({ kind: "key", value: key })}>{text("removeKey")}</ProfileButton></div><p className="mt-1 settings-description text-[var(--ui-text-muted)]">{text("created")}: {date(key.created_at)} · {text("lastUsed")}: {key.last_used_at ? date(key.last_used_at) : text("neverUsed")}</p></li>)}</ul>{required && keys.data.length === 1 && <p className="settings-body">{text("lastKey")}</p>}<ProfileButton onClick={() => openPanel("add")}>{text("addKey")}</ProfileButton></>}
        {panel === "add" && <form onSubmit={addKey} className="settings-stack" noValidate><p className="settings-body">{text("addKeyHelp")}</p><UiInput ref={firstInput} label={text("keyName")} value={keyName} maxLength={128} onChange={(event) => setKeyName(event.target.value)} hint={text("keyNameHelp")} error={invalid && !keyName.trim() ? text("keyNameRequired") : undefined} /><p className="settings-description text-[var(--ui-text-muted)]">{text("globalImpact")}</p><div className="flex justify-end gap-2"><ProfileButton variant="secondary" disabled={busy} onClick={guard.requestClose}>{text("cancel")}</ProfileButton><ProfileButton type="submit" disabled={busy}>{text(busy ? "processing" : "addKey")}</ProfileButton></div></form>}
        {panel === "password" && <form onSubmit={savePassword} className="settings-stack" noValidate>
          <UiInput ref={firstInput} label={text("currentPassword")} type={showPasswords ? "text" : "password"} autoComplete="current-password" value={password.current} onChange={(event) => setPassword((value) => ({ ...value, current: event.target.value }))} error={invalid && !password.current ? text("passwordRequired") : undefined} />
          <UiInput label={text("newPassword")} type={showPasswords ? "text" : "password"} autoComplete="new-password" value={password.next} minLength={12} hint={text("passwordHint")} onChange={(event) => setPassword((value) => ({ ...value, next: event.target.value }))} error={invalid && password.next.length < 12 ? text("passwordHint") : undefined} />
          <UiInput label={text("confirmPassword")} type={showPasswords ? "text" : "password"} autoComplete="new-password" value={password.confirm} onChange={(event) => setPassword((value) => ({ ...value, confirm: event.target.value }))} error={invalid && password.next !== password.confirm ? text("mismatch") : undefined} />
          <label className="flex min-h-11 items-center gap-2 settings-body"><input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} />{text("showPasswords")}</label><p className="settings-description text-[var(--ui-text-muted)]">{text("globalImpact")}</p><div className="flex justify-end gap-2"><ProfileButton variant="secondary" disabled={busy} onClick={guard.requestClose}>{text("cancel")}</ProfileButton><ProfileButton type="submit" disabled={busy}>{text(busy ? "saving" : "save")}</ProfileButton></div>
        </form>}
        {panel === "identities" && <><ul>{identities.data.map((identity) => <li key={identity.id} className="border-b border-[var(--ui-border-soft)] settings-list-item first:pt-0"><div className="flex flex-wrap items-center justify-between gap-3"><strong className="min-w-0 break-words settings-body">{identity.email ?? identity.provider_id}</strong>{generalSettings.allow_user_external_identity_unlink && <ProfileButton variant="secondary" onClick={() => confirm({ kind: "identity", value: identity })}>{text("unlink")}</ProfileButton>}</div><p className="settings-description text-[var(--ui-text-muted)]">{identity.provider_type}: {identity.provider_id} · {text("created")}: {date(identity.created_at)}</p></li>)}</ul>{!generalSettings.allow_user_external_identity_unlink && <p className="settings-body">{text("managedIdentities")}</p>}</>}
        {error && !confirmation && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
      </div>
    </ProfileDialog>}
    {details && <ProfileDialog title={text("sessionDetails")} onClose={() => setDetails(null)}><dl className="space-y-3 settings-body">{[[text("name"), sessionDevice(details, text)], [text("ip"), details.ip_address ?? text("unknown")], [text("method"), details.auth_type === "password" ? text("password") : details.auth_type === "webauthn" ? text("passkeys") : details.auth_type === "recovery_code" ? text("codes") : details.auth_type], [text("created"), date(details.created_at)], [text("lastUsed"), date(details.last_activity_at)], [text("idleExpiry"), date(details.idle_expires_at)], [text("expiry"), date(details.absolute_expires_at)]].map(([label, value]) => <div key={label} className="grid gap-1 sm:grid-cols-2"><dt className="text-[var(--ui-text-muted)]">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl></ProfileDialog>}
    {confirmation && <ProfileConfirmation title={text(confirmationTitle)} confirmLabel={text(confirmationTitle)} description={text(confirmationDescription)} details={confirmationName ? [{ label: text("name"), value: confirmationName }] : []} impacts={confirmation.kind !== "session" && confirmation.kind !== "all" ? [text("globalImpact")] : []} warning={error ? <span role="alert">{error}</span> : undefined} loading={busy} zIndexClass="z-[80]" onCancel={() => { if (!busy) { setConfirmation(null); setError(null); } }} onConfirm={() => void executeConfirmation()} />}
    {guard.confirmationDialog}<div className="settings-dialog">{verificationDialog}</div>
  </div>;
}
