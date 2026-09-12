/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps, FormEvent, ReactNode } from "react";
import WorkflowPage from "../WorkflowPage";
import UiInlineMessage from "../ui/UiInlineMessage";
import { SettingsButton } from "./SettingsControls";
import SettingsForm from "./SettingsForm";
import { useSettingsFormController } from "./useSettingsFormController";

/** Native page form sharing the dialog's draft and pending-operation contract. */
export default function SettingsWorkflowForm({
  title, description, breadcrumbs, backLabel, dirty, busy = false, loading = false,
  disabled = false, error, submitLabel, onSubmit, onClose, children,
}: Pick<ComponentProps<typeof WorkflowPage>, "title" | "description" | "breadcrumbs" | "backLabel"> & {
  dirty: boolean;
  busy?: boolean;
  loading?: boolean;
  disabled?: boolean;
  error?: string | null;
  submitLabel: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: (reason?: "navigation") => void;
  children: ReactNode;
}) {
  const { labels, locked, requestClose, submit, confirmationDialog, navigationGuard } = useSettingsFormController({
    dirty, busy, disabled: disabled || loading, onSubmit, onClose,
  });
  return <>
    <WorkflowPage title={title} description={description} breadcrumbs={breadcrumbs}
      backLabel={backLabel} onBack={requestClose} backDisabled={locked} width="standard"
      contentClassName="settings-compact settings-form">
      <SettingsForm label={title} onSubmit={submit} busy={locked || loading}
        submitDisabled={disabled} onCancel={requestClose} submitLabel={submitLabel} busyLabel={submitLabel}
        actions={<>
          <SettingsButton variant="secondary" onClick={requestClose} disabled={locked}>{labels.cancel}</SettingsButton>
          <SettingsButton type="submit" disabled={locked || loading || disabled} loading={locked}>{submitLabel}</SettingsButton>
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
