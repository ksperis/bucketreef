/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  PortalStorageSpaceAccountMemberRole,
  PortalStorageSpaceGrantRole,
} from "../../api/portal";
import type {
  PortalStorageSpaceAccessSummary,
  PortalStorageSpaceShare,
} from "../../api/portalSharing";
import PageBanner from "../../components/PageBanner";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import {
  PortalAccessModeFields,
  PortalRoleBadge,
  portalAccessModeDescription,
  portalAccessModeSummary,
  type PortalAccessMode,
} from "./PortalAccessControls";
import { portalRoleLabel, portalShareScopeLabel, portalStatusLabel } from "./portalI18n";

type PortalStorageSpaceCollaboratorsPanelProps = {
  summary: PortalStorageSpaceAccessSummary | null;
  loading: boolean;
  error: string | null;
  savedAccessMode: PortalAccessMode;
  isArchived: boolean;
  accessMode: PortalAccessMode;
  accountMemberRole: PortalStorageSpaceAccountMemberRole;
  accessBusy: boolean;
  accessChanged: boolean;
  onAccessModeChange: (mode: PortalAccessMode) => void;
  onAccountMemberRoleChange: (role: PortalStorageSpaceAccountMemberRole) => void;
  onSaveAccess: () => void;
  onRoleChange: (share: PortalStorageSpaceShare, role: PortalStorageSpaceGrantRole) => void;
  onRevoke: (share: PortalStorageSpaceShare) => void;
  onAddPeople: () => void;
  onOpenExternalLinks: () => void;
};

