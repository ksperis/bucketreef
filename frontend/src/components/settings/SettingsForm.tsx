/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { FormEventHandler, ReactNode } from "react";
import { SettingsActionBar, SettingsButton } from "./SettingsControls";
import ModalActions from "../ModalActions";

type SettingsFormProps = {
  label: string;
  children: ReactNode;
  busy: boolean;
  disabled?: boolean;
  submitDisabled?: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onCancel: () => void;
  submitLabel: string;
  busyLabel: string;
  actions?: ReactNode;
  presentation?: "page" | "dialog";
};

/** Native form submission with a frozen pending draft and the shared page footer. */
export default function SettingsForm({
  label, children, busy, disabled = false, submitDisabled = false, onSubmit, onCancel, submitLabel, busyLabel, actions, presentation = "page",
}: SettingsFormProps) {
  const Actions = presentation === "dialog" ? ModalActions : SettingsActionBar;
  return (
    <form aria-label={label} className={presentation === "dialog" ? "settings-stack settings-form" : undefined} noValidate onSubmit={(event) => {
      event.preventDefault();
      if (!busy && !disabled && !submitDisabled) onSubmit(event);
    }}>
      <fieldset disabled={busy || disabled} className={presentation === "dialog" ? "settings-fields" : "min-w-0"}>{children}</fieldset>
      <Actions>
        {actions ?? <>
          <SettingsButton variant="secondary" disabled={busy} onClick={onCancel}>Cancel</SettingsButton>
          <SettingsButton type="submit" disabled={busy || disabled || submitDisabled}>{busy ? busyLabel : submitLabel}</SettingsButton>
        </>}
      </Actions>
    </form>
  );
}
