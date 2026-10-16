/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addAdminExternalIdentity,
  getAdminUserSecurity,
  resetAdminUserMfa,
  restoreAdminExternalIdentity,
  revokeAdminExternalIdentity,
  revokeAdminUserSession,
  setAdminUserPassword,
  type AdminExternalIdentity,
  type AdminUserSecurity,
  type SecuritySession,
} from "../../api/security";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageBanner from "../../components/PageBanner";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsItem, SettingsSection } from "../../components/settings/SettingsLayout";
import UiBadge from "../../components/ui/UiBadge";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { extractApiError } from "../../utils/apiError";
import { securityDate } from "../shared/securityPresentation";
import { useUserI18n } from "./userMessage";

type PendingAction =
  | { kind: "reset-mfa" }
  | { kind: "revoke-identity"; identity: AdminExternalIdentity }
  | { kind: "restore-identity"; identity: AdminExternalIdentity }
  | { kind: "revoke-session"; session: SecuritySession };

function submitOnEnter(event: KeyboardEvent<HTMLFieldSetElement>, action: () => Promise<void>) {
  if (event.key === "Enter" && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) {
    event.preventDefault();
    event.stopPropagation();
    void action();
  }
}

export default function UserAuthenticationPanel({ userId, canMutate, onBusyChange, onDirtyChange }: {
  userId: number;
  canMutate: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { locale, text } = useUserI18n();
  const textRef = useRef(text);
  textRef.current = text;
  const [security, setSecurity] = useState<AdminUserSecurity | null>(null);
  const [loading, setLoading] = useState(true);
  const loadGeneration = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorContext, setErrorContext] = useState<"password" | "identity" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordAttempted, setPasswordAttempted] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const [providerType, setProviderType] = useState<"oidc" | "ldap">("oidc");
  const [providerId, setProviderId] = useState("");
  const [subject, setSubject] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [identityAttempted, setIdentityAttempted] = useState(false);
  const providerRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const verificationLabels = useMemo(() => ({
    title: text("verifyWithPasskey"),
    description: text("verificationDescription"),
    cancel: text("cancel"),
    close: locale === "en" ? undefined : text("close"),
    cancelled: text("verificationCancelled"),
    failure: (failure: unknown) => extractApiError(failure, text("verificationFailed")),
  }), [locale, text]);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp(verificationLabels);
  const disabled = !canMutate || loading || Boolean(loadError) || !security || busy;
  const passwordError = !password.trim() || [...password].length < 12 ? text("passwordMinimumLength") : undefined;
  const confirmationError = !passwordConfirmation || password !== passwordConfirmation ? text("passwordConfirmationMismatch") : undefined;
  const providerError = !providerId.trim() ? text("providerIdRequired") : undefined;
  const subjectError = !subject.trim() ? text("immutableSubjectRequired") : undefined;
  // Read the native email validity, including after any controlled-input update.
  const [invalidEmail, setInvalidEmail] = useState(false);
  const emailError = invalidEmail ? text("invalidEmail") : undefined;
  const date = (value?: string | null) => securityDate(value, locale, text("notAvailable"));

  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  const dirty = Boolean(password || passwordConfirmation || providerId || subject || identityEmail);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(null);
    try {
      const details = await getAdminUserSecurity(userId);
      if (generation === loadGeneration.current) setSecurity(details);
    } catch (loadFailure) {
      if (generation === loadGeneration.current) setLoadError(extractApiError(loadFailure, textRef.current("loadAuthenticationError")));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  const runAction = async (action: () => Promise<void>, success: string, requiresStepUp = true) => {
    if (disabled || busyRef.current) return false;
    busyRef.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (requiresStepUp) await runWithStepUp(action);
      else await action();
      setMessage(success);
      await load();
      return true;
    } catch (actionError) {
      if (!isRecentWebAuthnVerificationCancelled(actionError)) {
        setError(extractApiError(actionError, text("updateAuthenticationError")));
      }
      throw actionError;
    } finally {
      busyRef.current = false;
      onBusyChange?.(false);
      setBusy(false);
    }
  };

  const savePassword = async () => {
    if (disabled || busyRef.current) return;
    setError(null);
    setErrorContext("password");
    setMessage(null);
    setPasswordAttempted(true);
    if (passwordError || confirmationError) {
      (passwordError ? passwordRef : confirmationRef).current?.focus();
      return;
    }
    try {
      if (await runAction(() => setAdminUserPassword(userId, password), text("passwordUpdated"))) {
        setPassword("");
        setPasswordConfirmation("");
        setPasswordAttempted(false);
      }
    } catch {
      // Keep the draft; runAction displays the failure.
    }
  };

  const addIdentity = async () => {
    if (disabled || busyRef.current) return;
    setError(null);
    setErrorContext("identity");
    setMessage(null);
    setIdentityAttempted(true);
    if (providerError || subjectError || emailError) {
      (providerError ? providerRef : subjectError ? subjectRef : emailRef).current?.focus();
      return;
    }
    try {
      if (await runAction(
        async () => { await addAdminExternalIdentity(userId, {
          provider_type: providerType,
          provider_id: providerId,
          subject,
          email: identityEmail || null,
          email_verified: providerType === "oidc" && Boolean(identityEmail),
        }); },
        text("identityLinked"),
      )) {
        setProviderId("");
        setSubject("");
        setIdentityEmail("");
        setInvalidEmail(false);
        setIdentityAttempted(false);
      }
    } catch {
      // Keep the draft; runAction displays the failure.
    }
  };

  const requestAction = (action: PendingAction) => {
    if (disabled || busyRef.current) return;
    setError(null);
    setErrorContext(null);
    setMessage(null);
    setPending(action);
  };

  const confirmPending = async () => {
    if (!pending || disabled || busyRef.current) return;
    try {
      const succeeded = pending.kind === "reset-mfa"
        ? await runAction(() => resetAdminUserMfa(userId), text("mfaResetCompleted"))
        : pending.kind === "revoke-identity"
          ? await runAction(() => revokeAdminExternalIdentity(userId, pending.identity.id), text("identityRevoked"))
          : pending.kind === "restore-identity"
            ? await runAction(() => restoreAdminExternalIdentity(userId, pending.identity.id), text("identityRestored"))
            : await runAction(() => revokeAdminUserSession(userId, pending.session.id), text("sessionRevoked"), false);
      if (succeeded) setPending(null);
    } catch {
      // Keep the confirmation open with its error for retry.
    }
  };

  return (
    <div className="settings-stack">
      {loading && <PageBanner tone="info">{text("loadingAuthentication")}</PageBanner>}
      {loadError && <PageBanner tone="error">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{loadError}</span>
          <SettingsButton variant="secondary" disabled={loading || busy} onClick={() => void load()}>{text("retry")}</SettingsButton>
        </div>
      </PageBanner>}
      {message && <PageBanner tone="success">{message}</PageBanner>}
      <p className="settings-description">
        {text(canMutate ? "immediateAuthenticationChanges" : "managePersonalSecurity")}
      </p>

      {security && <fieldset disabled={disabled} className="min-w-0">
        <SettingsSection title={text("passkeysAndMfa")} presentation="compact"
          description={text(security.passkey_required ? "passkeyRequired" : "passkeyOptional")}>
          {security.passkeys.map((passkey) => <SettingsItem compact key={passkey.id} title={passkey.name}
            className="[overflow-wrap:anywhere]"
            status={<UiBadge tone={passkey.revoked_at ? "neutral" : "success"}>{text(passkey.revoked_at ? "revoked" : "active")}</UiBadge>}
            description={text("lastUsed", { date: date(passkey.last_used_at) })} />)}
          {security.passkeys.length === 0 && <p className="settings-readonly">{text("noPasskeys")}</p>}
          {canMutate && <div className="mt-2"><SettingsButton variant="danger" onClick={() => requestAction({ kind: "reset-mfa" })}>{text("resetMfa")}</SettingsButton></div>}
        </SettingsSection>

        <SettingsSection title={text("localPassword")} presentation="compact"
          description={text(security.has_local_password ? "localPasswordConfigured" : "noLocalPassword")}>
          {canMutate && <fieldset aria-label={text("changeLocalPassword")} className="settings-fields sm:grid-cols-2" onKeyDown={(event) => submitOnEnter(event, savePassword)}>
            <UiInput ref={passwordRef} label={text("newPassword")} hint={text("passwordMinimumLength")} type="password" minLength={12} autoComplete="new-password"
              value={password} onChange={(event) => setPassword(event.target.value)} error={passwordAttempted ? passwordError : undefined} />
            <UiInput ref={confirmationRef} label={text("confirmPassword")} type="password" minLength={12} autoComplete="new-password"
              value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} error={passwordAttempted ? confirmationError : undefined} />
            <div className="sm:col-span-2"><SettingsButton onClick={() => void savePassword()}>{text("setPassword")}</SettingsButton></div>
            {error && errorContext === "password" && <PageBanner tone="error" className="sm:col-span-2">{error}</PageBanner>}
          </fieldset>}
        </SettingsSection>

        <SettingsSection title={text("externalIdentities")} presentation="compact" description={text("externalIdentitiesDescription")}>
          {security.external_identities.map((identity) => <SettingsItem compact key={identity.id}
            title={`${identity.provider_type}:${identity.provider_id}`} className="[overflow-wrap:anywhere]"
            status={<UiBadge tone={identity.revoked_at ? "neutral" : "success"}>{text(identity.revoked_at ? "revoked" : "active")}</UiBadge>}
            description={<><code className="block break-all">{identity.subject}</code><span>{identity.link_source}</span></>}
            action={canMutate && (identity.revoked_at
              ? <SettingsButton variant="secondary" onClick={() => requestAction({ kind: "restore-identity", identity })}>{text("restore")}</SettingsButton>
              : <SettingsButton variant="danger" onClick={() => requestAction({ kind: "revoke-identity", identity })}>{text("revoke")}</SettingsButton>)} />)}
          {security.external_identities.length === 0 && <p className="settings-readonly">{text("noExternalIdentities")}</p>}
          {canMutate && <fieldset aria-label={text("linkExternalIdentity")} className="settings-fields mt-3 border-t border-[var(--ui-border-soft)] pt-3 sm:grid-cols-2"
            onKeyDown={(event) => submitOnEnter(event, addIdentity)}>
            <UiSelect label={text("providerType")} value={providerType} onChange={(event) => setProviderType(event.target.value as "oidc" | "ldap")}>
              <option value="oidc">{text("oidc")}</option><option value="ldap">{text("ldap")}</option>
            </UiSelect>
            <UiInput ref={providerRef} label={text("providerId")} value={providerId} onChange={(event) => setProviderId(event.target.value)} error={identityAttempted ? providerError : undefined} />
            <UiInput ref={subjectRef} label={text("immutableSubject")} value={subject} onChange={(event) => setSubject(event.target.value)} error={identityAttempted ? subjectError : undefined} />
            <UiInput ref={emailRef} label={text("claimedEmailOptional")} type="email" value={identityEmail} error={identityAttempted ? emailError : undefined}
              onChange={(event) => { setIdentityEmail(event.target.value); setInvalidEmail(!event.target.validity.valid); }} />
            <div className="sm:col-span-2"><SettingsButton onClick={() => void addIdentity()}>{text("linkIdentity")}</SettingsButton></div>
            {error && errorContext === "identity" && <PageBanner tone="error" className="sm:col-span-2">{error}</PageBanner>}
          </fieldset>}
        </SettingsSection>

        <SettingsSection title={text("userSessions")} presentation="compact">
          {security.sessions.map((session) => <SettingsItem compact key={session.id}
            title={`${session.auth_type} · ${session.ip_address ?? text("unknownAddress")}`} className="[overflow-wrap:anywhere]"
            description={text("lastActivity", { date: date(session.last_activity_at) })}
            status={session.revoked_at && <UiBadge tone="neutral">{text("revoked")}</UiBadge>}
            action={canMutate && !session.revoked_at && <SettingsButton variant="danger" onClick={() => requestAction({ kind: "revoke-session", session })}>{text("revoke")}</SettingsButton>} />)}
          {security.sessions.length === 0 && <p className="settings-readonly">{text("noSessions")}</p>}
        </SettingsSection>
      </fieldset>}

      {pending && <ConfirmActionDialog
        title={text(pending.kind === "reset-mfa" ? "resetUserMfa" : pending.kind === "revoke-session" ? "revokeUserSession" : pending.kind === "restore-identity" ? "restoreExternalIdentity" : "revokeExternalIdentity")}
        description={text(pending.kind === "reset-mfa" ? "resetMfaDescription" : pending.kind === "revoke-session" ? "revokeSessionDescription" : "securityChangeDescription")}
        details={[
          { label: text("user"), value: security?.email ?? String(userId) },
          ...(pending.kind === "revoke-identity" || pending.kind === "restore-identity" ? [
            { label: text("provider"), value: `${pending.identity.provider_type}:${pending.identity.provider_id}` },
            { label: text("subject"), value: pending.identity.subject, mono: true },
          ] : pending.kind === "revoke-session" ? [
            { label: text("session"), value: pending.session.id, mono: true },
            { label: text("address"), value: pending.session.ip_address ?? text("unknownAddress") },
          ] : []),
        ]}
        confirmLabel={text(pending.kind === "reset-mfa" ? "resetMfa" : pending.kind === "restore-identity" ? "restoreIdentity" : "confirm")}
        cancelLabel={text("cancel")}
        processingLabel={text("processing")}
        impactLabel={text("impact")}
        closeLabel={locale === "en" ? undefined : text("close")}
        tone={pending.kind === "restore-identity" ? "primary" : "danger"}
        error={error}
        loading={busy}
        confirmDisabled={loading || Boolean(loadError) || !canMutate}
        onCancel={() => { if (!busyRef.current) { setPending(null); setError(null); } }}
        onConfirm={() => void confirmPending()}
      />}
      {verificationDialog}
    </div>
  );
}
