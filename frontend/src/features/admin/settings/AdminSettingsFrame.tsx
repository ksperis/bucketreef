/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { type ReactNode, useState } from "react";
import PageShell from "../../../components/PageShell";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import {
  SettingsActions,
  SettingsButton,
  SettingsConfirmation,
  useSettingsCloseGuard,
} from "../../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../../components/settings/SettingsNavigationGuard";
import { adminPageBreadcrumbs } from "../adminBreadcrumbs";
import type { useAppSettingsDraft } from "./useAppSettingsDraft";

export default function AdminSettingsFrame({
  title,
  description,
  page,
  resetTitle,
  form,
  children,
  dialogs,
  additionalContent,
  dialogDirty = false,
}: {
  title: string;
  description: string;
  page: Parameters<typeof adminPageBreadcrumbs>[0];
  resetTitle: string;
  form: ReturnType<typeof useAppSettingsDraft>;
  children: ReactNode;
  dialogs?: ReactNode;
  additionalContent?: ReactNode;
  dialogDirty?: boolean;
}) {
  const [reset, setReset] = useState(false);
  const cancelGuard = useSettingsCloseGuard({
    hasUnsavedChanges: form.dirty,
    disabled: form.busy,
    onClose: form.cancel,
    description: "Your changes have not been saved.",
  });
  return (
    <PageShell
      title={title}
      description={description}
      breadcrumbs={adminPageBreadcrumbs(page)}
      rightContent={
        <div>
          <SettingsButton
            variant="ghost"
            disabled={!form.settings || form.busy}
            onClick={() => setReset(true)}
          >
            Reset to defaults
          </SettingsButton>
        </div>
      }
    >
      <div className="settings-compact">
        {form.error && (
          <div className="mb-4" role="alert">
            <UiInlineMessage tone="error">{form.error}</UiInlineMessage>
          </div>
        )}
        {form.message && (
          <div className="mb-4" role="status">
            <UiInlineMessage tone="success">{form.message}</UiInlineMessage>
          </div>
        )}
        {!form.settings ? (
          <p role="status">
            {form.error ? "Settings are unavailable." : "Loading settings..."}
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.save();
            }}
            noValidate
          >
            <fieldset disabled={form.busy} className="min-w-0">
              {children}
            </fieldset>
          </form>
        )}
        {additionalContent}
        <SettingsActions
          dirty={form.dirty}
          busy={form.busy}
          onSave={() => void form.save()}
          onCancel={cancelGuard.requestClose}
        />
      </div>
      <SettingsNavigationGuard dirty={form.dirty || dialogDirty} />
      {cancelGuard.confirmationDialog}
      {form.verificationDialog}
      {dialogs}
      {reset && (
        <SettingsConfirmation
          title={resetTitle}
          description="Replace this page's draft with application defaults."
          confirmLabel="Load defaults"
          tone="primary"
          warning="Defaults are loaded into this form only. Review them, then use Save changes to apply them."
          onCancel={() => setReset(false)}
          onConfirm={async () => {
            await form.loadDefaults();
            setReset(false);
          }}
        />
      )}
    </PageShell>
  );
}
