/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { User } from "./users";

export type AuthUser = User;

type SessionCapabilities = {
  can_manage_iam: boolean;
  can_manage_buckets: boolean;
  can_view_traffic: boolean;
  access_browser: boolean;
  endpoint_url?: string | null;
};

export type AuthSessionDescriptor = {
    session_id: string;
    actor_type: string;
    account_id?: string | null;
    account_name?: string | null;
    user_uid?: string | null;
    capabilities: SessionCapabilities;
};

export type AuthenticationResponse = {
  status: "authenticated" | "mfa_required" | "mfa_enrollment_required" | "link_approval_required";
  user: AuthUser | null;
  session: AuthSessionDescriptor | null;
  redirect_path: string | null;
  link_request_id: string | null;
  recovery_codes: string[] | null;
};

type FirstAdminBootstrapStatus = {
  available: boolean;
};

type FirstAdminBootstrapPayload = {
  email: string;
  full_name?: string | null;
  password: string;
  password_confirmation: string;
};

export async function fetchFirstAdminBootstrapStatus(): Promise<FirstAdminBootstrapStatus> {
  const { data } = await client.get<FirstAdminBootstrapStatus>(
    "/auth/bootstrap/first-admin/status",
  );
  return data;
}

export async function bootstrapFirstAdmin(
  token: string,
  payload: FirstAdminBootstrapPayload,
): Promise<AuthenticationResponse> {
  const { data } = await client.post<AuthenticationResponse>(
    "/auth/bootstrap/first-admin",
    payload,
    { headers: { "X-BucketReef-Bootstrap-Token": token } },
  );
  return data;
}

export type AuthSessionInfo = {
  id: string;
  principal_type: string;
  auth_type: string;
  created_at: string;
  last_activity_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  mfa_verified_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  current: boolean;
  user_id: number | null;
  s3_session_id: string | null;
};

export type CurrentSessionResponse = {
  authenticated: true;
  user: AuthUser | null;
  session: AuthSessionDescriptor | null;
  auth_session: AuthSessionInfo;
};

export async function login(email: string, password: string): Promise<AuthenticationResponse> {
  const formData = new URLSearchParams();
  formData.append("username", email);
  formData.append("password", password);
  formData.append("grant_type", "password");

  const { data } = await client.post<AuthenticationResponse>("/auth/login", formData, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return data;
}

export type LDAPProviderInfo = {
  id: string;
  display_name: string;
};

export async function fetchLdapProviders(): Promise<LDAPProviderInfo[]> {
  const { data } = await client.get<LDAPProviderInfo[]>("/auth/ldap/providers");
  return data;
}

export async function loginWithLdap(
  providerId: string,
  username: string,
  password: string,
): Promise<AuthenticationResponse> {
  const { data } = await client.post<AuthenticationResponse>(`/auth/ldap/${providerId}/login`, {
    username,
    password,
  });
  return data;
}

export async function loginWithKeys(
  accessKey: string,
  secretKey: string,
  endpointUrl?: string,
): Promise<AuthenticationResponse> {
  const { data } = await client.post<AuthenticationResponse>("/auth/login-s3", {
    access_key: accessKey,
    secret_key: secretKey,
    endpoint_url: endpointUrl,
  });
  return data;
}

export type OidcProviderInfo = {
  id: string;
  display_name: string;
  icon_url: string | null;
};

type OidcStartResponse = {
  provider: string;
  authorization_url: string;
  state: string;
};

export async function fetchOidcProviders(): Promise<OidcProviderInfo[]> {
  const { data } = await client.get<OidcProviderInfo[]>("/auth/oidc/providers");
  return data;
}

export async function startOidcLogin(providerId: string, redirectPath?: string): Promise<OidcStartResponse> {
  const { data } = await client.post<OidcStartResponse>(`/auth/oidc/${providerId}/start`, {
    redirect_path: redirectPath,
  });
  return data;
}

export async function completeOidcLogin(
  providerId: string,
  code: string,
  state: string,
): Promise<AuthenticationResponse> {
  const { data } = await client.post<AuthenticationResponse>(`/auth/oidc/${providerId}/callback`, {
    code,
    state,
  });
  return data;
}

export async function logout(): Promise<void> {
  await client.post("/auth/logout");
}

export async function fetchCurrentSession(): Promise<CurrentSessionResponse> {
  const { data } = await client.get<CurrentSessionResponse>("/auth/session");
  return data;
}

export async function beginWebAuthnRegistration(): Promise<Record<string, unknown> & { challenge: string }> {
  const { data } = await client.post<Record<string, unknown> & { challenge: string }>("/auth/webauthn/registration/options");
  return data;
}

export async function finishWebAuthnRegistration(credential: unknown, name = "Passkey"): Promise<AuthenticationResponse> {
  const { data } = await client.post<AuthenticationResponse>("/auth/webauthn/registration/verify", { credential, name });
  return data;
}

export async function beginWebAuthnAuthentication(): Promise<Record<string, unknown> & { challenge: string }> {
  const { data } = await client.post<Record<string, unknown> & { challenge: string }>("/auth/webauthn/authentication/options");
  return data;
}

export async function finishWebAuthnAuthentication(credential: unknown): Promise<AuthenticationResponse> {
  const { data } = await client.post<AuthenticationResponse>("/auth/webauthn/authentication/verify", { credential });
  return data;
}

export async function verifyRecoveryCode(code: string): Promise<AuthenticationResponse> {
  const { data } = await client.post<AuthenticationResponse>("/auth/recovery/verify", { code });
  return data;
}
