/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import type { FeaturePolicy } from "../../api/appSettings";
import {
  SettingsEffectiveAction,
  SettingsItem,
  SettingsTriStateAction,
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
  const unavailableReason = unavailable || undefined;
  const selection: FeatureOverrideValue = value == null ? "inherit" : value ? "enabled" : "disabled";
  const inheritedState = platformEnabled ? "Enabled" : "Disabled";
  const triStateOptions = [
    {
      value: "disabled",
      label: "Disabled",
      symbol: "×",
      selectedClassName: "settings-tristate-option-disabled-selected",
    },
    {
      value: "inherit",
      label: `Inherited platform value — ${inheritedState}`,
      symbol: platformEnabled ? "✓" : "×",
      className: "settings-tristate-option-inherit-ghost",
      selectedClassName: platformEnabled
        ? "settings-tristate-option-inherit-ghost-selected"
        : "settings-tristate-option-inherit-disabled-selected",
    },
    {
      value: "enabled",
      label: "Enabled",
      symbol: "✓",
      disabled: blocked || Boolean(unavailable),
      selectedClassName: !blocked && unavailableReason
        ? "settings-tristate-option-unavailable-selected"
        : undefined,
    },
  ] satisfies readonly [
    SettingsTriStateOption<FeatureOverrideValue>,
    SettingsTriStateOption<FeatureOverrideValue>,
    SettingsTriStateOption<FeatureOverrideValue>,
  ];
  const setSelection = (next: FeatureOverrideValue) => onChange(next === "inherit" ? null : next === "enabled");
  const effectiveUnavailable = blocked || Boolean(unavailableReason);
  const effectiveEnabled = !effectiveUnavailable && (value ?? platformEnabled);
  const effectiveState = effectiveUnavailable ? "unavailable" : effectiveEnabled ? "enabled" : "disabled";
  const effectiveLabel = effectiveUnavailable ? "Unavailable" : effectiveEnabled ? "Enabled" : "Disabled";
  const sourceLabel = blocked
    ? "Platform"
    : unavailableReason
      ? unavailableReason
      : value == null
        ? "Platform"
        : "Explicit override";
  const savedLabel = blocked && value != null
    ? `Stored override: ${value ? "Enabled" : "Disabled"}`
    : undefined;
  if (triState) {
    const constraintLabel = blocked ? "Platform disabled" : unavailableReason;
    return <SettingsItem compact title={title} help={help}
      action={<SettingsTriStateAction
        ariaLabel={title}
        value={selection}
        options={triStateOptions}
        disabled={disabled || blocked}
        onChange={setSelection}
        badge={constraintLabel ? { visible: true, label: constraintLabel, tone: "warning" } : undefined}
      />} />;
  }
  const control = <SettingsSelect aria-label={title} className="settings-policy-select" disabled={disabled}
    value={selection}
    onChange={event => setSelection(event.target.value as FeatureOverrideValue)}>
    <option value="inherit">Platform value — {inheritedState}</option>
    <option value="enabled" disabled={Boolean(unavailableReason)}>Enabled</option>
    <option value="disabled">Disabled</option>
  </SettingsSelect>;
  return <SettingsItem compact className="settings-effective-row" title={title} help={help}
    action={<SettingsEffectiveAction
      state={effectiveState}
      stateLabel={effectiveLabel}
      sourceLabel={sourceLabel}
      localLabel="Override"
      constraintLabel={blocked ? "Platform disabled" : undefined}
      savedLabel={blocked ? savedLabel : undefined}
    >
      {control}
    </SettingsEffectiveAction>} />;
}
