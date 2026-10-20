/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ConfirmActionDialog from "../../../components/ConfirmActionDialog";
import { type ReactNode, useState } from "react";
import PageShell from "../../../components/PageShell";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import {
  SettingsActions,
  SettingsButton,
  useSettingsCloseGuard,
} from "../../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../../components/settings/SettingsNavigationGuard";
import { settingsLabels } from "../../../components/settings/settingsLabels";
import { adminPageBreadcrumbs } from "../adminBreadcrumbs";
import { useAdminSettingsI18n, type AdminSettingsMessageKey } from "./adminSettingsMessage";
import type { useAppSettingsDraft } from "./useAppSettingsDraft";

const isDemo = import.meta.env.MODE === "demo";
const breadcrumbMessageKeys: Partial<Record<Parameters<typeof adminPageBreadcrumbs>[0], AdminSettingsMessageKey>> = {
  "general-settings": "general",
  "cost-settings": "cost",
  "authentication-settings": "authentication",
  "manager-settings": "manager",
  "browser-settings": "browser",
  "portal-settings": "portal",
};

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
  const { locale, t, text } = useAdminSettingsI18n();
  const labels = settingsLabels(t);
  const closeLabel = locale === "en" ? undefined : labels.close;
  const guardLabels = {
    title: labels.discardTitle,
    description: labels.discardDescription,
    confirmLabel: labels.discard,
    cancelLabel: labels.keepEditing,
    closeLabel,
  };
  const pageBreadcrumbKey = breadcrumbMessageKeys[page];
  const breadcrumbs = adminPageBreadcrumbs(page).map((breadcrumb, index) => ({
    ...breadcrumb,
    label: index === 0 ? text("admin") : pageBreadcrumbKey ? text(pageBreadcrumbKey) : breadcrumb.label,
  }));
  const [reset, setReset] = useState(false);
  const cancelGuard = useSettingsCloseGuard({
    hasUnsavedChanges: form.dirty,
    disabled: form.busy,
    onClose: form.cancel,
    ...guardLabels,
  });
  return (
    <PageShell
      title={title}
      description={description}
      breadcrumbs={breadcrumbs}
      rightContent={
        <div>
          <SettingsButton
            variant="ghost"
            disabled={isDemo || !form.settings || form.busy}
            onClick={() => setReset(true)}
          >
            {text("resetToDefaults")}
          </SettingsButton>
        </div>
      }
    >
      <div className="settings-compact">
        {isDemo && <UiInlineMessage tone="info">{text("demoReadOnly")}</UiInlineMessage>}
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
            {text(form.error ? "settingsUnavailable" : "loadingSettings")}
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!isDemo) void form.save();
            }}
            noValidate
          >
            <fieldset disabled={isDemo || form.busy} className="min-w-0">
              {children}
            </fieldset>
          </form>
        )}
        {additionalContent}
        <SettingsActions
          disabled={isDemo}
          dirty={form.dirty}
          busy={form.busy}
          onSave={() => void form.save()}
          onCancel={cancelGuard.requestClose}
          saveLabel={text("saveChanges")}
          cancelLabel={labels.cancel}
          savingLabel={text("saving")}
        />
      </div>
      <SettingsNavigationGuard dirty={form.dirty || dialogDirty} {...guardLabels} />
      {cancelGuard.confirmationDialog}
      {form.verificationDialog}
      {dialogs}
      {reset && (
        <ConfirmActionDialog
          title={resetTitle}
          description={text("resetDescription")}
          confirmLabel={text("loadDefaults")}
          cancelLabel={labels.cancel}
          processingLabel={text("processing")}
          impactLabel={text("impact")}
          closeLabel={closeLabel}
          tone="primary"
          warning={text("defaultsDraftWarning")}
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
