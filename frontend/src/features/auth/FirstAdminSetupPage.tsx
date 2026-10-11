/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useLayoutEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  bootstrapFirstAdmin,
  fetchFirstAdminBootstrapStatus,
} from "../../api/auth";
import { useSession } from "../../auth/SessionProvider";
import BrandMark from "../../components/BrandMark";
import ErrorState from "../../components/errors/ErrorState";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { PRODUCT_NAME } from "../../constants/product";
import { extractApiError } from "../../utils/apiError";
import { AuthButton, AuthInput } from "./AuthFormControls";
import { AuthCard, AuthCenteredPage } from "./AuthSurface";
import { useAuthI18n } from "./authMessages";


function readBootstrapTokenFragment(): string {
  if (typeof window === "undefined") return "";
  const fragment = window.location.hash.replace(/^#/, "");
  return new URLSearchParams(fragment).get("token")?.trim() ?? "";
}

function clearBootstrapTokenFragment(): void {
  if (typeof window === "undefined") return;
  if (window.location.hash) {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }
}

export default function FirstAdminSetupPage() {
  const navigate = useNavigate();
  const { refresh: refreshSession } = useSession();
  const { text } = useAuthI18n();
  const [token] = useState(readBootstrapTokenFragment);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<unknown>(null);

  useLayoutEffect(() => {
    clearBootstrapTokenFragment();
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchFirstAdminBootstrapStatus()
      .then((status) => {
        if (!mounted) return;
        if (!status.available) {
          navigate("/login", { replace: true });
          return;
        }
        if (!token) {
          setError(text("bootstrapTokenMissingComplete"));
        }
      })
      .catch((statusError) => {
        if (mounted) {
          setAvailabilityError(statusError);
        }
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, [navigate, text, token]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError(text("bootstrapTokenMissingIssue"));
      return;
    }
    if (password !== passwordConfirmation) {
      setError(text("passwordsMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const response = await bootstrapFirstAdmin(token, {
        email: email.trim(),
        full_name: fullName.trim() || null,
        password,
        password_confirmation: passwordConfirmation,
      });
      if (response.status === "authenticated") {
        const session = await refreshSession();
        if (!session) {
          throw new Error(text("administratorSessionLoadFailed"));
        }
        navigate("/", { replace: true });
        return;
      }
      if (response.status === "mfa_enrollment_required") {
        navigate("/login?mfa=mfa_enrollment_required", { replace: true });
        return;
      }
      throw new Error(text("administratorAuthIncomplete"));
    } catch (submitError) {
      setError(
        extractApiError(
          submitError,
          text("bootstrapLinkInvalid"),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!checking && availabilityError) return <ErrorState error={availabilityError} presentation="full" onRetry={async () => {
    // The single-use token has already been removed from the address bar.
    // Retry in place so a transient outage cannot discard it through a reload.
    const status = await fetchFirstAdminBootstrapStatus();
    if (!status.available) navigate("/login", { replace: true });
    else setAvailabilityError(null);
  }} />;
  if (!checking && !token) return <ErrorState kind="invalid_link" presentation="full" />;

  return (
    <AuthCenteredPage radial className="py-10">
      <AuthCard className="max-w-lg p-7 sm:p-8">
        <BrandMark alt={PRODUCT_NAME} className="mb-5 h-16 w-16" />
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary-700">
          {text("initialSetup")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          {text("createFirstAdministrator")}
        </h1>
        <p className="mt-3 ui-body text-slate-600">
          {text("firstAdministratorDescription")}
        </p>

        {error ? (
          <div className="mt-5">
            <UiInlineMessage tone="error">{error}</UiInlineMessage>
          </div>
        ) : null}

        {checking ? (
          <p className="mt-6 ui-body text-slate-600">
            {text("checkingBootstrapLink")}
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <AuthInput
              id="bootstrap-full-name"
              label={text("fullName")}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
            />
            <AuthInput
              id="bootstrap-email"
              label={text("email")}
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />
            <div>
              <AuthInput
                id="bootstrap-password"
                label={text("password")}
                type="password"
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                aria-describedby="bootstrap-password-help"
              />
              <span
                id="bootstrap-password-help"
                className="mt-1 block ui-caption text-slate-500"
              >
                {text("passwordHelp")}
              </span>
            </div>
            <AuthInput
              id="bootstrap-password-confirmation"
              label={text("confirmPassword")}
              type="password"
              required
              minLength={12}
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              autoComplete="new-password"
            />
            <AuthButton
              type="submit"
              disabled={
                submitting ||
                !token ||
                !email.trim() ||
                password.length < 12 ||
                passwordConfirmation.length < 12
              }
            >
              {submitting
                ? text("creatingAdministrator")
                : text("createAdministrator")}
            </AuthButton>
          </form>
        )}
        <p className="mt-5 ui-caption text-slate-500">
          {text("alreadyInitialized")}{" "}
          <Link className="font-semibold text-primary-700" to="/login">
            {text("returnToSignIn")}
          </Link>
        </p>
      </AuthCard>
    </AuthCenteredPage>
  );
}
