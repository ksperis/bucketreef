/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiTextarea from "../../components/ui/UiTextarea";
import type { CephAdminUserCapsMode } from "./cephAdminUserForm";
import { useCephAdminI18n } from "./cephAdminI18n";

type ProfileValues = { displayName: string; email: string; maxBuckets: string; opMask: string };

export function CephAdminUserProfileFields({ values, onChange, maxBucketsError, maxBucketsHint, children }: {
  values: ProfileValues;
  onChange: (field: keyof ProfileValues, value: string) => void;
  maxBucketsError?: string;
  maxBucketsHint?: string;
  children?: ReactNode;
}) {
  const { text: surfaceText } = useCephAdminI18n();
  return (
    <div className="settings-fields md:grid-cols-2">
      <UiInput label={surfaceText("Display name")} value={values.displayName} onChange={(event) => onChange("displayName", event.target.value)} />
      <UiInput label={surfaceText("Email")} type="email" value={values.email} onChange={(event) => onChange("email", event.target.value)} />
      <UiInput label={surfaceText("Max buckets")} type="number" min={0} step={1} value={values.maxBuckets}
        onChange={(event) => onChange("maxBuckets", event.target.value)} error={maxBucketsError} hint={maxBucketsHint} />
      <UiInput label={surfaceText("Op mask")} value={values.opMask} onChange={(event) => onChange("opMask", event.target.value)}
        placeholder={surfaceText("read,write,delete")} />
      {children}
    </div>
  );
}

type FlagValues = { suspended: boolean; admin: boolean; system: boolean };

export function CephAdminUserFlags({ values, onChange, readOnlyFields = [], children }: {
  values: FlagValues;
  onChange: (field: keyof FlagValues, value: boolean) => void;
  readOnlyFields?: readonly (keyof FlagValues)[];
  children?: ReactNode;
}) {
  const { text: surfaceText } = useCephAdminI18n();
  return (
    <SettingsSection title={surfaceText("Flags")} presentation="compact">
      <div className="settings-fields sm:grid-cols-2">
        {([ ["suspended", "Suspended"], ["admin", "Admin"], ["system", "System"] ] as const).map(([field, label]) => (
          <UiCheckboxField key={field} className="settings-choice" checked={values[field]}
            disabled={readOnlyFields.includes(field)}
            onChange={(event) => onChange(field, event.target.checked)}>{surfaceText(label)}</UiCheckboxField>
        ))}
        {children}
      </div>
    </SettingsSection>
  );
}

export function CephAdminUserCapsFields({ mode, onModeChange, value, onChange }: {
  mode: CephAdminUserCapsMode;
  onModeChange: (value: CephAdminUserCapsMode) => void;
  value: string;
  onChange: (value: string) => void;
}) {
  const { text: surfaceText } = useCephAdminI18n();
  return (
    <SettingsSection title={surfaceText("Caps")} presentation="compact">
      <div className="settings-fields">
        <UiSelect label={surfaceText("Caps mode")} value={mode} onChange={(event) => onModeChange(event.target.value as CephAdminUserCapsMode)}>
          <option value="replace">{surfaceText("Replace")}</option>
          <option value="add">{surfaceText("Add")}</option>
          <option value="remove">{surfaceText("Remove")}</option>
        </UiSelect>
        <UiTextarea label={surfaceText("Caps")} hint={surfaceText("One capability per line, for example users=read.")} rows={4} spellCheck={false}
          value={value} onChange={(event) => onChange(event.target.value)} className="font-mono" />
      </div>
    </SettingsSection>
  );
}
