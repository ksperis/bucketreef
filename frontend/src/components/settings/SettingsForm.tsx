/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { FormEventHandler, ReactNode } from "react";
import { SettingsActionBar, SettingsButton } from "./SettingsControls";

type SettingsFormProps = {
  label: string;
  children: ReactNode;
  busy: boolean;
  disabled?: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onCancel: () => void;
  submitLabel: string;
  busyLabel: string;
  actions?: ReactNode;
};

/** Native form submission with a frozen pending draft and the shared page footer. */
export default function SettingsForm({
  label, children, busy, disabled = false, onSubmit, onCancel, submitLabel, busyLabel, actions,
}: SettingsFormProps) {
  return (
    <form aria-label={label} noValidate onSubmit={(event) => {
      event.preventDefault();
      if (!busy && !disabled) onSubmit(event);
    }}>
      <fieldset disabled={busy || disabled} className="min-w-0">{children}</fieldset>
      <SettingsActionBar>
        {actions ?? <>
          <SettingsButton variant="secondary" disabled={busy} onClick={onCancel}>Cancel</SettingsButton>
          <SettingsButton type="submit" disabled={busy || disabled}>{busy ? busyLabel : submitLabel}</SettingsButton>
        </>}
      </SettingsActionBar>
    </form>
  );
}
