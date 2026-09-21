/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { FormEvent, ReactNode } from "react";
import WorkflowPage from "../../components/WorkflowPage";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";

/** One mounted endpoint draft owns submission, dismissal and navigation. */
export default function StorageEndpointEditor({
  title, name, editing, readOnly, canEdit, ready, dirty, busy, onSubmit, onClose, children,
}: {
  title: string;
  name: string;
  editing: boolean;
  readOnly: boolean;
  canEdit: boolean;
  ready: boolean;
  dirty: boolean;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onClose: (reason?: "navigation") => void;
  children: ReactNode;
}) {
  const disabled = !ready || !canEdit || !dirty;
  const controller = useSettingsFormController({ dirty, busy, disabled, onSubmit, onClose });
  const submitLabel = editing ? (readOnly ? "Save tags" : "Update endpoint") : "Create endpoint";
  return <>
    <WorkflowPage title={title}
      description="Manage connection settings, operational credentials, capabilities, and health checks for this endpoint."
      breadcrumbs={adminPageBreadcrumbs("storage-endpoints", { label: editing ? name : "Create" })}
      backLabel="Back to endpoints" onBack={controller.requestClose} backDisabled={controller.locked}
      contentVariant="plain" width="wide" contentClassName="settings-compact settings-form">
      <SettingsForm label="Storage endpoint configuration" busy={controller.locked} submitDisabled={disabled}
        onSubmit={controller.submit} onCancel={controller.requestClose} submitLabel={submitLabel} busyLabel="Saving..."
        actions={<>
          <SettingsButton variant="secondary" onClick={controller.requestClose} disabled={controller.locked}>
            {canEdit ? "Cancel" : "Done"}
          </SettingsButton>
          {canEdit && <SettingsButton type="submit" disabled={disabled || controller.locked}
            title={!ready ? "Management mode is unavailable." : !dirty ? "No changes to save." : undefined}>
            {controller.locked ? "Saving..." : submitLabel}
          </SettingsButton>}
        </>}>
        <div className="settings-stack">{children}</div>
      </SettingsForm>
    </WorkflowPage>
    {controller.confirmationDialog}
    {controller.navigationGuard}
  </>;
}
