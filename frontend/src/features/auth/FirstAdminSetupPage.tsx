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
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { PRODUCT_NAME } from "../../constants/product";
import { extractApiError } from "../../utils/apiError";
import { AuthButton, AuthInput } from "./AuthFormControls";
import { AuthCard, AuthCenteredPage } from "./AuthSurface";


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
  const [token] = useState(readBootstrapTokenFragment);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          setError(
            "The bootstrap token is missing. Open the complete one-time URL issued by the backend.",
          );
        }
      })
      .catch((statusError) => {
        if (mounted) {
          setError(
            extractApiError(
              statusError,
              "Unable to check bootstrap availability.",
            ),
          );
        }
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, [navigate, token]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError(
        "The bootstrap token is missing. Issue a new one-time URL from the backend.",
      );
      return;
    }
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
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
          throw new Error("The administrator session could not be loaded.");
        }
        navigate("/", { replace: true });
        return;
      }
      if (response.status === "mfa_enrollment_required") {
        navigate("/login?mfa=mfa_enrollment_required", { replace: true });
        return;
      }
      throw new Error("Administrator authentication did not complete.");
    } catch (submitError) {
      setError(
        extractApiError(
          submitError,
          "The bootstrap link is invalid, expired, or already used.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCenteredPage radial className="py-10">
      <AuthCard className="max-w-lg p-7 sm:p-8">
        <BrandMark alt={PRODUCT_NAME} className="mb-5 h-16 w-16" />
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary-700">
          Initial setup
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          Create the first administrator
        </h1>
        <p className="mt-3 ui-body text-slate-600">
          This one-time setup creates the platform super-administrator. A
          passkey is optional during onboarding and should be enabled before
          production.
        </p>

        {error ? (
          <div className="mt-5">
            <UiInlineMessage tone="error">{error}</UiInlineMessage>
          </div>
        ) : null}

        {checking ? (
          <p className="mt-6 ui-body text-slate-600">
            Checking the bootstrap link…
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <AuthInput
              id="bootstrap-full-name"
              label="Full name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
            />
            <AuthInput
              id="bootstrap-email"
              label="Email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />
            <div>
              <AuthInput
                id="bootstrap-password"
                label="Password"
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
                Use at least 12 characters.
              </span>
            </div>
            <AuthInput
              id="bootstrap-password-confirmation"
              label="Confirm password"
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
                ? "Creating administrator…"
                : "Create administrator"}
            </AuthButton>
          </form>
        )}
        <p className="mt-5 ui-caption text-slate-500">
          Already initialized?{" "}
          <Link className="font-semibold text-primary-700" to="/login">
            Return to sign in
          </Link>
        </p>
      </AuthCard>
    </AuthCenteredPage>
  );
}
