/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserDeletedObjectTarget } from "../browser/browserPageContract";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../utils/format";
import { portalDateTimeLabel } from "./portalI18n";

type PortalStorageSpaceLifecycleDialogsProps = {
  spaceName: string;
  usedBytes: number | null | undefined;
  trashRestoreTarget: BrowserDeletedObjectTarget | null;
  restoringTrashKey: string | null;
  historyCleanupConfirmOpen: boolean;
  onTrashRestoreCancel: () => void;
  onTrashRestoreConfirm: (target: BrowserDeletedObjectTarget) => void | Promise<void>;
  onHistoryCleanupCancel: () => void;
  onHistoryCleanupConfirm: () => void;
};

export default function PortalStorageSpaceLifecycleDialogs({
  spaceName,
  usedBytes,
  trashRestoreTarget,
  restoringTrashKey,
  historyCleanupConfirmOpen,
  onTrashRestoreCancel,
  onTrashRestoreConfirm,
  onHistoryCleanupCancel,
  onHistoryCleanupConfirm,
}: PortalStorageSpaceLifecycleDialogsProps) {
  const { locale, t } = useI18n();

  return (
    <>
      {trashRestoreTarget ? (
        <ConfirmActionDialog
          title={t({
            en: "Restore this file?",
            fr: "Restaurer ce fichier ?",
            de: "Diese Datei wiederherstellen?",
            zh: "恢复此文件？",
          })}
          description={t({
            en: "The latest recoverable version will return to its original folder.",
            fr: "La dernière version récupérable retournera dans son dossier d'origine.",
            de: "Die neueste wiederherstellbare Version wird in ihren ursprünglichen Ordner zurückgelegt.",
            zh: "最新的可恢复版本将返回其原始文件夹。",
          })}
          confirmLabel={t({
            en: "Restore file",
            fr: "Restaurer le fichier",
            de: "Datei wiederherstellen",
            zh: "恢复文件",
          })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
          tone="primary"
          loading={restoringTrashKey === trashRestoreTarget.key}
          details={[
            {
              label: t({ en: "File", fr: "Fichier", de: "Datei", zh: "文件" }),
              value: trashRestoreTarget.name,
            },
            {
              label: t({ en: "Original location", fr: "Emplacement d'origine", de: "Ursprünglicher Ort", zh: "原始位置" }),
              value: trashRestoreTarget.key,
              mono: true,
            },
            {
              label: t({ en: "Deleted", fr: "Supprimé", de: "Gelöscht", zh: "删除时间" }),
              value: portalDateTimeLabel(trashRestoreTarget.deletedAt, locale),
            },
          ]}
          impacts={[
            t({
              en: "The file will reappear in Files at the same location.",
              fr: "Le fichier réapparaîtra dans Fichiers, au même emplacement.",
              de: "Die Datei erscheint unter Dateien wieder am selben Ort.",
              zh: "文件将重新出现在“文件”中的原位置。",
            }),
            t({
              en: "Its previous history remains available.",
              fr: "Son historique précédent reste disponible.",
              de: "Der bisherige Verlauf bleibt verfügbar.",
              zh: "其历史记录仍然可用。",
            }),
          ]}
          onCancel={onTrashRestoreCancel}
          onConfirm={() => onTrashRestoreConfirm(trashRestoreTarget)}
        />
      ) : null}

      {historyCleanupConfirmOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Clean up history", fr: "Nettoyer l'historique", de: "Historie bereinigen", zh: "清理历史记录" })}
          description={t({
            en: "Confirm that you want to permanently remove older file history from this space.",
            fr: "Confirmez la suppression définitive de l'ancien historique des fichiers de cet espace.",
            de: "Bestätigen Sie, dass ältere Dateihistorie aus diesem Bereich dauerhaft entfernt werden soll.",
            zh: "确认要永久移除此空间中较早的文件历史记录。",
          })}
          confirmLabel={t({ en: "Start cleanup", fr: "Démarrer le nettoyage", de: "Bereinigung starten", zh: "开始清理" })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: spaceName },
            {
              label: t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher", zh: "当前存储用量" }),
              value: formatBytes(usedBytes),
            },
          ]}
          impacts={[
            t({
              en: "Current files stay available.",
              fr: "Les fichiers courants restent disponibles.",
              de: "Aktuelle Dateien bleiben verfügbar.",
              zh: "当前文件仍然可用。",
            }),
            t({
              en: "Older file versions and leftover deletion records are permanently removed.",
              fr: "Les anciennes versions de fichiers et les traces de suppression restantes sont supprimées définitivement.",
              de: "Ältere Dateiversionen und verbliebene Löschvermerke werden dauerhaft entfernt.",
              zh: "较早的文件版本和残留删除记录将被永久移除。",
            }),
            t({
              en: "The cleanup scans the entire space and can take some time.",
              fr: "Le nettoyage parcourt tout l'espace et peut prendre du temps.",
              de: "Die Bereinigung durchsucht den gesamten Bereich und kann einige Zeit dauern.",
              zh: "清理会扫描整个空间，可能需要一些时间。",
            }),
          ]}
          onCancel={onHistoryCleanupCancel}
          onConfirm={onHistoryCleanupConfirm}
        />
      ) : null}
    </>
  );
}
