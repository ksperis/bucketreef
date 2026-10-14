/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { SettingsSection } from "../../components/settings/SettingsLayout";
import SettingsJsonEditor from "../../components/settings/SettingsJsonEditor";
import UiInput from "../../components/ui/UiInput";
import { useManagerI18n } from "./managerI18n";

type Props = {
  name: string;
  path: string;
  arn?: string;
  policy: string;
  maxSessionDuration: number;
  editing?: boolean;
  sections?: "all" | "general" | "trust";
  onNameChange?: (value: string) => void;
  onPathChange?: (value: string) => void;
  onPolicyChange: (value: string) => void;
  onMaxSessionDurationChange: (value: number) => void;
  nameError?: string;
  pathError?: string;
  policyError?: string;
  maxSessionDurationError?: string;
};

export default function ManagerRoleFormFields({
  name, path, arn, policy, maxSessionDuration, editing = false, sections = "all", onNameChange, onPathChange, onPolicyChange,
  onMaxSessionDurationChange, nameError, pathError, policyError, maxSessionDurationError,
}: Props) {
  const { text } = useManagerI18n();
  return <>
    {sections !== "trust" && <SettingsSection title={text("Identity")} presentation="compact">
      <div className="settings-fields md:grid-cols-2">
        <UiInput label={text("Role name")} value={name} required={!editing} readOnly={editing}
          onChange={(event) => onNameChange?.(event.target.value)} placeholder={text("Role name")} error={nameError} />
        <UiInput label={editing ? text("Role path") : text("Role path (optional)")} value={path} readOnly={editing}
          onChange={(event) => onPathChange?.(event.target.value)} placeholder={text("/application/")}
          error={pathError}
          hint={editing ? text("Path is fixed at creation. Create a new role to use a different path.") : text("Defaults to \"/\". Sets the IAM path prefix for the role.")} />
        {editing && arn !== undefined && <UiInput label="ARN" value={arn} readOnly />}
        <UiInput label={text("Maximum session duration (seconds)")} type="number" min={3600} max={43200} step={1}
          value={String(maxSessionDuration)} onChange={(event) => onMaxSessionDurationChange(Number(event.target.value))}
          error={maxSessionDurationError} hint={text("Allowed range: 3600 to 43200 seconds.")} />
      </div>
    </SettingsSection>}
    {sections !== "general" && <SettingsSection title={text("Trust policy")} presentation="compact">
      <div className="settings-fields">
        <SettingsJsonEditor label={text("Assume role policy (JSON)")} value={policy} onChange={onPolicyChange}
          rows={10} error={policyError}
          text={text}
          hint={text("IAM trust policy document used by STS AssumeRole. Provide valid JSON.")} />
      </div>
    </SettingsSection>}
  </>;
}
