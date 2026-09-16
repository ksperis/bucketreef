/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { FormEventHandler, ReactNode, Ref } from "react";
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
  noValidate?: boolean;
  formRef?: Ref<HTMLFormElement>;
};

/** Native form submission with a frozen pending draft and the shared page footer. */
export default function SettingsForm({
  label, children, busy, disabled = false, submitDisabled = false, onSubmit, onCancel, submitLabel, busyLabel, actions, presentation = "page", noValidate = true, formRef,
}: SettingsFormProps) {
  const Actions = presentation === "dialog" ? ModalActions : SettingsActionBar;
  return (
    <form ref={formRef} aria-label={label} className={presentation === "dialog" ? "settings-stack settings-form" : undefined} noValidate={noValidate} onSubmit={(event) => {
      // A dialog rendered in a portal must never submit an enclosing workflow.
      event.stopPropagation();
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
