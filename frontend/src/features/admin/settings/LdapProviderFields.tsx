/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import {
  settingsHelperClassName,
  settingsInputClassName,
  settingsLabelClassName,
  SettingsSwitch,
} from "../../../components/settings/SettingsLayout";
import type { LdapProviderAdminItem } from "../../../api/authSettings";
import type { LdapProviderFormState } from "./authProviderForms";
export default function LdapProviderFields({
  form: ldapForm,
  update: updateLdapFormField,
  provider: selectedLdapProvider,
  readOnly: ldapFormReadOnly,
  errors,
}: {
  form: LdapProviderFormState;
  update: <K extends keyof LdapProviderFormState>(
    key: K,
    value: LdapProviderFormState[K],
  ) => void;
  provider: LdapProviderAdminItem | null;
  readOnly: boolean;
  errors: Partial<Record<keyof LdapProviderFormState, string>>;
}) {
  const isLdapFieldLocked = (field: string) =>
    ldapFormReadOnly ||
    (field === "provider_id" && Boolean(selectedLdapProvider)) ||
    Boolean(selectedLdapProvider?.field_locks?.[field]?.forced);
  const ldapLockHint = (field: string) =>
    selectedLdapProvider?.field_locks?.[field]?.forced ? (
      <p className={settingsHelperClassName}>
        Forced by{" "}
        {selectedLdapProvider.field_locks[field].source ?? "environment"}.
      </p>
    ) : null;
  return (
    <div className="settings-fields">
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className={settingsLabelClassName}>Provider ID</span>
          <input
            aria-label="LDAP Provider ID"
            className={settingsInputClassName}
            value={ldapForm.provider_id}
            onChange={(event) =>
              updateLdapFormField("provider_id", event.target.value)
            }
            disabled={isLdapFieldLocked("provider_id")}
            required
            aria-invalid={Boolean(errors.provider_id)}
            aria-describedby={
              errors.provider_id ? "ldap-provider_id-error" : undefined
            }
          />
          {errors.provider_id && (
            <p
              id="ldap-provider_id-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.provider_id}
            </p>
          )}
          {ldapLockHint("provider_id")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Display name</span>
          <input
            aria-label="LDAP Display name"
            className={settingsInputClassName}
            value={ldapForm.display_name}
            onChange={(event) =>
              updateLdapFormField("display_name", event.target.value)
            }
            disabled={isLdapFieldLocked("display_name")}
            required
            aria-invalid={Boolean(errors.display_name)}
            aria-describedby={
              errors.display_name ? "ldap-display_name-error" : undefined
            }
          />
          {errors.display_name && (
            <p
              id="ldap-display_name-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.display_name}
            </p>
          )}
          {ldapLockHint("display_name")}
        </label>
        <label className="block md:col-span-2">
          <span className={settingsLabelClassName}>URL</span>
          <input
            aria-label="LDAP URL"
            className={settingsInputClassName}
            value={ldapForm.url}
            onChange={(event) => updateLdapFormField("url", event.target.value)}
            disabled={isLdapFieldLocked("url")}
            required
            aria-invalid={Boolean(errors.url)}
            aria-describedby={errors.url ? "ldap-url-error" : undefined}
          />
          {errors.url && (
            <p
              id="ldap-url-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.url}
            </p>
          )}
          {ldapLockHint("url")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Bind DN (optional)</span>
          <input
            aria-label="LDAP Bind DN"
            className={settingsInputClassName}
            value={ldapForm.bind_dn}
            onChange={(event) =>
              updateLdapFormField("bind_dn", event.target.value)
            }
            disabled={isLdapFieldLocked("bind_dn")}
            aria-invalid={Boolean(errors.bind_dn)}
            aria-describedby={errors.bind_dn ? "ldap-bind_dn-error" : undefined}
          />
          {errors.bind_dn && (
            <p
              id="ldap-bind_dn-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.bind_dn}
            </p>
          )}
          <p className={settingsHelperClassName}>
            Leave both bind fields empty to search the directory anonymously.
          </p>
          {ldapLockHint("bind_dn")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>
            Bind password (optional)
          </span>
          <input
            aria-label="LDAP Bind password"
            className={settingsInputClassName}
            type="password"
            value={ldapForm.bind_password}
            onChange={(event) =>
              updateLdapFormField("bind_password", event.target.value)
            }
            disabled={isLdapFieldLocked("bind_password")}
            placeholder={
              selectedLdapProvider?.has_bind_password
                ? "Stored password is not displayed"
                : ""
            }
            required={
              Boolean(ldapForm.bind_dn.trim()) &&
              !selectedLdapProvider?.has_bind_password
            }
            aria-invalid={Boolean(errors.bind_password)}
            aria-describedby={
              errors.bind_password ? "ldap-bind_password-error" : undefined
            }
          />
          {errors.bind_password && (
            <p
              id="ldap-bind_password-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.bind_password}
            </p>
          )}
          {ldapLockHint("bind_password")}
        </label>
        <label className="block md:col-span-2">
          <span className={settingsLabelClassName}>User base DN</span>
          <input
            aria-label="LDAP User base DN"
            className={settingsInputClassName}
            value={ldapForm.user_base_dn}
            onChange={(event) =>
              updateLdapFormField("user_base_dn", event.target.value)
            }
            disabled={isLdapFieldLocked("user_base_dn")}
            required
            aria-invalid={Boolean(errors.user_base_dn)}
            aria-describedby={
              errors.user_base_dn ? "ldap-user_base_dn-error" : undefined
            }
          />
          {errors.user_base_dn && (
            <p
              id="ldap-user_base_dn-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.user_base_dn}
            </p>
          )}
          {ldapLockHint("user_base_dn")}
        </label>
        <label className="block md:col-span-2">
          <span className={settingsLabelClassName}>User filter</span>
          <textarea
            aria-label="LDAP User filter"
            className={settingsInputClassName}
            value={ldapForm.user_filter}
            onChange={(event) =>
              updateLdapFormField("user_filter", event.target.value)
            }
            disabled={isLdapFieldLocked("user_filter")}
            rows={3}
            required
            aria-invalid={Boolean(errors.user_filter)}
            aria-describedby={
              errors.user_filter ? "ldap-user_filter-error" : undefined
            }
          />
          {errors.user_filter && (
            <p
              id="ldap-user_filter-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.user_filter}
            </p>
          )}
          {ldapLockHint("user_filter")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Email attribute</span>
          <input
            aria-label="LDAP Email attribute"
            className={settingsInputClassName}
            value={ldapForm.email_attribute}
            onChange={(event) =>
              updateLdapFormField("email_attribute", event.target.value)
            }
            disabled={isLdapFieldLocked("email_attribute")}
            required
            aria-invalid={Boolean(errors.email_attribute)}
            aria-describedby={
              errors.email_attribute ? "ldap-email_attribute-error" : undefined
            }
          />
          {errors.email_attribute && (
            <p
              id="ldap-email_attribute-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.email_attribute}
            </p>
          )}
          {ldapLockHint("email_attribute")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Name attribute</span>
          <input
            aria-label="LDAP Name attribute"
            className={settingsInputClassName}
            value={ldapForm.name_attribute}
            onChange={(event) =>
              updateLdapFormField("name_attribute", event.target.value)
            }
            disabled={isLdapFieldLocked("name_attribute")}
            aria-invalid={Boolean(errors.name_attribute)}
            aria-describedby={
              errors.name_attribute ? "ldap-name_attribute-error" : undefined
            }
          />
          {errors.name_attribute && (
            <p
              id="ldap-name_attribute-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.name_attribute}
            </p>
          )}
          {ldapLockHint("name_attribute")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Subject attribute</span>
          <input
            aria-label="LDAP Subject attribute"
            className={settingsInputClassName}
            value={ldapForm.subject_attribute}
            onChange={(event) =>
              updateLdapFormField("subject_attribute", event.target.value)
            }
            disabled={isLdapFieldLocked("subject_attribute")}
            aria-invalid={Boolean(errors.subject_attribute)}
            aria-describedby={
              errors.subject_attribute
                ? "ldap-subject_attribute-error"
                : undefined
            }
          />
          {errors.subject_attribute && (
            <p
              id="ldap-subject_attribute-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.subject_attribute}
            </p>
          )}
          {ldapLockHint("subject_attribute")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>TLS CA file</span>
          <input
            aria-label="LDAP TLS CA file"
            className={settingsInputClassName}
            value={ldapForm.tls_ca_file}
            onChange={(event) =>
              updateLdapFormField("tls_ca_file", event.target.value)
            }
            disabled={isLdapFieldLocked("tls_ca_file")}
            aria-invalid={Boolean(errors.tls_ca_file)}
            aria-describedby={
              errors.tls_ca_file ? "ldap-tls_ca_file-error" : undefined
            }
          />
          {errors.tls_ca_file && (
            <p
              id="ldap-tls_ca_file-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.tls_ca_file}
            </p>
          )}
          {ldapLockHint("tls_ca_file")}
        </label>
        <label className="block">
          <span className={settingsLabelClassName}>Timeout seconds</span>
          <input
            aria-label="LDAP Timeout seconds"
            className={settingsInputClassName}
            type="number"
            min="0.1"
            max="60"
            step="0.1"
            value={ldapForm.timeout_seconds}
            onChange={(event) =>
              updateLdapFormField("timeout_seconds", event.target.value)
            }
            disabled={isLdapFieldLocked("timeout_seconds")}
            required
            aria-invalid={Boolean(errors.timeout_seconds)}
            aria-describedby={
              errors.timeout_seconds ? "ldap-timeout_seconds-error" : undefined
            }
          />
          {errors.timeout_seconds && (
            <p
              id="ldap-timeout_seconds-error"
              role="alert"
              className="text-xs text-rose-700 dark:text-rose-300"
            >
              {errors.timeout_seconds}
            </p>
          )}
          {ldapLockHint("timeout_seconds")}
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="flex items-center justify-between gap-3">
          <span>Enabled</span>
          <SettingsSwitch
            ariaLabel="Enabled"
            checked={ldapForm.enabled}
            onChange={(value) => updateLdapFormField("enabled", value)}
            disabled={isLdapFieldLocked("enabled")}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Start TLS</span>
          <SettingsSwitch
            ariaLabel="Start TLS"
            checked={ldapForm.start_tls}
            onChange={(value) => updateLdapFormField("start_tls", value)}
            disabled={isLdapFieldLocked("start_tls")}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Verify TLS</span>
          <SettingsSwitch
            ariaLabel="Verify TLS"
            checked={ldapForm.tls_verify}
            onChange={(value) => updateLdapFormField("tls_verify", value)}
            disabled={isLdapFieldLocked("tls_verify")}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Allow legacy TLS ciphers</span>
          <SettingsSwitch
            ariaLabel="Allow legacy LDAP TLS ciphers"
            checked={ldapForm.allow_legacy_tls}
            onChange={(value) => updateLdapFormField("allow_legacy_tls", value)}
            disabled={isLdapFieldLocked("allow_legacy_tls")}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Allow insecure LDAP</span>
          <SettingsSwitch
            ariaLabel="Allow insecure LDAP"
            checked={ldapForm.allow_insecure}
            onChange={(value) => updateLdapFormField("allow_insecure", value)}
            disabled={isLdapFieldLocked("allow_insecure")}
          />
        </div>
      </div>
      {ldapForm.allow_legacy_tls && (
        <p className={settingsHelperClassName}>
          Legacy TLS compatibility enables the OpenSSL DEFAULT cipher set.
          Prefer enabling modern ECDHE cipher suites on the LDAP server.
        </p>
      )}
    </div>
  );
}
