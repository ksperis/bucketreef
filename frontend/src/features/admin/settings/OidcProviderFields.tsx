/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { OidcProviderAdminItem } from "../../../api/authSettings";
import { SettingsSection } from "../../../components/settings/SettingsLayout";
import UiCheckboxField from "../../../components/ui/UiCheckboxField";
import UiInput from "../../../components/ui/UiInput";
import UiSelect from "../../../components/ui/UiSelect";
import UiTextarea from "../../../components/ui/UiTextarea";
import { AuthProviderIdentityFields, AuthProviderSecretField, AuthProviderToggle, authProviderFieldState } from "./AuthProviderFields";
import type { OidcProviderFormState } from "./authProviderForms";
import { useAdminI18n } from "../adminI18n";

export default function OidcProviderFields({ form, update, provider, readOnly, errors }: {
  form: OidcProviderFormState;
  update: <K extends keyof OidcProviderFormState>(key: K, value: OidcProviderFormState[K]) => void;
  provider: OidcProviderAdminItem | null;
  readOnly: boolean;
  errors: Partial<Record<keyof OidcProviderFormState, string>>;
}) {
  const { text: adminText } = useAdminI18n();
  const state = authProviderFieldState(provider, readOnly);
  return <div className="settings-stack">
    <AuthProviderIdentityFields form={form} errors={errors} state={state}
      onIdChange={value => update("provider_id", value)} onNameChange={value => update("display_name", value)}
      onEnabledChange={value => update("enabled", value)} />
    <SettingsSection title={adminText("Connection")} description={adminText("Configure the identity provider and the application's registered OIDC client.")} presentation="compact">
      <div className="settings-fields">
        <UiInput label={adminText("Discovery URL")} value={form.discovery_url} required disabled={state.locked("discovery_url")}
          hint={state.hint("discovery_url")} error={errors.discovery_url} onChange={event => update("discovery_url", event.target.value)} />
        <UiInput label={adminText("Client ID")} value={form.client_id} required disabled={state.locked("client_id")}
          hint={state.hint("client_id")} error={errors.client_id} onChange={event => update("client_id", event.target.value)} />
        <UiInput label={adminText("Redirect URI")} value={form.redirect_uri} required disabled={state.locked("redirect_uri")}
          hint={state.hint("redirect_uri")} error={errors.redirect_uri} onChange={event => update("redirect_uri", event.target.value)} />
        <AuthProviderSecretField label={adminText("Client secret")} value={form.client_secret} stored={Boolean(provider?.has_client_secret)}
          locked={state.locked("client_secret")} disabled={form.clear_client_secret} clearing={form.clear_client_secret}
          hint={state.hint("client_secret")}
          error={errors.client_secret} onChange={value => update("client_secret", value)} />
        {provider?.has_client_secret && !state.locked("client_secret") && <UiCheckboxField className="settings-choice"
          checked={form.clear_client_secret} onChange={event => update("clear_client_secret", event.target.checked)}>
          {adminText("Clear stored client secret")}</UiCheckboxField>}
      </div>
    </SettingsSection>
    <SettingsSection title={adminText("Sign-in options")} description={adminText("Control the requested claims and login presentation.")} presentation="compact">
      <div className="settings-fields">
        <UiTextarea label={adminText("Scopes")} value={form.scopesText} rows={3} disabled={state.locked("scopes")}
          hint={state.hint("scopes", "Separate scopes with new lines or commas.")} error={errors.scopesText}
          onChange={event => update("scopesText", event.target.value)} />
        <div className="settings-fields sm:grid-cols-2">
          <UiInput label={adminText("Prompt")} value={form.prompt} disabled={state.locked("prompt")}
            hint={state.hint("prompt")} error={errors.prompt} onChange={event => update("prompt", event.target.value)} />
          <UiInput label={adminText("Icon URL")} value={form.icon_url} disabled={state.locked("icon_url")}
            hint={state.hint("icon_url")} error={errors.icon_url} onChange={event => update("icon_url", event.target.value)} />
        </div>
      </div>
    </SettingsSection>
    <SettingsSection title={adminText("Protocol security")} description={adminText("Configure the OIDC request protections.")} presentation="compact">
      <AuthProviderToggle label={adminText("Use PKCE")} field="use_pkce" checked={form.use_pkce} state={state} onChange={value => update("use_pkce", value)} />
      <AuthProviderToggle label={adminText("Use nonce")} field="use_nonce" checked={form.use_nonce} state={state} onChange={value => update("use_nonce", value)} />
    </SettingsSection>
    <SettingsSection title={adminText("Identity linking")} description={adminText("Choose how new external identities may link to existing local accounts.")} presentation="compact">
      <div className="settings-fields">
        <UiSelect label={adminText("Identity linking policy")} value={form.linking_policy} disabled={state.locked("linking_policy")}
          hint={state.hint("linking_policy", "Trusted email linking applies only to active standard local-password accounts without any prior external identity.")}
          error={errors.linking_policy} onChange={event => update("linking_policy", event.target.value as "manual" | "trusted_email")}>
          <option value="manual">{adminText("Manual approval")}</option>
          <option value="trusted_email">{adminText("Trusted verified email")}</option>
        </UiSelect>
        <UiTextarea label={adminText("Trusted email domains")} value={form.trustedEmailDomainsText} rows={3}
          disabled={state.locked("trusted_email_domains") || form.linking_policy !== "trusted_email"}
          hint={state.hint("trusted_email_domains", "Enter exact domains, one per line. Subdomains are not matched implicitly.")}
          error={errors.trustedEmailDomainsText} onChange={event => update("trustedEmailDomainsText", event.target.value)} />
      </div>
    </SettingsSection>
  </div>;
}
