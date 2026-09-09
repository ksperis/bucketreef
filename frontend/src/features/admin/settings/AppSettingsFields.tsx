/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { type ReactNode, useId } from "react";
import {
  SettingsItem,
  SettingsToggleAction,
} from "../../../components/settings/SettingsLayout";
import { SettingsField } from "../../../components/settings/SettingsControls";
import type { useAppSettingsDraft } from "./useAppSettingsDraft";
import type { SettingsPath } from "./appSettingsDraft";

type Props = {
  form: ReturnType<typeof useAppSettingsDraft>;
  field: SettingsPath;
  title: string;
  description?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
};

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
            experimental ? { visible: true, label: "Experimental" } : undefined
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
