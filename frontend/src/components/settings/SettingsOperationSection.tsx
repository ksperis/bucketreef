/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useRef, useState, type ReactNode } from "react";
import { SettingsButton } from "./SettingsControls";
import { SettingsSection } from "./SettingsLayout";

/** One immediate operation, with its own native form and pending field lock. */
export default function SettingsOperationSection({
  title, description, busy = false, disabled = false, submitDisabled = false,
  submitLabel, busyLabel = "Saving...", onSubmit, children,
}: {
  title: string;
  description?: string;
  busy?: boolean;
  disabled?: boolean;
  submitDisabled?: boolean;
  submitLabel: string;
  busyLabel?: string;
  onSubmit: () => Promise<unknown> | void;
  children: ReactNode;
}) {
  const pending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const locked = busy || submitting;
  const submit = async () => {
    if (pending.current || busy || disabled || submitDisabled) return;
    pending.current = true;
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };
  return (
    <SettingsSection title={title} description={description} presentation="compact">
      <form aria-label={title} noValidate onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}>
        <fieldset aria-label={`${title} settings`} aria-busy={locked}
          disabled={locked || disabled} className="settings-fields min-w-0">
          {children}
          <div className="flex flex-wrap justify-end gap-2">
            <SettingsButton type="submit" disabled={submitDisabled}>
              {locked ? busyLabel : submitLabel}
            </SettingsButton>
          </div>
        </fieldset>
      </form>
    </SettingsSection>
  );
}
