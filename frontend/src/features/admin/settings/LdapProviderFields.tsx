/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { LdapProviderAdminItem } from "../../../api/authSettings";
import { SettingsSection } from "../../../components/settings/SettingsLayout";
import UiInput from "../../../components/ui/UiInput";
import UiTextarea from "../../../components/ui/UiTextarea";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { AuthProviderIdentityFields, AuthProviderSecretField, AuthProviderToggle, authProviderFieldState } from "./AuthProviderFields";
import type { LdapProviderFormState } from "./authProviderForms";

export default function LdapProviderFields({ form, update, provider, readOnly, errors }: {
  form: LdapProviderFormState;
  update: <K extends keyof LdapProviderFormState>(key: K, value: LdapProviderFormState[K]) => void;
  provider: LdapProviderAdminItem | null;
  readOnly: boolean;
  errors: Partial<Record<keyof LdapProviderFormState, string>>;
}) {
  const state = authProviderFieldState(provider, readOnly);
  return <div className="settings-stack">
    <AuthProviderIdentityFields form={form} errors={errors} state={state} prefix="LDAP "
      onIdChange={value => update("provider_id", value)} onNameChange={value => update("display_name", value)}
      onEnabledChange={value => update("enabled", value)} />
    <SettingsSection title="Connection" description="Configure directory access and the optional service bind identity." presentation="compact">
      <div className="settings-fields">
        <UiInput label="URL" aria-label="LDAP URL" value={form.url} required disabled={state.locked("url")}
          hint={state.hint("url")} error={errors.url} onChange={event => update("url", event.target.value)} />
        <UiInput label="Bind DN (optional)" aria-label="LDAP Bind DN" value={form.bind_dn} disabled={state.locked("bind_dn")}
          hint={state.hint("bind_dn", "Leave both bind fields empty to search the directory anonymously.")} error={errors.bind_dn}
          onChange={event => update("bind_dn", event.target.value)} />
        <AuthProviderSecretField label="Bind password (optional)" ariaLabel="LDAP Bind password" value={form.bind_password}
          stored={Boolean(provider?.has_bind_password)} locked={state.locked("bind_password")}
          clearing={Boolean(provider?.has_bind_password) && !form.bind_dn.trim()}
          required={Boolean(form.bind_dn.trim()) && !provider?.has_bind_password} hint={state.hint("bind_password")}
          error={errors.bind_password} onChange={value => update("bind_password", value)} />
        <UiInput label="Timeout seconds" aria-label="LDAP Timeout seconds" type="number" min="0.1" max="60" step="0.1"
          value={form.timeout_seconds} required disabled={state.locked("timeout_seconds")}
          hint={state.hint("timeout_seconds")} error={errors.timeout_seconds} onChange={event => update("timeout_seconds", event.target.value)} />
      </div>
    </SettingsSection>
    <SettingsSection title="User search" description="Define where and how a login name is resolved in the directory." presentation="compact">
      <div className="settings-fields">
        <UiInput label="User base DN" aria-label="LDAP User base DN" value={form.user_base_dn} required disabled={state.locked("user_base_dn")}
          hint={state.hint("user_base_dn")} error={errors.user_base_dn} onChange={event => update("user_base_dn", event.target.value)} />
        <UiTextarea label="User filter" aria-label="LDAP User filter" value={form.user_filter} rows={3} required disabled={state.locked("user_filter")}
          hint={state.hint("user_filter")} error={errors.user_filter} onChange={event => update("user_filter", event.target.value)} />
      </div>
    </SettingsSection>
    <SettingsSection title="Identity mapping" description="Map directory attributes to the user's email, name and stable identity." presentation="compact">
      <div className="settings-fields sm:grid-cols-2">
        <UiInput label="Email attribute" aria-label="LDAP Email attribute" value={form.email_attribute} required disabled={state.locked("email_attribute")}
          hint={state.hint("email_attribute")} error={errors.email_attribute} onChange={event => update("email_attribute", event.target.value)} />
        <UiInput label="Name attribute" aria-label="LDAP Name attribute" value={form.name_attribute} disabled={state.locked("name_attribute")}
          hint={state.hint("name_attribute")} error={errors.name_attribute} onChange={event => update("name_attribute", event.target.value)} />
        <UiInput label="Subject attribute" aria-label="LDAP Subject attribute" value={form.subject_attribute} disabled={state.locked("subject_attribute")}
          hint={state.hint("subject_attribute")} error={errors.subject_attribute} onChange={event => update("subject_attribute", event.target.value)} />
      </div>
    </SettingsSection>
    <SettingsSection title="Transport security" description="Configure TLS and explicit compatibility exceptions for this directory." presentation="compact">
      <div className="settings-fields">
        <div>
          <AuthProviderToggle label="Start TLS" field="start_tls" checked={form.start_tls} state={state} onChange={value => update("start_tls", value)} />
          <AuthProviderToggle label="Verify TLS" field="tls_verify" checked={form.tls_verify} state={state} onChange={value => update("tls_verify", value)} />
          <AuthProviderToggle label="Allow legacy TLS ciphers" ariaLabel="Allow legacy LDAP TLS ciphers" field="allow_legacy_tls"
            checked={form.allow_legacy_tls} state={state} onChange={value => update("allow_legacy_tls", value)} />
          <AuthProviderToggle label="Allow insecure LDAP" field="allow_insecure" checked={form.allow_insecure} state={state} onChange={value => update("allow_insecure", value)} />
        </div>
        {form.allow_legacy_tls && <UiInlineMessage tone="warning">
          Legacy TLS compatibility enables the OpenSSL DEFAULT cipher set. Prefer enabling modern ECDHE cipher suites on the LDAP server.
        </UiInlineMessage>}
        <UiInput label="TLS CA file" aria-label="LDAP TLS CA file" value={form.tls_ca_file} disabled={state.locked("tls_ca_file")}
          hint={state.hint("tls_ca_file")} error={errors.tls_ca_file} onChange={event => update("tls_ca_file", event.target.value)} />
      </div>
    </SettingsSection>
  </div>;
}
