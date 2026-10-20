/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useI18n } from "../../i18n";
import { formatBytes, formatCompactNumber } from "../../utils/format";

type PortalStorageSpaceDialogSpace = {
  name: string;
  ownerLabel?: string | null;
  objectCount?: number | null;
  usedBytes?: number | null;
};

type PortalStorageSpaceManagementDialogsProps = {
  space: PortalStorageSpaceDialogSpace;
  isArchived: boolean;
  takeOwnershipOpen: boolean;
  takeOwnershipBusy: boolean;
  onTakeOwnershipCancel: () => void;
  onTakeOwnershipConfirm: () => void | Promise<void>;
  archiveOpen: boolean;
  archiveBusy: boolean;
  onArchiveCancel: () => void;
  onArchiveConfirm: () => void | Promise<void>;
  deleteOpen: boolean;
  deleteBusy: boolean;
  deleteError: string | null;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void | Promise<void>;
};

export default function PortalStorageSpaceManagementDialogs({
  space,
  isArchived,
  takeOwnershipOpen,
  takeOwnershipBusy,
  onTakeOwnershipCancel,
  onTakeOwnershipConfirm,
  archiveOpen,
  archiveBusy,
  onArchiveCancel,
  onArchiveConfirm,
  deleteOpen,
  deleteBusy,
  deleteError,
  onDeleteCancel,
  onDeleteConfirm,
}: PortalStorageSpaceManagementDialogsProps) {
  const { t } = useI18n();
  const deletionStatsKnown = space.objectCount != null && space.usedBytes != null;
  const storageSpaceIsEmpty =
    deletionStatsKnown && space.objectCount === 0 && space.usedBytes === 0;

  return (
    <>
      {takeOwnershipOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Take ownership", fr: "Reprendre la propriété", de: "Eigentümerschaft übernehmen", zh: "接管所有权" })}
          description={t({
            en: "Confirm that you want to become the owner of this private space.",
            fr: "Confirmez que vous souhaitez devenir propriétaire de cet espace privé.",
            de: "Bestätigen Sie, dass Sie Eigentümer dieses privaten Bereichs werden möchten.",
            zh: "确认要成为此私有空间的所有者。",
          })}
          confirmLabel={t({ en: "Take ownership", fr: "Reprendre la propriété", de: "Übernehmen", zh: "接管所有权" })}
          loading={takeOwnershipBusy}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            { label: t({ en: "Current owner", fr: "Propriétaire actuel", de: "Aktueller Eigentümer", zh: "当前所有者" }), value: space.ownerLabel ?? "-" },
          ]}
          impacts={[
            t({ en: "You receive the Owner role for this private space.", fr: "Vous recevez le rôle Propriétaire pour cet espace privé.", de: "Sie erhalten die Eigentümerrolle für diesen privaten Bereich.", zh: "你将获得此私有空间的所有者角色。" }),
            t({ en: "The previous owner loses their access to this private space.", fr: "L'ancien propriétaire perd son accès à cet espace privé.", de: "Der vorherige Eigentümer verliert den Zugriff auf diesen privaten Bereich.", zh: "原所有者将失去对此私有空间的访问权限。" }),
          ]}
          warning={t({ en: "Ownership transfer is immediate.", fr: "Le transfert de propriété est immédiat.", de: "Die Eigentumsübertragung erfolgt sofort.", zh: "所有权转移立即生效。" })}
          onCancel={onTakeOwnershipCancel}
          onConfirm={onTakeOwnershipConfirm}
        />
      ) : null}

      {archiveOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Archive space", fr: "Archiver l'espace", de: "Bereich archivieren", zh: "归档空间" })}
          description={t({ en: "Confirm that you want to archive this space.", fr: "Confirmez que vous voulez archiver cet espace.", de: "Bestätigen Sie, dass Sie diesen Bereich archivieren möchten.", zh: "确认要归档此空间。" })}
          confirmLabel={t({ en: "Archive space", fr: "Archiver l'espace", de: "Bereich archivieren", zh: "归档空间" })}
          loading={archiveBusy}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            { label: t({ en: "Status", fr: "Statut", de: "Status", zh: "状态" }), value: t({ en: "Can be restored later", fr: "Restaurable plus tard", de: "Kann später wiederhergestellt werden", zh: "以后可以恢复" }) },
          ]}
          impacts={[
            t({ en: "The space is removed from active file work until it is restored.", fr: "L'espace est retiré des fichiers actifs jusqu'à sa restauration.", de: "Der Bereich wird bis zur Wiederherstellung aus der aktiven Dateiarbeit entfernt.", zh: "空间将暂停文件操作，直到恢复。" }),
            t({ en: "Existing files are kept and are not deleted.", fr: "Les fichiers existants sont conservés et ne sont pas supprimés.", de: "Bestehende Dateien bleiben erhalten und werden nicht gelöscht.", zh: "现有文件会保留，不会被删除。" }),
            t({ en: "Public links and file access are suspended while archived.", fr: "Les liens publics et l'accès aux fichiers sont suspendus pendant l'archivage.", de: "Öffentliche Links und Dateizugriff sind während der Archivierung ausgesetzt.", zh: "归档期间，公开链接和文件访问将暂停。" }),
          ]}
          warning={t({ en: "Archiving is reversible from this settings section.", fr: "L'archivage est réversible depuis cette section de paramètres.", de: "Die Archivierung kann in diesem Einstellungsbereich rückgängig gemacht werden.", zh: "可从此设置部分恢复已归档的空间。" })}
          onCancel={onArchiveCancel}
          onConfirm={onArchiveConfirm}
        />
      ) : null}

      {deleteOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Delete space", fr: "Supprimer l'espace", de: "Bereich löschen", zh: "删除空间" })}
          description={
            deleteError
              ? deleteError
              : storageSpaceIsEmpty
                ? t({
                    en: "Confirm the permanent deletion of this space and its storage bucket.",
                    fr: "Confirmez la suppression définitive de cet espace et de son bucket de stockage.",
                    de: "Bestätigen Sie die endgültige Löschung dieses Bereichs und seines Speicher-Buckets.",
                    zh: "确认永久删除此空间及其存储桶。",
                  })
                : deletionStatsKnown
                  ? t({
                      en: "This space cannot be deleted yet. Delete every current file, then clean up its history before trying again.",
                      fr: "Cet espace ne peut pas encore être supprimé. Supprimez tous les fichiers courants, puis nettoyez son historique avant de réessayer.",
                      de: "Dieser Bereich kann noch nicht gelöscht werden. Löschen Sie zuerst alle aktuellen Dateien und bereinigen Sie anschließend die Historie.",
                      zh: "暂时无法删除此空间。请先删除所有当前文件，再清理历史记录，然后重试。",
                    })
                  : t({
                      en: "Current storage statistics are unavailable. The server will verify that the bucket is empty before deleting anything.",
                      fr: "Les statistiques de stockage sont indisponibles. Le serveur vérifiera que le bucket est vide avant toute suppression.",
                      de: "Aktuelle Speicherstatistiken sind nicht verfügbar. Der Server prüft vor dem Löschen, ob der Bucket leer ist.",
                      zh: "无法获取当前存储统计信息。服务器将在执行删除前验证存储桶是否为空。",
                    })
          }
          confirmLabel={t({ en: "Delete space", fr: "Supprimer l'espace", de: "Bereich löschen", zh: "删除空间" })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
          loading={deleteBusy}
          confirmDisabled={deletionStatsKnown && !storageSpaceIsEmpty}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: space.name },
            {
              label: t({ en: "Current files", fr: "Fichiers courants", de: "Aktuelle Dateien", zh: "当前文件" }),
              value: space.objectCount == null ? "-" : formatCompactNumber(space.objectCount),
            },
            {
              label: t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher", zh: "当前存储用量" }),
              value: formatBytes(space.usedBytes),
            },
          ]}
          impacts={
            storageSpaceIsEmpty
              ? [
                  t({ en: "The Storage Space and its bucket are permanently deleted.", fr: "Le Storage Space et son bucket sont supprimés définitivement.", de: "Der Storage Space und sein Bucket werden endgültig gelöscht.", zh: "存储空间及其存储桶将被永久删除。" }),
                  t({ en: "Collaborator access, external credentials, and public links are revoked.", fr: "Les accès collaborateurs, identifiants externes et liens publics sont révoqués.", de: "Zugriffe von Mitwirkenden, externe Anmeldedaten und öffentliche Links werden widerrufen.", zh: "协作者访问权限、外部凭据和公开链接将被撤销。" }),
                ]
              : [
                  isArchived
                    ? t({ en: "Restore the space before removing files and cleaning its history.", fr: "Restaurez l'espace avant de supprimer les fichiers et de nettoyer son historique.", de: "Stellen Sie den Bereich wieder her, bevor Sie Dateien und Historie löschen.", zh: "请先恢复空间，再移除文件和清理历史记录。" })
                    : t({ en: "Remove current files from the Files tab.", fr: "Supprimez les fichiers courants depuis l'onglet Fichiers.", de: "Entfernen Sie aktuelle Dateien auf der Registerkarte Dateien.", zh: "从“文件”选项卡移除当前文件。" }),
                  t({ en: "Use History cleanup to remove older versions and delete markers.", fr: "Utilisez Nettoyage de l'historique pour retirer les anciennes versions et les delete markers.", de: "Verwenden Sie die Historienbereinigung, um ältere Versionen und Löschmarkierungen zu entfernen.", zh: "使用历史记录清理功能移除旧版本和删除标记。" }),
                ]
          }
          warning={t({
            en: "Portal never empties the bucket automatically during deletion.",
            fr: "Portal ne vide jamais automatiquement le bucket pendant la suppression.",
            de: "Portal leert den Bucket beim Löschen niemals automatisch.",
            zh: "删除空间时，Portal 不会自动清空存储桶。",
          })}
          onCancel={onDeleteCancel}
          onConfirm={onDeleteConfirm}
        />
      ) : null}
    </>
  );
}
