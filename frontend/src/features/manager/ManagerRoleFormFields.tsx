/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";

type Props = {
  name: string;
  path: string;
  policy: string;
  editing?: boolean;
  onNameChange?: (value: string) => void;
  onPathChange?: (value: string) => void;
  onPolicyChange: (value: string) => void;
  nameError?: string;
  policyError?: string;
};

export default function ManagerRoleFormFields({
  name, path, policy, editing = false, onNameChange, onPathChange, onPolicyChange, nameError, policyError,
}: Props) {
  return <>
    <SettingsSection title="Identity" presentation="compact">
      <div className="settings-fields md:grid-cols-2">
        <UiInput label="Role name" value={name} required={!editing} readOnly={editing}
          onChange={(event) => onNameChange?.(event.target.value)} placeholder="Role name" error={nameError} />
        <UiInput label={editing ? "Role path" : "Role path (optional)"} value={path} readOnly={editing}
          onChange={(event) => onPathChange?.(event.target.value)} placeholder="/application/"
          hint={editing ? "Path is fixed at creation. Create a new role to use a different path." : 'Defaults to "/". Sets the IAM path prefix for the role.'} />
      </div>
    </SettingsSection>
    <SettingsSection title="Trust policy" presentation="compact">
      <div className="settings-fields">
        <UiTextarea label="Assume role policy (JSON)" value={policy} onChange={(event) => onPolicyChange(event.target.value)}
          className="font-mono" rows={10} spellCheck={false} error={policyError}
          hint="IAM trust policy document used by STS AssumeRole. Provide valid JSON." />
      </div>
    </SettingsSection>
  </>;
}
