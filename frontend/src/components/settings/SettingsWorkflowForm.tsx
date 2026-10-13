/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps, FormEvent, ReactNode } from "react";
import WorkflowPage from "../WorkflowPage";
import UiInlineMessage from "../ui/UiInlineMessage";
import { SettingsButton, SettingsPersistentEditActions } from "./SettingsControls";
import SettingsForm from "./SettingsForm";
import { useSettingsFormController } from "./useSettingsFormController";

/** Native page form sharing the dialog's draft and pending-operation contract. */
export default function SettingsWorkflowForm({
  title, description, breadcrumbs, backLabel, contentVariant, width = "standard", formLabel = title,
  dirty, busy = false, loading = false, disabled = false, readOnly = false, completed = false, error, submitLabel,
  busyLabel = submitLabel, persistentEdit = false, onSubmit, onClose, children,
}: Pick<ComponentProps<typeof WorkflowPage>, "title" | "description" | "breadcrumbs" | "backLabel" | "contentVariant" | "width"> & {
  formLabel?: string;
  dirty: boolean;
  busy?: boolean;
  loading?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  completed?: boolean;
  persistentEdit?: boolean;
  error?: string | null;
  submitLabel: string;
  busyLabel?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: (reason?: "navigation") => void;
  children: ReactNode;
}) {
  const { labels, locked, requestClose, submit, confirmationDialog, navigationGuard } = useSettingsFormController({
    dirty: dirty && !readOnly, busy, disabled: disabled || loading || readOnly, completed, onSubmit, onClose,
  });
  return <>
    <WorkflowPage title={title} description={description} breadcrumbs={breadcrumbs}
      backLabel={backLabel} onBack={requestClose} backDisabled={locked} width={width}
      contentVariant={contentVariant} contentClassName="settings-compact settings-form">
      <SettingsForm label={formLabel} onSubmit={submit} busy={locked || loading}
        submitDisabled={disabled || readOnly} onCancel={requestClose} submitLabel={submitLabel} busyLabel={submitLabel}
        actions={readOnly ? (
          <SettingsButton variant="secondary" onClick={requestClose} disabled={locked}>{labels.close}</SettingsButton>
        ) : persistentEdit ? (
          <SettingsPersistentEditActions dirty={dirty} busy={locked} disabled={loading || disabled}
            onCancel={requestClose} saveLabel={submitLabel} savingLabel={busyLabel}
            cancelLabel={labels.cancel} doneLabel={labels.done} />
        ) : <>
          <SettingsButton variant="secondary" onClick={requestClose} disabled={locked}>{labels.cancel}</SettingsButton>
          <SettingsButton type="submit" disabled={locked || loading || disabled} loading={locked}>{locked ? busyLabel : submitLabel}</SettingsButton>
        </>}>
        <div className="settings-stack">
          {error && <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>}
          {children}
        </div>
      </SettingsForm>
    </WorkflowPage>
    {confirmationDialog}
    {navigationGuard}
  </>;
}
