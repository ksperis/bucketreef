/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import {
  settingsHelperClassName,
  settingsInputClassName,
  settingsLabelClassName,
  SettingsSwitch,
  settingsCheckboxClassName,
} from "../../../components/settings/SettingsLayout";
import type { OidcProviderAdminItem } from "../../../api/authSettings";
import type { OidcProviderFormState } from "./authProviderForms";
export default function OidcProviderFields({
  form: oidcForm,
  update: updateOidcFormField,
  provider: selectedOidcProvider,
  readOnly: oidcFormReadOnly,
  errors,
}: {
  form: OidcProviderFormState;
  update: <K extends keyof OidcProviderFormState>(
    key: K,
    value: OidcProviderFormState[K],
  ) => void;
  provider: OidcProviderAdminItem | null;
  readOnly: boolean;
  errors: Partial<Record<keyof OidcProviderFormState, string>>;
}) {
  const isOidcFieldLocked = (field: string) =>
    oidcFormReadOnly ||
    (field === "provider_id" && Boolean(selectedOidcProvider)) ||
    Boolean(selectedOidcProvider?.field_locks?.[field]?.forced);
  const oidcLockHint = (field: string) =>
    selectedOidcProvider?.field_locks?.[field]?.forced ? (
      <p className={settingsHelperClassName}>
        Forced by{" "}
        {selectedOidcProvider.field_locks[field].source ?? "environment"}.
      </p>
    ) : null;
  return (
    <div className="settings-fields">
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className={settingsLabelClassName}>Provider ID</span>
          <input
            aria-label="Provider ID"
            className={settingsInputClassName}
            value={oidcForm.provider_id}
            onChange={(event) =>
              updateOidcFormField("provider_id", event.target.value)
            }
            disabled={isOidcFieldLocked("provider_id")}
            required
            aria-invalid={Boolean(errors.provider_id)}
            aria-describedby={
              errors.provider_id ? "oidc-provider_id-error" : undefined
            }
          />
          {errors.provider_id && (
            <p
              id="oidc-provider_id-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.provider_id}
            </p>
          )}
          {oidcLockHint("provider_id")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Display name</span>
          <input
            aria-label="Display name"
            className={settingsInputClassName}
            value={oidcForm.display_name}
            onChange={(event) =>
              updateOidcFormField("display_name", event.target.value)
            }
            disabled={isOidcFieldLocked("display_name")}
            required
            aria-invalid={Boolean(errors.display_name)}
            aria-describedby={
              errors.display_name ? "oidc-display_name-error" : undefined
            }
          />
          {errors.display_name && (
            <p
              id="oidc-display_name-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.display_name}
            </p>
          )}
          {oidcLockHint("display_name")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Discovery URL</span>
          <input
            aria-label="Discovery URL"
            className={settingsInputClassName}
            value={oidcForm.discovery_url}
            onChange={(event) =>
              updateOidcFormField("discovery_url", event.target.value)
            }
            disabled={isOidcFieldLocked("discovery_url")}
            required
            aria-invalid={Boolean(errors.discovery_url)}
            aria-describedby={
              errors.discovery_url ? "oidc-discovery_url-error" : undefined
            }
          />
          {errors.discovery_url && (
            <p
              id="oidc-discovery_url-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.discovery_url}
            </p>
          )}
          {oidcLockHint("discovery_url")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Client ID</span>
          <input
            aria-label="Client ID"
            className={settingsInputClassName}
            value={oidcForm.client_id}
            onChange={(event) =>
              updateOidcFormField("client_id", event.target.value)
            }
            disabled={isOidcFieldLocked("client_id")}
            required
            aria-invalid={Boolean(errors.client_id)}
            aria-describedby={
              errors.client_id ? "oidc-client_id-error" : undefined
            }
          />
          {errors.client_id && (
            <p
              id="oidc-client_id-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.client_id}
            </p>
          )}
          {oidcLockHint("client_id")}
        </label>
        <label className="block md:col-span-2">
          <span className={settingsLabelClassName}>Redirect URI</span>
          <input
            aria-label="Redirect URI"
            className={settingsInputClassName}
            value={oidcForm.redirect_uri}
            onChange={(event) =>
              updateOidcFormField("redirect_uri", event.target.value)
            }
            disabled={isOidcFieldLocked("redirect_uri")}
            required
            aria-invalid={Boolean(errors.redirect_uri)}
            aria-describedby={
              errors.redirect_uri ? "oidc-redirect_uri-error" : undefined
            }
          />
          {errors.redirect_uri && (
            <p
              id="oidc-redirect_uri-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.redirect_uri}
            </p>
          )}
          {oidcLockHint("redirect_uri")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Scopes</span>
          <textarea
            aria-label="Scopes"
            className={settingsInputClassName}
            value={oidcForm.scopesText}
            onChange={(event) =>
              updateOidcFormField("scopesText", event.target.value)
            }
            disabled={isOidcFieldLocked("scopes")}
            rows={4}
            aria-invalid={Boolean(errors.scopesText)}
            aria-describedby={
              errors.scopesText ? "oidc-scopesText-error" : undefined
            }
          />
          {errors.scopesText && (
            <p
              id="oidc-scopesText-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.scopesText}
            </p>
          )}
          {oidcLockHint("scopes")}
        </label>
        <div className="space-y-4">
          <label className="block">
            <span className={settingsLabelClassName}>Prompt</span>
            <input
              aria-label="Prompt"
              className={settingsInputClassName}
              value={oidcForm.prompt}
              onChange={(event) =>
                updateOidcFormField("prompt", event.target.value)
              }
              disabled={isOidcFieldLocked("prompt")}
              aria-invalid={Boolean(errors.prompt)}
              aria-describedby={errors.prompt ? "oidc-prompt-error" : undefined}
            />
            {errors.prompt && (
              <p
                id="oidc-prompt-error"
                role="alert"
                className="text-xs text-rose-700 dark:text-rose-300"
              >
                {errors.prompt}
              </p>
            )}
            {oidcLockHint("prompt")}
          </label>
          <label className="block">
            <span className={settingsLabelClassName}>Icon URL</span>
            <input
              aria-label="Icon URL"
              className={settingsInputClassName}
              value={oidcForm.icon_url}
              onChange={(event) =>
                updateOidcFormField("icon_url", event.target.value)
              }
              disabled={isOidcFieldLocked("icon_url")}
              aria-invalid={Boolean(errors.icon_url)}
              aria-describedby={
                errors.icon_url ? "oidc-icon_url-error" : undefined
              }
            />
            {errors.icon_url && (
              <p
                id="oidc-icon_url-error"
                role="alert"
                className="text-xs text-rose-700 dark:text-rose-300"
              >
                {errors.icon_url}
              </p>
            )}
            {oidcLockHint("icon_url")}
          </label>
        </div>
        <label className="block">
          <span className={settingsLabelClassName}>
            Identity linking policy
          </span>
          <select
            aria-label="Identity linking policy"
            className={settingsInputClassName}
            value={oidcForm.linking_policy}
            onChange={(event) =>
              updateOidcFormField(
                "linking_policy",
                event.target.value as "manual" | "trusted_email",
              )
            }
            disabled={isOidcFieldLocked("linking_policy")}
          >
            <option value="manual">Manual approval</option>
            <option value="trusted_email">Trusted verified email</option>
          </select>
          <p className={settingsHelperClassName}>
            Trusted email linking applies only to active standard local-password
            accounts without any prior external identity.
          </p>
          {oidcLockHint("linking_policy")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Trusted email domains</span>
          <textarea
            aria-label="Trusted email domains"
            className={settingsInputClassName}
            value={oidcForm.trustedEmailDomainsText}
            onChange={(event) =>
              updateOidcFormField("trustedEmailDomainsText", event.target.value)
            }
            disabled={
              isOidcFieldLocked("trusted_email_domains") ||
              oidcForm.linking_policy !== "trusted_email"
            }
            rows={3}
            placeholder="example.com"
            aria-invalid={Boolean(errors.trustedEmailDomainsText)}
            aria-describedby={
              errors.trustedEmailDomainsText
                ? "oidc-trustedEmailDomainsText-error"
                : undefined
            }
          />
          {errors.trustedEmailDomainsText && (
            <p
              id="oidc-trustedEmailDomainsText-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.trustedEmailDomainsText}
            </p>
          )}
          <p className={settingsHelperClassName}>
            Enter exact domains, one per line. Subdomains are not matched
            implicitly.
          </p>
          {oidcLockHint("trusted_email_domains")}
        </label>
        <label className="block md:col-span-2">
          <span className={settingsLabelClassName}>Client secret</span>
          <input
            aria-label="Client secret"
            className={settingsInputClassName}
            type="password"
            value={oidcForm.client_secret}
            onChange={(event) =>
              updateOidcFormField("client_secret", event.target.value)
            }
            disabled={
              isOidcFieldLocked("client_secret") || oidcForm.clear_client_secret
            }
            placeholder={
              selectedOidcProvider?.has_client_secret
                ? "Stored secret is not displayed"
                : ""
            }
            aria-invalid={Boolean(errors.client_secret)}
            aria-describedby={
              errors.client_secret ? "oidc-client_secret-error" : undefined
            }
          />
          {errors.client_secret && (
            <p
              id="oidc-client_secret-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.client_secret}
            </p>
          )}
          {oidcLockHint("client_secret")}
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="flex items-center justify-between gap-3">
          <span>Enabled</span>
          <SettingsSwitch
            ariaLabel="Enabled"
            checked={oidcForm.enabled}
            onChange={(value) => updateOidcFormField("enabled", value)}
            disabled={isOidcFieldLocked("enabled")}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Use PKCE</span>
          <SettingsSwitch
            ariaLabel="Use PKCE"
            checked={oidcForm.use_pkce}
            onChange={(value) => updateOidcFormField("use_pkce", value)}
            disabled={isOidcFieldLocked("use_pkce")}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Use nonce</span>
          <SettingsSwitch
            ariaLabel="Use nonce"
            checked={oidcForm.use_nonce}
            onChange={(value) => updateOidcFormField("use_nonce", value)}
            disabled={isOidcFieldLocked("use_nonce")}
          />
        </div>
        <label className="settings-choice ui-body text-[var(--ui-text)]">
          <input
            type="checkbox"
            checked={oidcForm.clear_client_secret}
            onChange={(event) =>
              updateOidcFormField("clear_client_secret", event.target.checked)
            }
            disabled={
              oidcFormReadOnly || !selectedOidcProvider?.has_client_secret
            }
            className={settingsCheckboxClassName}
            aria-invalid={Boolean(errors.clear_client_secret)}
            aria-describedby={
              errors.clear_client_secret
                ? "oidc-clear_client_secret-error"
                : undefined
            }
          />
          {errors.clear_client_secret && (
            <p
              id="oidc-clear_client_secret-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.clear_client_secret}
            </p>
          )}
          Clear stored client secret
        </label>
      </div>
    </div>
  );
}
