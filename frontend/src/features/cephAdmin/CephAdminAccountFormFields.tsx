/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import { rgwAccountNameFormatError } from "../../utils/rgwAccountName";
import { ACCOUNT_LIMIT_FIELDS, type CephAdminAccountProfileValues, type CephAdminAccountProfileErrors } from "./cephAdminAccountForm";
import { useCephAdminI18n } from "./cephAdminI18n";

export default function CephAdminAccountFormFields({ values, onChange, errors, creating = false }: {
  values: CephAdminAccountProfileValues;
  onChange: (field: keyof CephAdminAccountProfileValues, value: string) => void;
  errors?: CephAdminAccountProfileErrors;
  creating?: boolean;
}) {
  const { text: surfaceText } = useCephAdminI18n();
  const liveNameError = rgwAccountNameFormatError(values.accountName);
  return <>
    <SettingsSection title={surfaceText("Account")} presentation="compact">
      <div className="settings-fields md:grid-cols-2">
        <UiInput label={surfaceText("Account name")} required={creating} value={values.accountName}
          onChange={(event) => onChange("accountName", event.target.value)} error={errors?.accountName ?? liveNameError} />
        <UiInput label={surfaceText("Email")} type="email" value={values.email}
          onChange={(event) => onChange("email", event.target.value)} />
      </div>
    </SettingsSection>
    <SettingsSection title={surfaceText("Limits")} presentation="compact"
      description={creating
        ? surfaceText("Leave empty to use the cluster defaults.")
        : surfaceText("Leave empty to clear a limit.")}>
      <div className="settings-fields md:grid-cols-2">
        {ACCOUNT_LIMIT_FIELDS.map(([field, label]) => (
          <UiInput key={field} label={surfaceText(label)} type="number" min={0} step={1} value={values[field]}
            onChange={(event) => onChange(field, event.target.value)} error={errors?.[field]} />
        ))}
      </div>
    </SettingsSection>
  </>;
}
