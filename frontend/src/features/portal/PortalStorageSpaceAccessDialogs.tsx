/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  PortalStorageSpaceAccountMemberRole,
  PortalStorageSpaceGrantRole,
} from "../../api/portal";
import type { PortalStorageSpaceShare } from "../../api/portalSharing";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useI18n } from "../../i18n";
import type { PortalAccessMode } from "./PortalAccessControls";
import { portalRoleLabel, portalShareScopeLabel } from "./portalI18n";

export type PendingAccessChange = {
  mode: PortalAccessMode;
  accountMemberRole: PortalStorageSpaceAccountMemberRole;
};

export type PendingAccessRoleChange = {
  share: PortalStorageSpaceShare;
  role: PortalStorageSpaceGrantRole;
};

type PortalStorageSpaceAccessDialogsProps = {
  spaceName: string;
  loading: boolean;
  pendingAccessChange: PendingAccessChange | null;
  pendingAccessRevoke: PortalStorageSpaceShare | null;
  pendingAccessRoleChange: PendingAccessRoleChange | null;
  onAccessChangeCancel: () => void;
  onAccessChangeConfirm: (change: PendingAccessChange) => void | Promise<void>;
  onAccessRevokeCancel: () => void;
  onAccessRevokeConfirm: (share: PortalStorageSpaceShare) => void | Promise<void>;
  onAccessRoleChangeCancel: () => void;
  onAccessRoleChangeConfirm: (change: PendingAccessRoleChange) => void | Promise<void>;
};

