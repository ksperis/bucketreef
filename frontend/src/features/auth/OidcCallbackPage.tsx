/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { completeOidcLogin } from "../../api/auth";
import { fetchGeneralSettings } from "../../api/appSettings";
import { getWorkspaceAccess } from "../../api/executionContexts";
import { DEFAULT_GENERAL_SETTINGS, useGeneralSettings } from "../../components/GeneralSettingsContext";
import BrandMark from "../../components/BrandMark";
import { useLanguage } from "../../components/language";
import { useTheme } from "../../components/theme";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { PRODUCT_NAME } from "../../constants/product";
import { useSession } from "../../auth/SessionProvider";
import { coordinateOidcCallback } from "./oidcCallbackCoordinator";
import { prefetchWorkspaceBranch } from "../../utils/routePrefetch";
import {
  resolvePostLoginPath,
  resolvePostLoginPathWithWorkspaceAccess,
  type SessionUser,
} from "../../utils/workspaces";
import { AuthButton } from "./AuthFormControls";
import { AuthCard, AuthCenteredPage } from "./AuthSurface";

export default function OidcCallbackPage() {
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { runtimeSurfaces, setGeneralSettings } = useGeneralSettings();
  const { setLanguagePreference } = useLanguage();
  const { setTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);
  const { acceptAuthentication } = useSession();

  useEffect(() => {
    let cancelled = false;
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!provider) {
      setProcessing(false);
      setError("Missing identity provider.");
      return;
    }
    const providerId = provider;
    if (!code || !state) {
      setProcessing(false);
      setError("Incomplete authentication response.");
      return;
    }
    const codeValue = code;
    const stateValue = state;

    async function finalizeLogin() {
      try {
        const res = await coordinateOidcCallback(
          providerId,
          codeValue,
          stateValue,
          completeOidcLogin,
        );
        if (cancelled) return;
        if (res.status === "mfa_required" || res.status === "mfa_enrollment_required") {
          navigate(`/login?mfa=${res.status}`, { replace: true });
          return;
        }
        if (res.status === "link_approval_required") {
          setError("This identity must be approved by a superadministrator before it can be linked.");
          setProcessing(false);
          return;
        }
        if (!res.user) throw new Error("OIDC session did not return a user");
        acceptAuthentication(res, "oidc");
        const sessionUser: SessionUser = { ...res.user, authType: "oidc" };
        setLanguagePreference(res.user.ui_language ?? "auto");
        if (res.user.ui_preferences?.theme === "light" || res.user.ui_preferences?.theme === "dark") {
          setTheme(res.user.ui_preferences.theme);
        }
        let settings = DEFAULT_GENERAL_SETTINGS;
        try {
          settings = await fetchGeneralSettings();
          setGeneralSettings(settings);
        } catch (loadError) {
          console.error(loadError);
        }
        let baseDestination = resolvePostLoginPath(sessionUser, settings, runtimeSurfaces);
        try {
          const workspaceAccess = await getWorkspaceAccess();
          baseDestination = resolvePostLoginPathWithWorkspaceAccess(
            sessionUser,
            settings,
            workspaceAccess,
            runtimeSurfaces,
          );
        } catch (workspaceError) {
          console.error(workspaceError);
        }
        const destination = baseDestination;
        prefetchWorkspaceBranch(destination);
        navigate(destination, { replace: true });
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Unable to complete the sign-in. Please try again.");
          setProcessing(false);
        }
      }
    }

    finalizeLogin();
    return () => {
      cancelled = true;
    };
  }, [acceptAuthentication, navigate, provider, runtimeSurfaces, searchParams, setGeneralSettings, setLanguagePreference, setTheme]);

  return (
    <AuthCenteredPage>
      <AuthCard className="max-w-md p-8 text-center">
          <BrandMark alt={PRODUCT_NAME} className="mx-auto mb-5 h-16 w-16" />
          <h1 className="mb-2 text-2xl font-semibold text-slate-900">Signing you in</h1>
          {processing && <p className="ui-body text-slate-500">Please wait...</p>}
          {error && (
            <>
              <UiInlineMessage tone="error">{error}</UiInlineMessage>
              <AuthButton
                type="button"
                className="mt-6"
                onClick={() => navigate("/login", { replace: true })}
              >
                Back to login
              </AuthButton>
            </>
          )}
      </AuthCard>
    </AuthCenteredPage>
  );
}
