/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import {
  beginOidcLinkWebAuthnAuthentication,
  beginOidcLinkWebAuthnRegistration,
  confirmOidcLink,
  fetchOidcLinkStatus,
  finishOidcLinkWebAuthnAuthentication,
  finishOidcLinkWebAuthnRegistration,
  requestOidcLinkAdminApproval,
  startOidcLinkProof,
  verifyOidcLinkLdap,
  verifyOidcLinkPassword,
  type OidcLinkProofMethod,
  type OidcLinkStatus,
} from "../../api/auth";
import { authenticatePasskey, createPasskey } from "../../auth/webauthn";
import BrandMark from "../../components/BrandMark";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { PRODUCT_NAME } from "../../constants/product";
import { AuthButton, AuthInput, AuthPasswordInput, AuthSelect } from "./AuthFormControls";
import { AuthCard, AuthCenteredPage } from "./AuthSurface";
import { useAuthI18n } from "./authMessages";

function proofLabel(method: OidcLinkProofMethod, text: ReturnType<typeof useAuthI18n>["text"]): string {
  if (method.type === "password") return text("oidcLinkLocalPassword");
  return method.display_name || method.provider_id || text(method.type === "ldap" ? "directory" : "oidcLinkExistingOidc");
}

export function oidcLinkCompletionPath(status: OidcLinkStatus): string {
  return status.source === "profile" ? "/profile" : "/";
}

