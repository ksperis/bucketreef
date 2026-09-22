/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useId } from "react";
import { SettingsItem, SettingsSection, SettingsSwitch } from "../../../components/settings/SettingsLayout";
import UiField from "../../../components/ui/UiField";
import UiInput from "../../../components/ui/UiInput";

type FieldLocks = { field_locks: Record<string, { forced: boolean; source?: string | null }> };

/** Provider fields keep their API lock names even when the draft uses text adapters. */
export function authProviderFieldState(provider: FieldLocks | null, readOnly: boolean) {
  return {
    locked: (field: string) => readOnly || (field === "provider_id" && Boolean(provider)) || Boolean(provider?.field_locks[field]?.forced),
    hint: (field: string, description?: string) => {
      const lock = provider?.field_locks[field];
      return [description, lock?.forced ? `Forced by ${lock.source ?? "environment"}.` : undefined].filter(Boolean).join(" ") || undefined;
    },
  };
}

export function AuthProviderToggle({ label, ariaLabel = label, field, checked, onChange, state, description }: {
  label: string;
  ariaLabel?: string;
  field: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  state: ReturnType<typeof authProviderFieldState>;
  description?: string;
}) {
  const hintId = useId();
  const hint = state.hint(field, description);
  return <SettingsItem title={label} compact description={hint ? <span id={hintId}>{hint}</span> : undefined}
    action={<SettingsSwitch ariaLabel={ariaLabel} ariaDescribedBy={hint ? hintId : undefined}
      checked={checked} disabled={state.locked(field)} onChange={onChange} />} />;
}

export function AuthProviderIdentityFields({ form, state, errors, prefix = "", onIdChange, onNameChange, onEnabledChange }: {
  form: { provider_id: string; display_name: string; enabled: boolean };
  state: ReturnType<typeof authProviderFieldState>;
  errors: { provider_id?: string; display_name?: string };
  prefix?: string;
  onIdChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
}) {
  return <SettingsSection title="Identity" description="Identify the provider and control its availability on the login page." presentation="compact">
    <div className="settings-fields">
      <div className="settings-fields sm:grid-cols-2">
        <UiInput label="Provider ID" aria-label={`${prefix}Provider ID`} value={form.provider_id} required
          disabled={state.locked("provider_id")} hint={state.hint("provider_id")} error={errors.provider_id}
          onChange={event => onIdChange(event.target.value)} />
        <UiInput label="Display name" aria-label={`${prefix}Display name`} value={form.display_name} required
          disabled={state.locked("display_name")} hint={state.hint("display_name")} error={errors.display_name}
          onChange={event => onNameChange(event.target.value)} />
      </div>
      <AuthProviderToggle label="Enabled" field="enabled" checked={form.enabled} onChange={onEnabledChange} state={state} />
    </div>
  </SettingsSection>;
}

/** Stored values are never rendered or prefilled; replacements remain write-only. */
export function AuthProviderSecretField({ label, ariaLabel = label, value, stored, locked, clearing = false, disabled = false, required = false, hint, error, onChange }: {
  label: string;
  ariaLabel?: string;
  value: string;
  stored: boolean;
  locked: boolean;
  clearing?: boolean;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  if (locked) return <UiField label={label} hint={hint}>
    {({ id, describedBy }) => <output id={id} aria-label={ariaLabel} aria-describedby={describedBy} className="settings-readonly">
      {stored ? "Stored — value hidden" : "Not configured"}
    </output>}
  </UiField>;
  return <UiInput label={label} aria-label={ariaLabel} type="password" autoComplete="new-password" value={value}
    disabled={disabled} required={required} error={error}
    hint={[clearing ? "The stored secret will be removed when you save." : stored ? "A secret is stored. Leave this field empty to keep it." : "No secret is stored.", hint].filter(Boolean).join(" ")}
    onChange={event => onChange(event.target.value)} />;
}
