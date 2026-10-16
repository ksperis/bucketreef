/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { LdapProviderAdminItem } from "../../../api/authSettings";
import { SettingsSection } from "../../../components/settings/SettingsLayout";
import UiInput from "../../../components/ui/UiInput";
import UiTextarea from "../../../components/ui/UiTextarea";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { AuthProviderIdentityFields, AuthProviderSecretField, AuthProviderToggle, authProviderFieldState } from "./AuthProviderFields";
import type { LdapProviderFormState } from "./authProviderForms";
import { useAdminI18n } from "../adminI18n";

export default function LdapProviderFields({ form, update, provider, readOnly, errors }: {
  form: LdapProviderFormState;
  update: <K extends keyof LdapProviderFormState>(key: K, value: LdapProviderFormState[K]) => void;
  provider: LdapProviderAdminItem | null;
  readOnly: boolean;
  errors: Partial<Record<keyof LdapProviderFormState, string>>;
}) {
  const { text: adminText } = useAdminI18n();
  const state = authProviderFieldState(provider, readOnly);
  return <div className="settings-stack">
    <AuthProviderIdentityFields form={form} errors={errors} state={state} prefix="LDAP "
      onIdChange={value => update("provider_id", value)} onNameChange={value => update("display_name", value)}
      onEnabledChange={value => update("enabled", value)} />
    <SettingsSection title={adminText("Connection")} description={adminText("Configure directory access and the optional service bind identity.")} presentation="compact">
      <div className="settings-fields">
        <UiInput label="URL" aria-label={adminText("LDAP URL")} value={form.url} required disabled={state.locked("url")}
          hint={state.hint("url")} error={errors.url} onChange={event => update("url", event.target.value)} />
        <UiInput label={adminText("Bind DN (optional)")} aria-label={adminText("LDAP Bind DN")} value={form.bind_dn} disabled={state.locked("bind_dn")}
          hint={state.hint("bind_dn", "Leave both bind fields empty to search the directory anonymously.")} error={errors.bind_dn}
          onChange={event => update("bind_dn", event.target.value)} />
        <AuthProviderSecretField label={adminText("Bind password (optional)")} ariaLabel={adminText("LDAP Bind password")} value={form.bind_password}
          stored={Boolean(provider?.has_bind_password)} locked={state.locked("bind_password")}
          clearing={Boolean(provider?.has_bind_password) && !form.bind_dn.trim()}
          required={Boolean(form.bind_dn.trim()) && !provider?.has_bind_password} hint={state.hint("bind_password")}
          error={errors.bind_password} onChange={value => update("bind_password", value)} />
        <UiInput label={adminText("Timeout seconds")} aria-label={adminText("LDAP Timeout seconds")} type="number" min="0.1" max="60" step="0.1"
          value={form.timeout_seconds} required disabled={state.locked("timeout_seconds")}
          hint={state.hint("timeout_seconds")} error={errors.timeout_seconds} onChange={event => update("timeout_seconds", event.target.value)} />
      </div>
    </SettingsSection>
    <SettingsSection title={adminText("User search")} description={adminText("Define where and how a login name is resolved in the directory.")} presentation="compact">
      <div className="settings-fields">
        <UiInput label={adminText("User base DN")} aria-label={adminText("LDAP User base DN")} value={form.user_base_dn} required disabled={state.locked("user_base_dn")}
          hint={state.hint("user_base_dn")} error={errors.user_base_dn} onChange={event => update("user_base_dn", event.target.value)} />
        <UiTextarea label={adminText("User filter")} aria-label={adminText("LDAP User filter")} value={form.user_filter} rows={3} required disabled={state.locked("user_filter")}
          hint={state.hint("user_filter")} error={errors.user_filter} onChange={event => update("user_filter", event.target.value)} />
      </div>
    </SettingsSection>
    <SettingsSection title={adminText("Identity mapping")} description={adminText("Map directory attributes to the user's email, name and stable identity.")} presentation="compact">
      <div className="settings-fields sm:grid-cols-2">
        <UiInput label={adminText("Email attribute")} aria-label={adminText("LDAP Email attribute")} value={form.email_attribute} required disabled={state.locked("email_attribute")}
          hint={state.hint("email_attribute")} error={errors.email_attribute} onChange={event => update("email_attribute", event.target.value)} />
        <UiInput label={adminText("Name attribute")} aria-label={adminText("LDAP Name attribute")} value={form.name_attribute} disabled={state.locked("name_attribute")}
          hint={state.hint("name_attribute")} error={errors.name_attribute} onChange={event => update("name_attribute", event.target.value)} />
        <UiInput label={adminText("Subject attribute")} aria-label={adminText("LDAP Subject attribute")} value={form.subject_attribute} disabled={state.locked("subject_attribute")}
          hint={state.hint("subject_attribute")} error={errors.subject_attribute} onChange={event => update("subject_attribute", event.target.value)} />
      </div>
    </SettingsSection>
    <SettingsSection title={adminText("Transport security")} description={adminText("Configure TLS and explicit compatibility exceptions for this directory.")} presentation="compact">
      <div className="settings-fields">
        <div>
          <AuthProviderToggle label={adminText("Start TLS")} field="start_tls" checked={form.start_tls} state={state} onChange={value => update("start_tls", value)} />
          <AuthProviderToggle label={adminText("Verify TLS")} field="tls_verify" checked={form.tls_verify} state={state} onChange={value => update("tls_verify", value)} />
          <AuthProviderToggle label={adminText("Allow legacy TLS ciphers")} ariaLabel={adminText("Allow legacy LDAP TLS ciphers")} field="allow_legacy_tls"
            checked={form.allow_legacy_tls} state={state} onChange={value => update("allow_legacy_tls", value)} />
          <AuthProviderToggle label={adminText("Allow insecure LDAP")} field="allow_insecure" checked={form.allow_insecure} state={state} onChange={value => update("allow_insecure", value)} />
        </div>
        {form.allow_legacy_tls && <UiInlineMessage tone="warning">
          {adminText("Legacy TLS compatibility enables the OpenSSL DEFAULT cipher set. Prefer enabling modern ECDHE cipher suites on the LDAP server.")}</UiInlineMessage>}
        <UiInput label={adminText("TLS CA file")} aria-label={adminText("LDAP TLS CA file")} value={form.tls_ca_file} disabled={state.locked("tls_ca_file")}
          hint={state.hint("tls_ca_file")} error={errors.tls_ca_file} onChange={event => update("tls_ca_file", event.target.value)} />
      </div>
    </SettingsSection>
  </div>;
}
