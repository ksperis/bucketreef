/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps, ReactNode } from "react";
import WorkflowPage, { WorkflowMetadata } from "../../components/WorkflowPage";
import { SettingsActionBar } from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { useI18n } from "../../i18n";

/** Shared presentation for Portal operations; each caller owns its storage contract. */
export default function PortalOperationLayout({ running, onClose, metadata, actions, children, ...page }: Pick<ComponentProps<typeof WorkflowPage>, "title" | "description" | "breadcrumbs" | "backLabel"> & {
  running: boolean; onClose: () => void; children: ReactNode; actions: ReactNode;
  metadata: ComponentProps<typeof WorkflowMetadata>["items"];
}) {
  const { t } = useI18n();
  const close = () => { if (!running) onClose(); };
  return <>
    <WorkflowPage {...page} onBack={close} backDisabled={running} width="standard" contentVariant="plain"
      contentClassName="settings-compact settings-form" metaContent={<WorkflowMetadata items={metadata} />}>
      <div className="settings-stack">{children}</div>
      <SettingsActionBar>{actions}</SettingsActionBar>
    </WorkflowPage>
    <SettingsNavigationGuard dirty={running} discardDisabled={running}
      title={t({ en: "Operation in progress", fr: "Opération en cours", de: "Vorgang läuft", zh: "操作正在进行" })}
      description={t({ en: "Wait for the operation to finish, or stop it before leaving this page.", fr: "Attendez la fin de l'opération ou arrêtez-la avant de quitter cette page.", de: "Warten Sie auf das Ende des Vorgangs oder stoppen Sie ihn, bevor Sie diese Seite verlassen.", zh: "请等待操作完成，或先停止操作再离开此页面。" })}
      confirmLabel={t({ en: "Leave page", fr: "Quitter la page", de: "Seite verlassen", zh: "离开页面" })}
      cancelLabel={t({ en: "Stay here", fr: "Rester ici", de: "Hier bleiben", zh: "留在此页" })}
      closeLabel={t({ en: "Close", fr: "Fermer", de: "Schließen", zh: "关闭" })} />
  </>;
}

export function PortalOperationProgress({ label, message, count, value, detail, running }: {
  label: string; message: string; count: ReactNode; value: number | null; detail: ReactNode; running: boolean;
}) {
  return <section aria-label={label} className="settings-fields">
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="settings-label break-words">{message}</p>
      <p className="settings-description">{count}</p>
    </div>
    {(running || value !== null) && <UiProgressBar value={value} label={label} className="bg-[var(--ui-surface-muted)]" />}
    <p className="settings-description">{detail}</p>
  </section>;
}