export default function PortalStorageSpaceAccessDialogs({
  spaceName,
  loading,
  pendingAccessChange,
  pendingAccessRevoke,
  pendingAccessRoleChange,
  onAccessChangeCancel,
  onAccessChangeConfirm,
  onAccessRevokeCancel,
  onAccessRevokeConfirm,
  onAccessRoleChangeCancel,
  onAccessRoleChangeConfirm,
}: PortalStorageSpaceAccessDialogsProps) {
  const { t } = useI18n();

  return (
    <>
      {pendingAccessChange ? (
        <ConfirmActionDialog
          title={t({ en: "Change collaborators", fr: "Modifier les collaborateurs", de: "Mitwirkende ändern", zh: "更改协作者" })}
          description={t({ en: "Confirm who can access this space.", fr: "Confirmez qui peut accéder à cet espace.", de: "Bestätigen Sie, wer auf diesen Bereich zugreifen kann.", zh: "确认谁可以访问此空间。" })}
          confirmLabel={t({ en: "Update access", fr: "Mettre à jour l'accès", de: "Zugriff aktualisieren", zh: "更新访问权限" })}
          tone="primary"
          loading={loading}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: spaceName },
            {
              label: t({ en: "New access", fr: "Nouvel accès", de: "Neuer Zugriff", zh: "新的访问权限" }),
              value:
                pendingAccessChange.mode === "account"
                  ? portalShareScopeLabel("shared", "account", t)
                  : pendingAccessChange.mode === "restricted"
                    ? portalShareScopeLabel("shared", "restricted", t)
                    : portalShareScopeLabel("private", "restricted", t),
            },
          ]}
          impacts={
            pendingAccessChange.mode === "private"
              ? [
                  t({ en: "Only the owner keeps active access.", fr: "Seul le propriétaire conserve un accès actif.", de: "Nur der Eigentümer behält aktiven Zugriff.", zh: "只有所有者保留有效访问权限。" }),
                  t({ en: "Existing direct collaborator grants are kept but become inactive while the space is private.", fr: "Les droits directs existants sont conservés mais deviennent inactifs tant que l'espace est privé.", de: "Bestehende direkte Berechtigungen bleiben erhalten, sind bei privatem Zugriff aber inaktiv.", zh: "现有直接协作者授权会保留，但在空间为私有时不生效。" }),
                  t({ en: "Public links are suspended while the space is private.", fr: "Les liens publics sont suspendus tant que l'espace est privé.", de: "Öffentliche Links sind bei privatem Zugriff ausgesetzt.", zh: "空间为私有时，公开链接将暂停使用。" }),
                ]
              : pendingAccessChange.mode === "account"
                ? [
                    t({ en: "Current and future Portal members of this account receive access automatically.", fr: "Les membres Portal actuels et futurs de ce compte recevront automatiquement l'accès.", de: "Aktuelle und zukünftige Portal-Mitglieder dieses Kontos erhalten automatisch Zugriff.", zh: "此账户当前及未来的 Portal 成员将自动获得访问权限。" }),
                    t({ en: "Direct collaborator grants remain available for explicit role overrides.", fr: "Les droits directs restent disponibles pour les rôles explicites.", de: "Direkte Berechtigungen bleiben für explizite Rollen erhalten.", zh: "直接协作者授权仍可用于单独覆盖角色。" }),
                    t({ en: "Public links remain managed separately.", fr: "Les liens publics restent gérés séparément.", de: "Öffentliche Links werden weiterhin separat verwaltet.", zh: "公开链接仍独立管理。" }),
                  ]
                : [
                    t({ en: "Only the owner and direct collaborators keep user access.", fr: "Seuls le propriétaire et les collaborateurs directs conservent un accès utilisateur.", de: "Nur der Eigentümer und direkte Mitwirkende behalten Benutzerzugriff.", zh: "只有所有者和直接协作者保留用户访问权限。" }),
                    t({ en: "Account-wide automatic access stops.", fr: "L'accès automatique à tout le compte s'arrête.", de: "Der automatische accountweite Zugriff endet.", zh: "面向全账户的自动访问将停止。" }),
                    t({ en: "Public links remain managed separately.", fr: "Les liens publics restent gérés séparément.", de: "Öffentliche Links werden weiterhin separat verwaltet.", zh: "公开链接仍独立管理。" }),
                  ]
          }
          onCancel={onAccessChangeCancel}
          onConfirm={() => onAccessChangeConfirm(pendingAccessChange)}
        />
      ) : null}

      {pendingAccessRevoke ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen", zh: "撤销访问权限" })}
          description={t({ en: "Confirm that you want to remove this direct collaborator.", fr: "Confirmez que vous voulez retirer ce collaborateur direct.", de: "Bestätigen Sie, dass Sie diesen direkten Mitwirkenden entfernen möchten.", zh: "确认要移除此直接协作者。" })}
          confirmLabel={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen", zh: "撤销访问权限" })}
          loading={loading}
          details={[
            { label: t({ en: "Person", fr: "Personne", de: "Person", zh: "人员" }), value: pendingAccessRevoke.email },
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: spaceName },
            { label: t({ en: "Access", fr: "Accès", de: "Zugriff", zh: "访问权限" }), value: portalRoleLabel(pendingAccessRevoke.role, t) },
          ]}
          impacts={[
            t({ en: "This person loses direct access immediately.", fr: "Cette personne perd immédiatement son accès direct.", de: "Diese Person verliert sofort den direkten Zugriff.", zh: "此人将立即失去直接访问权限。" }),
            t({ en: "Files in the space are not deleted.", fr: "Les fichiers de l'espace ne sont pas supprimés.", de: "Dateien im Bereich werden nicht gelöscht.", zh: "空间中的文件不会被删除。" }),
          ]}
          onCancel={onAccessRevokeCancel}
          onConfirm={() => onAccessRevokeConfirm(pendingAccessRevoke)}
        />
      ) : null}

      {pendingAccessRoleChange ? (
        <ConfirmActionDialog
          title={t({
            en: "Change access role",
            fr: "Modifier le rôle d'accès",
            de: "Zugriffsrolle ändern",
            zh: "更改访问角色",
          })}
          description={t({
            en: "Review the new role before applying it to this space.",
            fr: "Vérifiez le nouveau rôle avant de l'appliquer à cet espace.",
            de: "Prüfen Sie die neue Rolle, bevor Sie sie auf diesen Bereich anwenden.",
            zh: "请先检查新角色，再将其应用到此空间。",
          })}
          confirmLabel={t({
            en: "Update role",
            fr: "Mettre à jour le rôle",
            de: "Rolle aktualisieren",
            zh: "更新角色",
          })}
          tone="primary"
          loading={loading}
          details={[
            {
              label: t({ en: "Person", fr: "Personne", de: "Person", zh: "人员" }),
              value: pendingAccessRoleChange.share.email,
            },
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: spaceName },
            {
              label: t({ en: "Current role", fr: "Rôle actuel", de: "Aktuelle Rolle", zh: "当前角色" }),
              value: portalRoleLabel(pendingAccessRoleChange.share.role, t),
            },
            {
              label: t({ en: "New role", fr: "Nouveau rôle", de: "Neue Rolle", zh: "新角色" }),
              value: portalRoleLabel(pendingAccessRoleChange.role, t),
            },
          ]}
          onCancel={onAccessRoleChangeCancel}
          onConfirm={() => onAccessRoleChangeConfirm(pendingAccessRoleChange)}
        />
      ) : null}
    </>
  );
}
