/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { FormEvent, ReactNode } from "react";
import WorkflowPage from "../../components/WorkflowPage";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useStorageEndpointI18n } from "./storageEndpointMessages";

/** One mounted endpoint draft owns submission, dismissal and navigation. */
export default function StorageEndpointEditor({
  title, name, editing, readOnly, canEdit, ready, dirty, busy, submitLabel, busyLabel,
  onSubmit, onClose, children,
}: {
  title: string;
  name: string;
  editing: boolean;
  readOnly: boolean;
  canEdit: boolean;
  ready: boolean;
  dirty: boolean;
  busy: boolean;
  submitLabel?: string;
  busyLabel?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onClose: (reason?: "navigation") => void;
  children: ReactNode;
}) {
  const disabled = !ready || !canEdit || !dirty;
  const { text } = useStorageEndpointI18n();
  const controller = useSettingsFormController({ dirty, busy, disabled, onSubmit, onClose });
  const resolvedSubmitLabel = submitLabel ?? (editing ? (readOnly ? text("saveTags") : text("updateEndpoint")) : text("createEndpoint"));
  const resolvedBusyLabel = busyLabel ?? text("saving");
  return <>
    <WorkflowPage title={title}
      description={text("editorDescription")}
      breadcrumbs={adminPageBreadcrumbs("storage-endpoints", { label: editing ? name : text("create") })}
      backLabel={text("backToEndpoints")} onBack={controller.requestClose} backDisabled={controller.locked}
      contentVariant="plain" width="wide" contentClassName="settings-compact settings-form">
      <SettingsForm label={text("storageEndpointConfiguration")} busy={controller.locked} submitDisabled={disabled}
        onSubmit={controller.submit} onCancel={controller.requestClose} submitLabel={resolvedSubmitLabel} busyLabel={resolvedBusyLabel}
        actions={<>
          <SettingsButton variant="secondary" onClick={controller.requestClose} disabled={controller.locked}>
            {canEdit ? text("cancel") : text("done")}
          </SettingsButton>
          {canEdit && <SettingsButton type="submit" disabled={disabled || controller.locked}
            title={!ready ? text("managementModeUnavailableTitle") : !dirty ? text("noChangesToSave") : undefined}>
            {controller.locked ? resolvedBusyLabel : resolvedSubmitLabel}
          </SettingsButton>}
        </>}>
        <div className="settings-stack">{children}</div>
      </SettingsForm>
    </WorkflowPage>
    {controller.confirmationDialog}
    {controller.navigationGuard}
  </>;
}
