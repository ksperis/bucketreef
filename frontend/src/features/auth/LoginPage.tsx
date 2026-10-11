/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchLdapProviders,
  fetchOidcProviders,
  beginWebAuthnAuthentication,
  beginWebAuthnRegistration,
  finishWebAuthnAuthentication,
  finishWebAuthnRegistration,
  login,
  loginWithKeys,
  loginWithLdap,
  startOidcLogin,
  verifyRecoveryCode,
  type AuthenticationResponse,
  type LDAPProviderInfo,
  type OidcProviderInfo,
} from "../../api/auth";
import { fetchGeneralSettings, fetchLoginSettings, type GeneralSettings, type LoginSettings } from "../../api/appSettings";
import { getWorkspaceAccess } from "../../api/executionContexts";
import { DEFAULT_GENERAL_SETTINGS, useGeneralSettings } from "../../components/GeneralSettingsContext";
import BrandMark from "../../components/BrandMark";
import AppVersion from "../../components/AppVersion";
import { useLanguage } from "../../components/language";
import { useTheme } from "../../components/theme";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { PRODUCT_NAME } from "../../constants/product";
import { CLIENT_STORAGE_KEYS, removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { classifyApiError } from "../../utils/apiError";
import { useSession } from "../../auth/SessionProvider";
import { authenticatePasskey, createPasskey } from "../../auth/webauthn";
import { prefetchWorkspaceBranch } from "../../utils/routePrefetch";
import {
  resolvePostLoginPath,
  resolvePostLoginPathWithWorkspaceAccess,
  type SessionUser,
} from "../../utils/workspaces";
import { AuthButton, AuthInput, AuthPasswordInput, AuthSelect } from "./AuthFormControls";
import { AuthBrandBackdrop, AuthCard, AuthCenteredPage } from "./AuthSurface";
import { useAuthI18n, type AuthText } from "./authMessages";

type LoginMode = "password" | "keys" | "ldap";

function passwordLoginErrorMessage(error: unknown, text: AuthText): string {
  const failure = classifyApiError(error, text("unableToSignIn"));
  if (failure.status === 401) {
    return text("invalidEmailPassword");
  }
  if (failure.status === 429) {
    return text("tooManySignInAttempts");
  }
  if (
    failure.kind === "timeout" ||
    failure.kind === "unavailable" ||
    failure.kind === "invalid_response"
  ) {
    return text("unableReachBucketReef");
  }
  return text("unableToSignIn");
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { runtimeSurfaces, setGeneralSettings } = useGeneralSettings();
  const { setLanguagePreference } = useLanguage();
  const { setTheme } = useTheme();
  const { acceptAuthentication } = useSession();
  const { text } = useAuthI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ldapUsername, setLdapUsername] = useState("");
  const [ldapPassword, setLdapPassword] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [mode, setMode] = useState<LoginMode>("password");
  const [error, setError] = useState<string | null>(null);
  const [oidcError, setOidcError] = useState<string | null>(null);
  const [ldapError, setLdapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState<string | null>(null);
  const [oidcProviders, setOidcProviders] = useState<OidcProviderInfo[]>([]);
  const [ldapProviders, setLdapProviders] = useState<LDAPProviderInfo[]>([]);
  const [selectedLdapProvider, setSelectedLdapProvider] = useState("");
  const [loginSettings, setLoginSettings] = useState<LoginSettings | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [loginBrandingLogoFailed, setLoginBrandingLogoFailed] = useState(false);
  const [mfaStage, setMfaStage] = useState<"mfa_required" | "mfa_enrollment_required" | null>(() => {
    if (typeof window === "undefined") return null;
    const value = new URLSearchParams(window.location.search).get("mfa");
    return value === "mfa_required" || value === "mfa_enrollment_required" ? value : null;
  });
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pendingEnrollment, setPendingEnrollment] = useState<AuthenticationResponse | null>(null);
  const loadGeneralSettings = async (): Promise<GeneralSettings> => {
    try {
      const settings = await fetchGeneralSettings();
      setGeneralSettings(settings);
      return settings;
    } catch (err) {
      console.error(err);
      return DEFAULT_GENERAL_SETTINGS;
    }
  };

  const resolveInteractiveDestination = async (
    sessionUser: SessionUser,
    settings: GeneralSettings
  ): Promise<string> => {
    try {
      const workspaceAccess = await getWorkspaceAccess();
      return resolvePostLoginPathWithWorkspaceAccess(
        sessionUser,
        settings,
        workspaceAccess,
        runtimeSurfaces,
      );
    } catch (workspaceError) {
      console.error(workspaceError);
      return resolvePostLoginPath(sessionUser, settings, runtimeSurfaces);
    }
  };

  const finishLogin = async (res: AuthenticationResponse, authType: SessionUser["authType"]) => {
    if (res.status === "mfa_required" || res.status === "mfa_enrollment_required") {
      setMfaStage(res.status);
      return;
    }
    if (res.status !== "authenticated") {
      throw new Error(text("authenticationRequiresApproval"));
    }
    acceptAuthentication(res, authType);
    const sessionUser: SessionUser = res.user
      ? { ...res.user, authType }
      : {
          email: res.session?.account_id ? `${res.session.account_id}@s3-session` : "s3-session",
          role: "ui_user",
          authType: "s3_session",
          actorType: res.session?.actor_type,
          accountId: res.session?.account_id ?? null,
          accountName: res.session?.account_name ?? null,
          capabilities: res.session?.capabilities,
        };
    if (res.user) {
      setLanguagePreference(res.user.ui_language ?? "auto");
      if (res.user.ui_preferences?.theme === "light" || res.user.ui_preferences?.theme === "dark") {
        setTheme(res.user.ui_preferences.theme);
      }
    } else {
      setLanguagePreference("auto");
    }
    const appSettings = await loadGeneralSettings();
    const destination = await resolveInteractiveDestination(sessionUser, appSettings);
    prefetchWorkspaceBranch(destination);
    navigate(destination, { replace: true });
  };

  useEffect(() => {
    let isMounted = true;
    fetchOidcProviders()
      .then((providers) => {
        if (isMounted) {
          setOidcProviders(providers);
        }
      })
      .catch(() => {
        if (isMounted) {
          setOidcError(text("unableLoadIdentityProviders"));
        }
      });
    return () => {
      isMounted = false;
    };
  }, [text]);

  useEffect(() => {
    let isMounted = true;
    fetchLdapProviders()
      .then((providers) => {
        if (isMounted) {
          setLdapProviders(providers);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLdapError(text("unableLoadDirectoryProviders"));
        }
      });
    return () => {
      isMounted = false;
    };
  }, [text]);

  useEffect(() => {
    let isMounted = true;
    setEndpointLoading(true);
    fetchLoginSettings()
      .then((settings) => {
        if (isMounted) {
          setLoginSettings(settings);
        }
      })
      .catch(() => {
        if (isMounted) {
          setEndpointError(text("unableLoadEndpointOptions"));
        }
      })
      .finally(() => {
        if (isMounted) {
          setEndpointLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [text]);

  useEffect(() => {
    if (!loginSettings) return;
    if (selectedEndpoint || customEndpoint) return;
    const defaultEndpoint = loginSettings.endpoints.find((endpoint) => endpoint.is_default);
    if (defaultEndpoint) {
      setSelectedEndpoint(defaultEndpoint.endpoint_url);
    }
  }, [loginSettings, selectedEndpoint, customEndpoint]);

  useEffect(() => {
    if (selectedLdapProvider || ldapProviders.length === 0) return;
    setSelectedLdapProvider(ldapProviders[0].id);
  }, [ldapProviders, selectedLdapProvider]);

  useEffect(() => {
    setLoginBrandingLogoFailed(false);
  }, [loginSettings?.login_logo_url]);

  const handlePasswordLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      await finishLogin(res, "password");
    } catch (err) {
      console.error(err);
      setError(passwordLoginErrorMessage(err, text));
    } finally {
      setLoading(false);
    }
  };

  const handleLdapLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLdapError(null);
    const providerId = selectedLdapProvider || ldapProviders[0]?.id || "";
    if (!providerId) {
      setError(text("noDirectoryProvider"));
      return;
    }
    setLoading(true);
    try {
      const res = await loginWithLdap(providerId, ldapUsername.trim(), ldapPassword);
      await finishLogin(res, "ldap");
    } catch (err) {
      console.error(err);
      setError(text("unableAuthenticateDirectory"));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const normalizedCustom = customEndpoint.trim().replace(/\/+$/, "");
      const normalizedSelected = selectedEndpoint.trim().replace(/\/+$/, "");
      const normalizedDefault =
        loginSettings?.default_endpoint_url?.trim().replace(/\/+$/, "") ?? "";
      const shouldSendEndpoint = allowEndpointList || allowCustomEndpoint;
      const endpointUrl = shouldSendEndpoint
        ? normalizedCustom || normalizedSelected || normalizedDefault || undefined
        : undefined;
      const res = await loginWithKeys(accessKey.trim(), secretKey.trim(), endpointUrl);
      if (endpointUrl) {
        writeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint, endpointUrl);
      } else {
        removeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
      }
      await finishLogin(res, "s3_session");
    } catch (err) {
      console.error(err);
      setError(text("unableAuthenticateAccessKeys"));
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = (next: LoginMode) => {
    setMode(next);
    setError(null);
  };

  const startOidcFlow = async (providerId: string) => {
    setOidcError(null);
    setOidcLoading(providerId);
    try {
      const { authorization_url } = await startOidcLogin(providerId);
      window.location.href = authorization_url;
    } catch (err) {
      console.error(err);
      setOidcError(text("unableStartExternalAuthentication"));
      setOidcLoading(null);
    }
  };

  const completePasskey = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = mfaStage === "mfa_enrollment_required"
        ? await (async () => {
            const options = await beginWebAuthnRegistration();
            const credential = await createPasskey(options);
            return finishWebAuthnRegistration(credential);
          })()
        : await (async () => {
            const options = await beginWebAuthnAuthentication();
            const credential = await authenticatePasskey(options);
            return finishWebAuthnAuthentication(credential);
          })();
      if (res.recovery_codes?.length) {
        setRecoveryCodes(res.recovery_codes);
        setPendingEnrollment(res);
        return;
      }
      await finishLogin(res, "password");
    } catch (err) {
      console.error(err);
      setError(text("passkeyVerificationFailed"));
    } finally {
      setLoading(false);
    }
  };

  const completeRecovery = async () => {
    setError(null);
    setLoading(true);
    try {
      await finishLogin(await verifyRecoveryCode(recoveryCode), "password");
    } catch (err) {
      console.error(err);
      setError(text("recoveryCodeInvalid"));
    } finally {
      setLoading(false);
    }
  };

  const tabClasses = (value: LoginMode) =>
    `min-w-0 rounded-lg px-2 py-2 ui-body font-semibold leading-tight transition ${
      mode === value
        ? "bg-white text-slate-900 shadow-sm ring-1 ring-primary-200"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    }`;

  const allowAccessKeys = loginSettings?.allow_login_access_keys ?? false;
  const allowEndpointList = Boolean(loginSettings?.allow_login_endpoint_list);
  const allowCustomEndpoint = Boolean(loginSettings?.allow_login_custom_endpoint);
  const endpointOptions = loginSettings?.endpoints ?? [];
  const hasLdapProviders = ldapProviders.length > 0;
  const loginModes: Array<{ value: LoginMode; label: string }> = [
    { value: "password", label: text("emailAndPassword") },
    ...(hasLdapProviders ? [{ value: "ldap" as const, label: text("directory") }] : []),
    ...(allowAccessKeys ? [{ value: "keys" as const, label: text("s3AccessKeys") }] : []),
  ];
  const loginBrandingLogoUrl = loginSettings?.login_logo_url ?? null;
  const shouldShowLeftLogo = Boolean(loginBrandingLogoUrl && !loginBrandingLogoFailed);
  useEffect(() => {
    if (!allowAccessKeys && mode === "keys") {
      setMode("password");
    }
    if (!hasLdapProviders && mode === "ldap") {
      setMode("password");
    }
  }, [allowAccessKeys, hasLdapProviders, mode]);

  if (mfaStage) {
    return (
      <AuthCenteredPage>
        <AuthCard className="max-w-md p-8">
          <BrandMark alt={PRODUCT_NAME} className="mb-5 h-16 w-16" />
          <h1 className="text-2xl font-semibold">
            {mfaStage === "mfa_enrollment_required"
              ? text("createAdministratorPasskey")
              : text("verifyPasskey")}
          </h1>
          <p className="mt-3 ui-body text-slate-600">
            {text("administratorPasskeyDescription")}
          </p>
          {error && <div className="mt-4"><UiInlineMessage tone="error">{error}</UiInlineMessage></div>}
          {!pendingEnrollment && (
            <AuthButton type="button" className="mt-6" disabled={loading} onClick={() => void completePasskey()}>
              {mfaStage === "mfa_enrollment_required"
                ? text("createPasskey")
                : text("usePasskey")}
            </AuthButton>
          )}
          {mfaStage === "mfa_required" && !pendingEnrollment && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <AuthInput
                id="recovery-code"
                label={text("recoveryCode")}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                autoComplete="one-time-code"
              />
              <button type="button" className="mt-3 ui-body font-semibold text-primary-700" disabled={loading || !recoveryCode.trim()} onClick={() => void completeRecovery()}>
                {text("useRecoveryCode")}
              </button>
            </div>
          )}
          {recoveryCodes.length > 0 && (
            <div className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-950">
              <p className="font-semibold">{text("saveRecoveryCodesNow")}</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
                {recoveryCodes.map((code) => <li key={code}>{code}</li>)}
              </ul>
              <AuthButton
                type="button"
                className="mt-5"
                disabled={loading || !pendingEnrollment}
                onClick={() => pendingEnrollment && void finishLogin(pendingEnrollment, "password")}
              >
                {text("savedRecoveryCodes")}
              </AuthButton>
            </div>
          )}
        </AuthCard>
      </AuthCenteredPage>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <AuthBrandBackdrop radial />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6">
        <div className="grid w-full items-stretch gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden rounded-3xl border border-slate-700/50 bg-slate-900/55 p-8 shadow-2xl backdrop-blur lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-800/70 px-3 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-300">
                <BrandMark className="h-7 w-7" />
                {PRODUCT_NAME}
              </div>
              <h1 className="mt-6 max-w-md text-3xl font-semibold leading-tight text-white">{text("productSubtitle")}</h1>
              <p className="mt-3 max-w-md ui-body text-slate-300">
                {text("signInWorkspaceDescription")}
              </p>
            </div>
            {shouldShowLeftLogo ? (
              <div className="flex h-full items-end">
                <div className="w-full rounded-xl border border-slate-700/70 bg-slate-900/70 px-4 py-5">
                  <img
                    src={loginBrandingLogoUrl ?? ""}
                    alt={text("companyLogo")}
                    className="mx-auto max-h-28 w-auto object-contain"
                    onError={() => setLoginBrandingLogoFailed(true)}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-4 py-3">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">{text("afterSignIn")}</p>
                  <p className="mt-1 ui-body text-slate-200">
                    {text("afterSignInDescription")}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-4 py-3">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">{text("needHelp")}</p>
                  <p className="mt-1 ui-body text-slate-200">
                    {text("needHelpDescription")}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-4 py-3">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">{text("securityNote")}</p>
                  <p className="mt-1 ui-body text-slate-200">
                    {text("securityNoteDescription")}
                  </p>
                </div>
              </div>
            )}
          </section>

          <div className="flex min-w-0 flex-col">
            <AuthCard className="flex-1 p-6 sm:p-8">
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
                <BrandMark className="h-7 w-7" />
                {PRODUCT_NAME}
              </div>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">{text("signIn")}</h2>
              <p className="mt-1 ui-body text-slate-500">{text("accountCredentials")}</p>
            </div>

            {loginModes.length > 1 && (
              <div
                className="mb-6 grid gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 p-1.5 ui-body font-semibold text-slate-600"
                style={{ gridTemplateColumns: `repeat(${loginModes.length}, minmax(0, 1fr))` }}
              >
                {loginModes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={tabClasses(item.value)}
                    onClick={() => handleModeChange(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {mode === "ldap" && hasLdapProviders ? (
              <form onSubmit={handleLdapLogin} className="space-y-4">
                {ldapProviders.length > 1 && (
                  <AuthSelect
                    id="ldap-provider"
                    label={text("directory")}
                    value={selectedLdapProvider || ldapProviders[0]?.id || ""}
                    onChange={(e) => setSelectedLdapProvider(e.target.value)}
                    required
                  >
                    {ldapProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.display_name}
                      </option>
                    ))}
                  </AuthSelect>
                )}
                <AuthInput id="ldap-username" label={text("username")} type="text" autoComplete="username" value={ldapUsername} onChange={(e) => setLdapUsername(e.target.value)} placeholder={text("usernamePlaceholder")} required />
                <AuthPasswordInput id="ldap-password" label={text("password")} autoComplete="current-password" value={ldapPassword} onChange={(e) => setLdapPassword(e.target.value)} required />
                {(error || ldapError) && (
                  <UiInlineMessage tone="error">{error || ldapError}</UiInlineMessage>
                )}
                <AuthButton type="submit" disabled={loading}>
                  {loading ? text("signingIn") : text("signInWithDirectory")}
                </AuthButton>
              </form>
            ) : mode === "password" || !allowAccessKeys ? (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <AuthInput id="login-email" label={text("email")} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <AuthPasswordInput id="login-password" label={text("password")} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                {error && (
                  <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>
                )}
                <AuthButton type="submit" disabled={loading}>
                  {loading ? text("signingIn") : text("signIn")}
                </AuthButton>
              </form>
            ) : (
              <form onSubmit={handleKeyLogin} className="space-y-4">
                <AuthInput id="login-access-key" label={text("accessKey")} type="text" autoComplete="username" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder={text("accessKeyPlaceholder")} required />
                <AuthPasswordInput id="login-secret-key" label={text("secretKey")} secretLabel={text("secretKeyActionLabel")} autoComplete="current-password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} required />
                {(allowEndpointList || allowCustomEndpoint) && (
                  <div className="space-y-3">
                    {allowEndpointList && (
                      <div>
                        <AuthSelect id="login-endpoint" label={text("endpoint")} value={selectedEndpoint} onChange={(e) => setSelectedEndpoint(e.target.value)} disabled={endpointLoading}>
                          {endpointLoading && <option value="">{text("loadingEndpoints")}</option>}
                          {!endpointLoading && <option value="">{text("selectEndpoint")}</option>}
                          {!endpointLoading &&
                            endpointOptions.map((endpoint) => (
                              <option key={endpoint.id} value={endpoint.endpoint_url} title={endpoint.endpoint_url}>
                                {endpoint.is_default
                                  ? text("defaultEndpoint", { name: endpoint.name })
                                  : endpoint.name}
                              </option>
                            ))}
                        </AuthSelect>
                        {!endpointLoading && endpointOptions.length === 0 && (
                          <p className="mt-1 ui-caption text-slate-500">
                            {allowCustomEndpoint
                              ? text("noEndpointUseCustom")
                              : text("noEndpointAskAdmin")}
                          </p>
                        )}
                      </div>
                    )}
                    {allowCustomEndpoint && (
                      <div>
                        <AuthInput id="login-custom-endpoint" label={text("customEndpointOptional")} type="url" autoComplete="url" value={customEndpoint} onChange={(e) => setCustomEndpoint(e.target.value)} placeholder={text("customEndpointPlaceholder")} />
                        {allowEndpointList && (
                          <p className="mt-1 ui-caption text-slate-500">{text("customEndpointOverrides")}</p>
                        )}
                      </div>
                    )}
                    {endpointError && (
                      <UiInlineMessage tone="error">{endpointError}</UiInlineMessage>
                    )}
                  </div>
                )}
                {error && (
                  <UiInlineMessage tone="error">{error}</UiInlineMessage>
                )}
                <AuthButton type="submit" disabled={loading}>
                  {loading ? text("connecting") : text("connectWithKeys")}
                </AuthButton>
              </form>
            )}

            {oidcProviders.length > 0 && (
              <div className="mt-6 space-y-2">
                <div className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>{text("or")}</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                {oidcProviders.map((provider) => (
                  <AuthButton
                    key={provider.id}
                    type="button"
                    onClick={() => startOidcFlow(provider.id)}
                    disabled={Boolean(oidcLoading)}
                    presentation="provider"
                  >
                    {oidcLoading === provider.id
                      ? text("redirecting")
                      : text("continueWithProvider", { provider: provider.display_name })}
                  </AuthButton>
                ))}
                {oidcError && (
                  <UiInlineMessage tone="error">{oidcError}</UiInlineMessage>
                )}
              </div>
            )}
            </AuthCard>
            <AppVersion className="mt-3 block text-center text-slate-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