export default function OidcLinkPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { text } = useAuthI18n();
  const [status, setStatus] = useState<OidcLinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [ldapProvider, setLdapProvider] = useState("");
  const [ldapUsername, setLdapUsername] = useState("");
  const [ldapPassword, setLdapPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);

  const ldapMethods = useMemo(
    () => status?.proof_methods.filter((method) => method.type === "ldap") ?? [],
    [status],
  );
  const oidcMethods = useMemo(
    () => status?.proof_methods.filter((method) => method.type === "oidc") ?? [],
    [status],
  );
  const hasPassword = Boolean(status?.proof_methods.some((method) => method.type === "password"));

  useEffect(() => {
    if (!attemptId) {
      setLoading(false);
      setError(text("oidcLinkUnavailable"));
      return;
    }
    let active = true;
    fetchOidcLinkStatus(attemptId)
      .then((next) => {
        if (!active) return;
        setStatus(next);
        const firstLdap = next.proof_methods.find((method) => method.type === "ldap")?.provider_id;
        if (firstLdap) setLdapProvider((current) => current || firstLdap);
      })
      .catch((failure) => {
        console.error(failure);
        if (active) setError(text("oidcLinkUnavailable"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attemptId, text]);

  const run = async (action: () => Promise<OidcLinkStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setStatus(next);
      return next;
    } catch (failure) {
      console.error(failure);
      setError(text("oidcLinkActionFailed"));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!attemptId || !password) return;
    const next = await run(() => verifyOidcLinkPassword(attemptId, password));
    if (next) setPassword("");
  };

  const submitLdap = async (event: FormEvent) => {
    event.preventDefault();
    if (!attemptId || !ldapProvider || !ldapUsername.trim() || !ldapPassword) return;
    const next = await run(() => verifyOidcLinkLdap(attemptId, ldapProvider, ldapUsername.trim(), ldapPassword));
    if (next) setLdapPassword("");
  };

  const startOidcProof = async (providerId: string) => {
    if (!attemptId) return;
    setBusy(true);
    setError(null);
    try {
      const started = await startOidcLinkProof(attemptId, providerId);
      window.location.assign(started.authorization_url);
    } catch (failure) {
      console.error(failure);
      setError(text("oidcLinkActionFailed"));
      setBusy(false);
    }
  };

  const completeMfa = async () => {
    if (!attemptId || !status) return;
    setBusy(true);
    setError(null);
    try {
      if (status.stage === "mfa_enrollment") {
        const options = await beginOidcLinkWebAuthnRegistration(attemptId);
        const credential = await createPasskey(options);
        const result = await finishOidcLinkWebAuthnRegistration(attemptId, credential);
        setRecoveryCodes(result.recovery_codes);
        setStatus(result.status);
        setRecoveryCodesSaved(result.recovery_codes.length === 0);
      } else {
        const options = await beginOidcLinkWebAuthnAuthentication(attemptId);
        const credential = await authenticatePasskey(options);
        setStatus(await finishOidcLinkWebAuthnAuthentication(attemptId, credential));
      }
    } catch (failure) {
      console.error(failure);
      setError(text("passkeyVerificationFailed"));
    } finally {
      setBusy(false);
    }
  };

  const requestAdmin = async () => {
    if (!attemptId) return;
    await run(() => requestOidcLinkAdminApproval(attemptId));
  };

  const confirm = async () => {
    if (!attemptId || (recoveryCodes.length > 0 && !recoveryCodesSaved)) return;
    const next = await run(() => confirmOidcLink(attemptId));
    if (next?.stage === "completed") {
      window.location.replace(oidcLinkCompletionPath(next));
    }
  };

  return (
    <AuthCenteredPage className="py-8">
      <AuthCard className="max-w-xl p-6 sm:p-8">
        <BrandMark alt={PRODUCT_NAME} className="mb-5 h-14 w-14" />
        <h1 className="text-2xl font-semibold">{text("oidcLinkTitle")}</h1>
        <p className="mt-2 ui-body text-slate-600">{text("oidcLinkDescription")}</p>

        {loading && <p className="mt-6 ui-body text-slate-500" role="status">{text("pleaseWait")}</p>}
        {error && <div className="mt-5"><UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage></div>}

        {status && !loading && (
          <div className="mt-6 space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 ui-body text-slate-700">
              <div><span className="font-semibold">{text("email")}:</span> {status.target_email}</div>
              <div className="mt-1"><span className="font-semibold">{text("oidcLinkProvider")}:</span> {status.provider_id}</div>
            </div>

            {status.stage === "oidc" && (
              <UiInlineMessage tone="info">{text("oidcLinkFinishProvider")}</UiInlineMessage>
            )}

            {status.stage === "proof" && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">{text("oidcLinkVerifyExistingAccount")}</h2>
                  <p className="mt-1 ui-body text-slate-600">{text("oidcLinkVerifyHelp")}</p>
                </div>

                {hasPassword && (
                  <form onSubmit={submitPassword} className="space-y-3">
                    <AuthPasswordInput label={text("oidcLinkLocalPassword")} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                    <AuthButton type="submit" disabled={busy || !password}>{text("oidcLinkVerifyPassword")}</AuthButton>
                  </form>
                )}

                {ldapMethods.length > 0 && (
                  <form onSubmit={submitLdap} className="space-y-3 border-t border-slate-200 pt-5">
                    {ldapMethods.length > 1 && (
                      <AuthSelect label={text("directory")} value={ldapProvider} onChange={(event) => setLdapProvider(event.target.value)}>
                        {ldapMethods.map((method) => <option key={method.provider_id} value={method.provider_id ?? ""}>{proofLabel(method, text)}</option>)}
                      </AuthSelect>
                    )}
                    <AuthInput label={text("username")} autoComplete="username" value={ldapUsername} onChange={(event) => setLdapUsername(event.target.value)} required />
                    <AuthPasswordInput label={text("password")} autoComplete="current-password" value={ldapPassword} onChange={(event) => setLdapPassword(event.target.value)} required />
                    <AuthButton type="submit" disabled={busy || !ldapProvider || !ldapUsername.trim() || !ldapPassword}>{text("oidcLinkVerifyDirectory")}</AuthButton>
                  </form>
                )}

                {oidcMethods.length > 0 && (
                  <div className="space-y-2 border-t border-slate-200 pt-5">
                    <p className="ui-body font-semibold text-slate-700">{text("oidcLinkExistingOidc")}</p>
                    {oidcMethods.map((method) => (
                      <AuthButton key={method.provider_id} type="button" presentation="provider" disabled={busy || !method.provider_id} onClick={() => method.provider_id && void startOidcProof(method.provider_id)}>
                        {text("oidcLinkContinueWith", { provider: proofLabel(method, text) })}
                      </AuthButton>
                    ))}
                  </div>
                )}

                <div className="border-t border-slate-200 pt-5">
                  <p className="ui-body text-slate-600">{text("oidcLinkAdminFallbackHelp")}</p>
                  <AuthButton type="button" presentation="provider" className="mt-3" disabled={busy} onClick={() => void requestAdmin()}>{text("oidcLinkRequestAdmin")}</AuthButton>
                </div>
              </div>
            )}

            {(status.stage === "mfa" || status.stage === "mfa_enrollment") && (
              <div>
                <h2 className="text-lg font-semibold">{text(status.stage === "mfa" ? "verifyPasskey" : "createPasskey")}</h2>
                <p className="mt-1 ui-body text-slate-600">{text("oidcLinkMfaHelp")}</p>
                <AuthButton type="button" className="mt-4" disabled={busy} onClick={() => void completeMfa()}>
                  {text(status.stage === "mfa" ? "usePasskey" : "createPasskey")}
                </AuthButton>
              </div>
            )}

            {recoveryCodes.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-4 text-amber-950">
                <p className="font-semibold">{text("saveRecoveryCodesNow")}</p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
                  {recoveryCodes.map((code) => <li key={code}>{code}</li>)}
                </ul>
                <label className="mt-4 flex min-h-11 items-center gap-2 ui-body">
                  <input type="checkbox" checked={recoveryCodesSaved} onChange={(event) => setRecoveryCodesSaved(event.target.checked)} />
                  <span>{text("savedRecoveryCodes")}</span>
                </label>
              </div>
            )}

            {status.stage === "confirm" && (
              <div>
                <h2 className="text-lg font-semibold">{text("oidcLinkConfirmTitle")}</h2>
                <p className="mt-1 ui-body text-slate-600">{text("oidcLinkConfirmHelp", { provider: status.provider_id, email: status.target_email })}</p>
                <AuthButton type="button" className="mt-5" disabled={busy || (recoveryCodes.length > 0 && !recoveryCodesSaved)} onClick={() => void confirm()}>
                  {text("oidcLinkConfirm")}
                </AuthButton>
              </div>
            )}

            {status.stage === "admin_requested" && (
              <UiInlineMessage tone="info">{text("oidcLinkAdminRequested")}</UiInlineMessage>
            )}
            {status.stage === "completed" && (
              <UiInlineMessage tone="success">{text("oidcLinkCompleted")}</UiInlineMessage>
            )}
          </div>
        )}
      </AuthCard>
    </AuthCenteredPage>
  );
}