export default function PortalStorageSpaceCollaboratorsPanel({
  summary,
  loading,
  error,
  savedAccessMode,
  isArchived,
  accessMode,
  accountMemberRole,
  accessBusy,
  accessChanged,
  onAccessModeChange,
  onAccountMemberRoleChange,
  onSaveAccess,
  onRoleChange,
  onRevoke,
  onAddPeople,
  onOpenExternalLinks,
}: PortalStorageSpaceCollaboratorsPanelProps) {
  const { t } = useI18n();

  return (
    <UiCard>
      {loading ? (
        <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
          {t({ en: "Loading access...", fr: "Chargement des accès...", de: "Zugriff wird geladen...", zh: "正在加载访问权限…" })}
        </div>
      ) : error ? (
        <PageBanner tone="warning">{error}</PageBanner>
      ) : summary ? (
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <UiBadge tone={savedAccessMode === "private" ? "neutral" : "info"}>
                  {savedAccessMode === "account"
                    ? portalShareScopeLabel("shared", "account", t)
                    : savedAccessMode === "restricted"
                      ? portalShareScopeLabel("shared", "restricted", t)
                      : portalShareScopeLabel("private", "restricted", t)}
                </UiBadge>
                {isArchived ? <UiBadge tone="warning">{portalStatusLabel("Archived", t)}</UiBadge> : null}
              </div>
              <p className={cx("mt-2 text-xs font-medium", uiMutedTextClass)}>
                {isArchived
                  ? t({ en: "Archived spaces have no active collaborator access.", fr: "Les espaces archivés n'ont aucun accès collaborateur actif.", de: "Archivierte Bereiche haben keinen aktiven Mitwirkendenzugriff.", zh: "已归档空间没有有效的协作者访问权限。" })
                  : portalAccessModeDescription(savedAccessMode, t)}
              </p>
              <p className={cx("mt-1 text-[11px] font-semibold", uiMutedTextClass)}>
                {portalAccessModeSummary(savedAccessMode, summary.explicit_shares.length, summary.effective_member_count, t)}
              </p>
            </div>
            <div>
              <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                {summary.owner
                  ? t({ en: "Owner", fr: "Propriétaire", de: "Eigentümer", zh: "所有者" })
                  : t({ en: "Managed by", fr: "Géré par", de: "Verwaltet von", zh: "管理者" })}
              </div>
              <div className={cx("mt-1 font-bold", uiTitleTextClass)}>
                {summary.owner
                  ? summary.owner.display_name || summary.owner.email
                  : t({ en: "Project managers", fr: "Gestionnaires du projet", de: "Projektmanager", zh: "项目管理员" })}
              </div>
              {summary.owner ? (
                <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>{summary.owner.email}</div>
              ) : null}
            </div>
            <div>
              <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                {t({ en: "Public links", fr: "Liens publics", de: "Öffentliche Links", zh: "公开链接" })}
              </div>
              <button
                type="button"
                onClick={onOpenExternalLinks}
                className="mt-1 inline-flex text-sm font-bold text-primary hover:underline dark:text-primary-200"
              >
                {t({
                  en: `${summary.public_link_count} public link${summary.public_link_count > 1 ? "s" : ""}`,
                  fr: `${summary.public_link_count} lien${summary.public_link_count > 1 ? "s" : ""} public${summary.public_link_count > 1 ? "s" : ""}`,
                  de: `${summary.public_link_count} öffentliche Links`,
                  zh: `${summary.public_link_count} 个公开链接`,
                })}
              </button>
            </div>
          </div>

          {summary.can_manage_access ? (
            <div className="space-y-3 border-t border-[color:var(--ui-border-soft)] pt-4">
              <PageBanner tone="info">
                {t({
                  en: "Project membership makes a person eligible to be invited. File access is controlled here for this space.",
                  fr: "Être membre du projet permet d'être invité. L'accès réel aux fichiers se règle ici, pour cet espace.",
                  de: "Die Projektmitgliedschaft ermöglicht eine Einladung. Der tatsächliche Dateizugriff wird hier für diesen Bereich festgelegt.",
                  zh: "项目成员资格仅使人员具备被邀请的资格。此空间的文件访问权限在这里控制。",
                })}
              </PageBanner>
              <PortalAccessModeFields
                mode={accessMode}
                onModeChange={onAccessModeChange}
                accountMemberRole={accountMemberRole}
                onAccountMemberRoleChange={onAccountMemberRoleChange}
                disabled={accessBusy || isArchived}
                allowedModes={["account", "restricted"]}
                modeLabel={t({ en: "Who can access this space?", fr: "Qui peut accéder à cet espace ?", de: "Wer kann auf diesen Bereich zugreifen?", zh: "谁可以访问此空间？" })}
                roleLabel={t({ en: "Default role for team members", fr: "Rôle par défaut des membres", de: "Standardrolle für Teammitglieder", zh: "团队成员默认角色" })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <UiButton
                  size="sm"
                  disabled={!accessChanged || accessBusy || isArchived}
                  onClick={onSaveAccess}
                >
                  {t({ en: "Save access", fr: "Enregistrer l'accès", de: "Zugriff speichern", zh: "保存访问权限" })}
                </UiButton>
                {accessChanged ? (
                  <span className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                    {t({ en: "Confirm before changing who has access.", fr: "Une confirmation sera demandée avant de modifier les personnes couvertes.", de: "Vor der Änderung der berechtigten Personen ist eine Bestätigung erforderlich.", zh: "更改访问人员前请确认。" })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-2 border-t border-[color:var(--ui-border-soft)] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={cx("text-sm font-bold", uiTitleTextClass)}>
                {t({ en: "Direct collaborators", fr: "Collaborateurs directs", de: "Direkte Mitwirkende", zh: "直接协作者" })}
              </h3>
              <span className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                {t({
                  en: "Roles below apply only to this space.",
                  fr: "Les rôles ci-dessous s'appliquent uniquement à cet espace.",
                  de: "Die folgenden Rollen gelten nur für diesen Bereich.",
                  zh: "以下角色仅适用于此空间。",
                })}
              </span>
            </div>
            {summary.explicit_shares.length > 0 ? (
              <div className="space-y-2">
                {summary.explicit_shares.map((share) => (
                  <div key={share.id} className="grid gap-2 rounded-md border border-[color:var(--ui-border)] px-3 py-2 md:grid-cols-[minmax(0,1fr)_150px_auto] md:items-center">
                    <div className="min-w-0">
                      <div className={cx("truncate text-xs font-bold", uiTitleTextClass)}>{share.email}</div>
                      {savedAccessMode === "private" ? (
                        <div className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                          {t({ en: "Inactive while private", fr: "Inactif tant que l'accès est privé", de: "Inaktiv bei privatem Zugriff", zh: "私有状态下不生效" })}
                        </div>
                      ) : null}
                    </div>
                    {summary.can_manage_access && share.user_id != null && savedAccessMode !== "private" ? (
                      <UiSelect
                        size="compact"
                        className="h-8"
                        value={share.role}
                        disabled={accessBusy || accessChanged || isArchived}
                        onChange={(event) => onRoleChange(share, event.target.value as PortalStorageSpaceGrantRole)}
                        aria-label={t({ en: `Access for ${share.email}`, fr: `Accès pour ${share.email}`, de: `Zugriff für ${share.email}`, zh: `${share.email} 的访问权限` })}
                      >
                        <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
                        <option value="Editor">{portalRoleLabel("Editor", t)}</option>
                      </UiSelect>
                    ) : (
                      <PortalRoleBadge role={share.role} />
                    )}
                    {summary.can_manage_access && share.user_id != null && savedAccessMode !== "private" ? (
                      <UiButton
                        size="xs"
                        variant="danger"
                        disabled={accessBusy || accessChanged || isArchived}
                        onClick={() => onRevoke(share)}
                      >
                        {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen", zh: "撤销" })}
                      </UiButton>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
                {t({ en: "No direct collaborators yet.", fr: "Aucun collaborateur direct pour l'instant.", de: "Noch keine direkten Mitwirkenden.", zh: "暂无直接协作者。" })}
              </div>
            )}
          </div>

          {summary.can_manage_access && savedAccessMode === "restricted" ? (
            <div className="space-y-3 border-t border-[color:var(--ui-border-soft)] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className={cx("text-sm font-bold", uiTitleTextClass)}>
                    {t({ en: "Add people", fr: "Ajouter des personnes", de: "Personen hinzufügen", zh: "添加人员" })}
                  </h3>
                  <p className={cx("mt-1 text-xs font-semibold", uiMutedTextClass)}>
                    {t({
                      en: "Invite collaborators when this space is ready to share.",
                      fr: "Invitez des collaborateurs lorsque cet espace est prêt à être partagé.",
                      de: "Laden Sie Mitwirkende ein, wenn dieser Bereich bereit zum Teilen ist.",
                      zh: "在此空间准备好共享后邀请协作者。",
                    })}
                  </p>
                </div>
                <UiButton
                  size="sm"
                  disabled={accessBusy || accessChanged || isArchived}
                  onClick={onAddPeople}
                >
                  {t({ en: "Add people", fr: "Ajouter", de: "Hinzufügen", zh: "添加人员" })}
                </UiButton>
              </div>
              {accessChanged ? (
                <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
                  {t({ en: "Save the access mode before editing direct collaborators.", fr: "Enregistrez le mode d'accès avant de modifier les collaborateurs directs.", de: "Speichern Sie den Zugriffsmodus, bevor Sie direkte Mitwirkende bearbeiten.", zh: "请先保存访问模式，再编辑直接协作者。" })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </UiCard>
  );
}
