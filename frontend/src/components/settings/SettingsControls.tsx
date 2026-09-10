/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { type ComponentProps, type ReactNode, useId } from "react";
import Modal from "../Modal";
import ConfirmActionDialog from "../ConfirmActionDialog";
import UiButton from "../ui/UiButton";
import UiInput from "../ui/UiInput";
import { useUnsavedChangesGuard } from "../useUnsavedChangesGuard";
import "./compactSettings.css";

export function SettingsButton({
  className = "",
  size = "sm",
  ...props
}: ComponentProps<typeof UiButton>) {
  return (
    <UiButton
      {...props}
      size={size}
      className={`settings-control settings-button ${className}`}
    />
  );
}

export function SettingsDialog(props: ComponentProps<typeof Modal>) {
  return (
    <div className="settings-dialog">
      <Modal maxWidthClass="max-w-lg" {...props} />
    </div>
  );
}

export function SettingsConfirmation(
  props: ComponentProps<typeof ConfirmActionDialog>,
) {
  return (
    <div className="settings-dialog">
      <ConfirmActionDialog {...props} />
    </div>
  );
}

export function useSettingsCloseGuard(
  options: Parameters<typeof useUnsavedChangesGuard>[0],
) {
  const guard = useUnsavedChangesGuard({ zIndexClass: "z-[110]", ...options });
  return {
    ...guard,
    confirmationDialog: guard.confirmationDialog && (
      <div className="settings-dialog">{guard.confirmationDialog}</div>
    ),
  };
}

export function SettingsActions({
  dirty,
  busy,
  onSave,
  onCancel,
  saveLabel = "Save changes",
  cancelLabel = "Cancel",
  savingLabel = "Saving...",
  disabled,
  saveAriaLabel,
}: {
  dirty: boolean;
  busy?: boolean;
  disabled?: boolean;
  saveAriaLabel?: string;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  savingLabel?: string;
}) {
  if (!dirty) return null;
  return (
    <div className="settings-actions">
      <SettingsButton variant="secondary" disabled={busy} onClick={onCancel}>
        {cancelLabel}
      </SettingsButton>
      <SettingsButton
        disabled={busy || disabled}
        aria-label={saveAriaLabel}
        onClick={onSave}
      >
        {busy ? savingLabel : saveLabel}
      </SettingsButton>
    </div>
  );
}

export function SettingsField({
  label,
  error,
  help,
  unit,
  className = "",
  ...props
}: ComponentProps<typeof UiInput> & {
  label: string;
  error?: string;
  help?: ReactNode;
  unit?: string;
}) {
  const id = useId();
  const unitId = `${id}-unit`;
  const describedBy = [
    unit ? unitId : undefined,
    error || help ? id : undefined,
    props["aria-describedby"],
  ].filter(Boolean).join(" ") || undefined;
  return (
    <div className="min-w-0">
      <div className={unit ? "settings-field-with-unit" : undefined}>
        <UiInput
          {...props}
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`settings-control ${className}`}
        />
        {unit && <span id={unitId} className="settings-unit">{unit}</span>}
      </div>
      {(error || help) && (
        <p
          id={id}
          role={error ? "alert" : undefined}
          className={`mt-1 settings-field-help ${error ? "text-rose-700 dark:text-rose-300" : "text-[var(--ui-text-muted)]"}`}
        >
          {error || help}
        </p>
      )}
    </div>
  );
}
