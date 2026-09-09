/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type {
  OidcProviderAdminItem,
  OidcProviderAdminPayload,
  LdapProviderAdminItem,
  LdapProviderAdminPayload,
} from "../../../api/authSettings";

export type OidcProviderFormState = {
  provider_id: string;
  display_name: string;
  discovery_url: string;
  client_id: string;
  redirect_uri: string;
  scopesText: string;
  prompt: string;
  icon_url: string;
  enabled: boolean;
  use_pkce: boolean;
  use_nonce: boolean;
  client_secret: string;
  clear_client_secret: boolean;
  linking_policy: "manual" | "trusted_email";
  trustedEmailDomainsText: string;
};

export type LdapProviderFormState = {
  provider_id: string;
  display_name: string;
  url: string;
  bind_dn: string;
  bind_password: string;
  user_base_dn: string;
  user_filter: string;
  email_attribute: string;
  name_attribute: string;
  subject_attribute: string;
  start_tls: boolean;
  tls_verify: boolean;
  tls_ca_file: string;
  allow_legacy_tls: boolean;
  timeout_seconds: string;
  enabled: boolean;
  allow_insecure: boolean;
};

const LDAP_DEFAULT_USER_FILTER =
  "(|(mail={username})(uid={username})(sAMAccountName={username})(userPrincipalName={username}))";

export function emptyOidcForm(): OidcProviderFormState {
  return {
    provider_id: "",
    display_name: "",
    discovery_url: "",
    client_id: "",
    redirect_uri: "",
    scopesText: "openid\nemail\nprofile",
    prompt: "",
    icon_url: "",
    enabled: true,
    use_pkce: true,
    use_nonce: true,
    client_secret: "",
    clear_client_secret: false,
    linking_policy: "manual",
    trustedEmailDomainsText: "",
  };
}

export function oidcProviderToForm(
  provider: OidcProviderAdminItem,
): OidcProviderFormState {
  return {
    provider_id: provider.provider_id,
    display_name: provider.display_name,
    discovery_url: provider.discovery_url,
    client_id: provider.client_id,
    redirect_uri: provider.redirect_uri,
    scopesText: provider.scopes.join("\n"),
    prompt: provider.prompt ?? "",
    icon_url: provider.icon_url ?? "",
    enabled: provider.enabled,
    use_pkce: provider.use_pkce,
    use_nonce: provider.use_nonce,
    client_secret: "",
    clear_client_secret: false,
    linking_policy: provider.linking_policy ?? "manual",
    trustedEmailDomainsText: (provider.trusted_email_domains ?? []).join("\n"),
  };
}

export function oidcPayloadFromForm(
  form: OidcProviderFormState,
): OidcProviderAdminPayload {
  const clientSecret = form.client_secret.trim();
  return {
    provider_id: form.provider_id.trim().toLowerCase(),
    display_name: form.display_name.trim(),
    discovery_url: form.discovery_url.trim(),
    client_id: form.client_id.trim(),
    redirect_uri: form.redirect_uri.trim(),
    scopes: form.scopesText
      .split(/[\n,]/)
      .map((scope) => scope.trim())
      .filter(Boolean),
    prompt: form.prompt.trim() || null,
    icon_url: form.icon_url.trim() || null,
    enabled: form.enabled,
    use_pkce: form.use_pkce,
    use_nonce: form.use_nonce,
    client_secret: clientSecret || null,
    clear_client_secret: form.clear_client_secret,
    linking_policy: form.linking_policy,
    trusted_email_domains: form.trustedEmailDomainsText
      .split(/[\n,]/)
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  };
}

export function emptyLdapForm(): LdapProviderFormState {
  return {
    provider_id: "",
    display_name: "",
    url: "ldaps://",
    bind_dn: "",
    bind_password: "",
    user_base_dn: "",
    user_filter: LDAP_DEFAULT_USER_FILTER,
    email_attribute: "mail",
    name_attribute: "displayName",
    subject_attribute: "",
    start_tls: false,
    tls_verify: true,
    tls_ca_file: "",
    allow_legacy_tls: false,
    timeout_seconds: "5",
    enabled: true,
    allow_insecure: false,
  };
}

export function ldapProviderToForm(
  provider: LdapProviderAdminItem,
): LdapProviderFormState {
  return {
    provider_id: provider.provider_id,
    display_name: provider.display_name,
    url: provider.url,
    bind_dn: provider.bind_dn ?? "",
    bind_password: "",
    user_base_dn: provider.user_base_dn,
    user_filter: provider.user_filter,
    email_attribute: provider.email_attribute,
    name_attribute: provider.name_attribute ?? "",
    subject_attribute: provider.subject_attribute ?? "",
    start_tls: provider.start_tls,
    tls_verify: provider.tls_verify,
    tls_ca_file: provider.tls_ca_file ?? "",
    allow_legacy_tls: provider.allow_legacy_tls,
    timeout_seconds: String(provider.timeout_seconds),
    enabled: provider.enabled,
    allow_insecure: provider.allow_insecure,
  };
}

export function ldapPayloadFromForm(
  form: LdapProviderFormState,
): LdapProviderAdminPayload {
  const bindDn = form.bind_dn.trim();
  const bindPassword = form.bind_password.trim();
  const timeoutSeconds = Number.parseFloat(form.timeout_seconds);
  return {
    provider_id: form.provider_id.trim().toLowerCase(),
    display_name: form.display_name.trim(),
    url: form.url.trim(),
    bind_dn: bindDn || null,
    bind_password: bindPassword || null,
    user_base_dn: form.user_base_dn.trim(),
    user_filter: form.user_filter.trim(),
    email_attribute: form.email_attribute.trim(),
    name_attribute: form.name_attribute.trim() || null,
    subject_attribute: form.subject_attribute.trim() || null,
    start_tls: form.start_tls,
    tls_verify: form.tls_verify,
    tls_ca_file: form.tls_ca_file.trim() || null,
    allow_legacy_tls: form.allow_legacy_tls,
    timeout_seconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : 5,
    enabled: form.enabled,
    allow_insecure: form.allow_insecure,
    clear_bind_password: !bindDn,
  };
}
