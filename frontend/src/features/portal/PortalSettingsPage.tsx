/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { fetchPortalProjectSettings, updatePortalProjectSettings } from "../../api/portalAccounts";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import { useI18n } from "../../i18n";
import ProjectSettingsEditor, { type ProjectSettingsAdapter } from "../shared/ProjectSettingsEditor";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";

const portalSettingsAdapter: ProjectSettingsAdapter = {
  load: fetchPortalProjectSettings,
  save: updatePortalProjectSettings,
};

export default function PortalSettingsPage() {
  const { t, locale } = useI18n();
  const { selectedAccount, selectedAccountId, loading, error } =
    usePortalAccountContext();
  const title = t({ en: "Settings", fr: "Paramètres", de: "Einstellungen", zh: "设置" });
  return (
    <PageShell
      title={title}
      description={t({
        en: "Manage project capabilities and defaults.",
        fr: "Gérez les fonctions et valeurs par défaut du projet.",
        de: "Verwalten Sie Projektfunktionen und Standardwerte.",
        zh: "管理项目功能和默认设置。",
      })}
      breadcrumbs={portalBreadcrumbs({ label: title })}
      breadcrumbLabel={t({
        en: "Breadcrumb",
        fr: "Fil d’Ariane",
        de: "Brotkrumennavigation",
        zh: "面包屑导航",
      })}
    >
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {selectedAccountId ? (
        <ProjectSettingsEditor
          adapter={portalSettingsAdapter}
          t={t}
          locale={locale}
          key={selectedAccountId}
          accountId={selectedAccountId}
          projectName={selectedAccount?.name ?? selectedAccountId}
          storageName={
            selectedAccount?.storage_endpoint_name ??
            selectedAccount?.storage_endpoint_url
          }
        />
      ) : (
        <PageBanner tone="info">
          {loading
            ? t({
                en: "Loading projects...",
                fr: "Chargement des projets...",
                de: "Projekte werden geladen...",
                zh: "正在加载项目…",
              })
            : t({
                en: "Select a project to view its settings.",
                fr: "Sélectionnez un projet pour consulter ses paramètres.",
                de: "Wählen Sie ein Projekt, um seine Einstellungen anzuzeigen.",
                zh: "选择项目以查看设置。",
              })}
        </PageBanner>
      )}
    </PageShell>
  );
}
