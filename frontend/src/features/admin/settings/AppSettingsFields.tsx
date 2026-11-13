/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { type ReactNode, useId } from "react";
import {
  SettingsItem,
  SettingsTriStateAction,
  SettingsToggleAction,
  type SettingsTriStateOption,
} from "../../../components/settings/SettingsLayout";
import { SettingsField } from "../../../components/settings/SettingsControls";
import UiBadge from "../../../components/ui/UiBadge";
import UiInfoTooltip from "../../../components/ui/UiInfoTooltip";
import type { FeaturePolicy } from "../../../api/featurePolicies";
import type { useAppSettingsDraft } from "./useAppSettingsDraft";
import type { SettingsPath } from "./appSettingsDraft";
import { useAppSettingsI18n } from "./appSettingsMessage";

type Props = {
  form: ReturnType<typeof useAppSettingsDraft>;
  field: SettingsPath;
  title: string;
  description?: ReactNode;
  summary?: ReactNode;
  defaultOnWarning?: {
    label: string;
    description: ReactNode;
  };
  ariaLabel?: string;
  disabled?: boolean;
};

const featurePolicyOptions = [
  {
    value: "disabled",
    label: "Disabled",
    symbol: "×",
    selectedClassName: "settings-tristate-option-disabled-selected",
  },
  { value: "targeted", label: "Targeted activation", symbol: "◎" },
  { value: "default_on", label: "Enabled by default", symbol: "✓" },
] satisfies readonly [
  SettingsTriStateOption<FeaturePolicy>,
  SettingsTriStateOption<FeaturePolicy>,
  SettingsTriStateOption<FeaturePolicy>,
];

export const FEATURE_POLICY_SECTION_DESCRIPTION =
  "Choose whether features are blocked, explicitly granted, or enabled by default. Storage permissions still apply.";

export function AppSettingsToggle({
  form,
  field,
  title,
  description,
  ariaLabel,
  disabled,
  experimental,
}: Props & { experimental?: boolean }) {
  const errorId = useId();
  const { text } = useAppSettingsI18n();
  return (
    <SettingsItem
      compact
      title={title}
      description={
        <>
          {description}
          {form.errors[field] && (
            <span
              id={errorId}
              role="alert"
              className="block text-rose-700 dark:text-rose-300"
            >
              {form.errors[field]}
            </span>
          )}
        </>
      }
      action={
        <SettingsToggleAction
          ariaInvalid={Boolean(form.errors[field])}
          ariaDescribedBy={form.errors[field] ? errorId : undefined}
          checked={Boolean(form.draft[field])}
          disabled={disabled || form.busy}
          onChange={(value) => form.setValue(field, value)}
          ariaLabel={ariaLabel ?? title}
          badge={
            experimental ? { visible: true, label: text("experimental") } : undefined
          }
        />
      }
    />
  );
}

export function AppSettingsNumber({
  form,
  field,
  title,
  description,
  ariaLabel,
  disabled,
  min = 1,
  max,
}: Props & { min?: number; max?: number }) {
  return (
    <SettingsItem
      compact
      title={title}
      description={description}
      action={
        <SettingsField
          name={field}
          type="number"
          label={ariaLabel ?? title}
          value={String(form.draft[field] ?? "")}
          min={min}
          max={max}
          step={1}
          error={form.errors[field]}
          disabled={disabled || form.busy}
          onChange={(event) => form.setValue(field, event.target.value)}
          className="w-28"
        />
      }
    />
  );
}

export function AppSettingsPolicy({ form, field, title, description, summary, defaultOnWarning, ariaLabel, disabled, experimental }: Props & { experimental?: boolean }) {
  const errorId = useId();
  const { text } = useAppSettingsI18n();
  const policy = String(form.draft[field] ?? "disabled") as FeaturePolicy;
  const warningActive = defaultOnWarning && policy === "default_on";
  return <SettingsItem compact title={title} help={description}
    status={warningActive ? (
      <UiInfoTooltip
        label={defaultOnWarning.label}
        triggerClassName="!h-auto !p-0"
        tooltipClassName="settings-info-tooltip"
        trigger={<UiBadge tone="warning"><span aria-hidden="true">⚠</span>{" "}{defaultOnWarning.label}</UiBadge>}
      >
        {defaultOnWarning.description}
      </UiInfoTooltip>
    ) : undefined}
    description={summary || form.errors[field] ? <>
      {summary && <span>{summary}</span>}
      {form.errors[field] && <span id={errorId} role="alert" className="block text-rose-700 dark:text-rose-300">{form.errors[field]}</span>}
    </> : undefined}
    action={<SettingsTriStateAction
      ariaLabel={ariaLabel ?? title}
      ariaInvalid={Boolean(form.errors[field])}
      ariaDescribedBy={form.errors[field] ? errorId : undefined}
      value={policy}
      options={featurePolicyOptions}
      disabled={disabled || form.busy}
      onChange={value => form.setValue(field, value)}
      badge={experimental ? { visible: true, label: text("experimental") } : undefined}
    />} />;
}
