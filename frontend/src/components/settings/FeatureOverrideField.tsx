/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import type { FeaturePolicy } from "../../api/appSettings";
import UiBadge from "../ui/UiBadge";
import {
  SettingsItem,
  SettingsTriStateSwitch,
  type SettingsTriStateOption,
} from "./SettingsLayout";
import { SettingsSelect } from "./SettingsControls";

type FeatureOverrideValue = "disabled" | "inherit" | "enabled";

export default function FeatureOverrideField({ title, value, policy, onChange, help, disabled, unavailable, triState = false }: {
  title: string;
  value: boolean | null;
  policy: FeaturePolicy;
  onChange: (value: boolean | null) => void;
  help?: ReactNode;
  disabled?: boolean;
  unavailable?: string;
  triState?: boolean;
}) {
  const platformEnabled = policy === "default_on";
  const blocked = policy === "disabled";
  const selection: FeatureOverrideValue = value == null ? "inherit" : value ? "enabled" : "disabled";
  const inheritedState = platformEnabled ? "Enabled" : "Disabled";
  const triStateOptions = [
    { value: "disabled", label: "Disabled", symbol: "×" },
    {
      value: "inherit",
      label: `Inherited platform value — ${inheritedState}`,
      symbol: platformEnabled ? "✓" : "×",
      className: "settings-tristate-option-inherit-ghost",
      selectedClassName: "settings-tristate-option-inherit-ghost-selected",
    },
    {
      value: "enabled",
      label: "Enabled",
      symbol: "✓",
      disabled: blocked || Boolean(unavailable),
    },
  ] satisfies readonly [
    SettingsTriStateOption<FeatureOverrideValue>,
    SettingsTriStateOption<FeatureOverrideValue>,
    SettingsTriStateOption<FeatureOverrideValue>,
  ];
  const setSelection = (next: FeatureOverrideValue) => onChange(next === "inherit" ? null : next === "enabled");
  return <SettingsItem compact title={title} help={help}
    status={blocked || unavailable ? <UiBadge tone="warning">{blocked ? "Platform disabled" : unavailable}</UiBadge> : undefined}
    action={triState
      ? <SettingsTriStateSwitch ariaLabel={title} value={selection} options={triStateOptions}
          disabled={disabled} onChange={setSelection} />
      : <SettingsSelect aria-label={title} className="settings-policy-select" disabled={disabled}
          value={selection}
          onChange={event => setSelection(event.target.value as FeatureOverrideValue)}>
          <option value="inherit">Platform value — {inheritedState}</option>
          <option value="enabled" disabled={blocked || Boolean(unavailable)}>Enabled</option>
          <option value="disabled">Disabled</option>
        </SettingsSelect>} />;
}
