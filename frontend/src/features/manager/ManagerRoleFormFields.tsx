/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { SettingsSection } from "../../components/settings/SettingsLayout";
import SettingsJsonEditor from "../../components/settings/SettingsJsonEditor";
import UiInput from "../../components/ui/UiInput";
import { useManagerI18n } from "./managerI18n";

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
  const { text } = useManagerI18n();
  return <>
    <SettingsSection title={text("Identity")} presentation="compact">
      <div className="settings-fields md:grid-cols-2">
        <UiInput label={text("Role name")} value={name} required={!editing} readOnly={editing}
          onChange={(event) => onNameChange?.(event.target.value)} placeholder={text("Role name")} error={nameError} />
        <UiInput label={editing ? text("Role path") : text("Role path (optional)")} value={path} readOnly={editing}
          onChange={(event) => onPathChange?.(event.target.value)} placeholder={text("/application/")}
          hint={editing ? text("Path is fixed at creation. Create a new role to use a different path.") : text("Defaults to \"/\". Sets the IAM path prefix for the role.")} />
      </div>
    </SettingsSection>
    <SettingsSection title={text("Trust policy")} presentation="compact">
      <div className="settings-fields">
        <SettingsJsonEditor label={text("Assume role policy (JSON)")} value={policy} onChange={onPolicyChange}
          rows={10} error={policyError}
          hint={text("IAM trust policy document used by STS AssumeRole. Provide valid JSON.")} />
      </div>
    </SettingsSection>
  </>;
}
