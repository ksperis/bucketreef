/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { portalStorageSpaceVersionCleanupConfirmationPhrase, streamPortalStorageSpaceVersionCleanup, type PortalStorageSpaceVersionCleanupProgress, type PortalStorageSpaceVersionCleanupResult } from "../../api/portal";
import InlineSummary from "../../components/InlineSummary";
import { WorkflowSection } from "../../components/WorkflowPage";
import { SettingsButton } from "../../components/settings/SettingsControls";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalOperationLayout, { PortalOperationProgress } from "./PortalOperationLayout";
import { usePortalStreamOperation } from "./usePortalStreamOperation";

export default function PortalStorageSpaceHistoryCleanupWorkflow({ accountId, spaceId, spaceName, usedBytes, enabled, onClose, onStart, onCompleted, onRefresh }: {
  accountId: string | number; spaceId: string; spaceName: string; usedBytes?: number | null; enabled: boolean;
  onClose: () => void; onStart: () => void; onCompleted: (bytesFreed: number) => void; onRefresh: () => void;
}) {
  const { t } = useI18n();
  const { running, progress, result, error, start, stop } = usePortalStreamOperation<PortalStorageSpaceVersionCleanupProgress, PortalStorageSpaceVersionCleanupResult>({
    enabled, autoStart: true, onStart, onStopped: onRefresh,
    execute: options => streamPortalStorageSpaceVersionCleanup(accountId, spaceId, { confirmation: portalStorageSpaceVersionCleanupConfirmationPhrase(spaceName) }, options),
    onResult: value => { onRefresh(); if (value.status === "completed") onCompleted(value.bytes_freed); },
    stoppedMessage: t({ en: "Cleanup stopped. History already removed cannot be restored.", fr: "Nettoyage arrêté. L'historique déjà supprimé ne peut pas être restauré.", de: "Bereinigung gestoppt. Bereits gelöschte Historie kann nicht wiederhergestellt werden.", zh: "清理已停止。已删除的历史无法恢复。" }),
    errorMessage: cause => extractApiError(cause, t({ en: "Unable to clean up this Storage Space history.", fr: "Impossible de nettoyer l'historique de cet espace.", de: "Der Verlauf dieses Bereichs kann nicht bereinigt werden.", zh: "无法清理此存储空间的历史记录。" })),
  });
  const counts = result ?? progress;
  const deleted = (counts?.deleted_versions ?? 0) + (counts?.deleted_delete_markers ?? 0);
  const percent = result?.status === "completed" ? 100 : !result && progress?.total_candidates_final && progress.delete_candidates > 0
    ? Math.min(100, Math.round(deleted / progress.delete_candidates * 100)) : null;
  return <PortalOperationLayout
      title={t({
        en: "Clean up history",
        fr: "Nettoyer l'historique",
        de: "Historie bereinigen",
        zh: "清理历史记录",
      })}
      description={t({
        en: "Review the impact, follow the complete scan and keep the cleanup result visible.",
        fr: "Vérifiez l'impact, suivez l'analyse complète et conservez le résultat du nettoyage visible.",
        de: "Prüfen Sie die Auswirkungen, verfolgen Sie den vollständigen Scan und behalten Sie das Ergebnis sichtbar.",
        zh: "检查操作影响，跟踪完整扫描过程，并保留清理结果以便查看。",
      })}
      breadcrumbs={portalBreadcrumbs(
        {
          label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche", zh: "空间" }),
          to: "/portal/storage-spaces",
        },
        { label: spaceName },
        {
          label: t({
            en: "History cleanup",
            fr: "Nettoyage de l'historique",
            de: "Historienbereinigung",
            zh: "历史记录清理",
          }),
        },
      )}
      backLabel={t({
        en: "Back to the space",
        fr: "Retour à l'espace",
        de: "Zurück zum Bereich",
        zh: "返回空间",
      })}
      running={running} onClose={onClose}
      metadata={[{ label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: spaceName },
        { label: t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher", zh: "当前存储用量" }), value: formatBytes(usedBytes) }]}
      actions={running ? <SettingsButton variant="secondary" onClick={stop}>{t({ en: "Stop cleanup", fr: "Arrêter le nettoyage", de: "Bereinigung stoppen", zh: "停止清理" })}</SettingsButton>
        : result ? <SettingsButton onClick={onClose}>{t({ en: "Done", fr: "Terminer", de: "Fertig", zh: "完成" })}</SettingsButton>
        : <><SettingsButton variant="secondary" onClick={onClose}>{t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}</SettingsButton>
          <SettingsButton variant="danger" disabled={!enabled} onClick={() => void start()}>{t({ en: "Start cleanup", fr: "Démarrer le nettoyage", de: "Bereinigung starten", zh: "开始清理" })}</SettingsButton></>}>
    <UiInlineMessage tone="warning">{t({
      en: "This scans the entire space, deletes older file versions, then removes leftover deletion records. Current files are kept, but deleted history cannot be restored from Portal.",
      fr: "Cette opération parcourt tout l'espace, supprime les anciennes versions de fichiers, puis retire les traces de suppression restantes. Les fichiers courants sont conservés, mais l'historique supprimé ne pourra pas être restauré depuis Portal.",
      de: "Diese Aktion durchsucht den gesamten Bereich, löscht ältere Dateiversionen und entfernt verbliebene Löschvermerke. Aktuelle Dateien bleiben erhalten, gelöschte Historie kann in Portal aber nicht wiederhergestellt werden.",
      zh: "此操作会扫描整个空间，删除旧文件版本，再移除残留删除记录。当前文件会保留，但删除的历史记录无法从 Portal 恢复。",
    })}</UiInlineMessage>
    {error && <UiInlineMessage tone="warning" role="alert">{error}</UiInlineMessage>}
    {(running || counts) && <PortalOperationProgress running={running}
      label={t({ en: "Storage Space history cleanup progress", fr: "Progression du nettoyage de l'historique", de: "Fortschritt der Historienbereinigung", zh: "存储空间历史记录清理进度" })}
      message={result ? t({ en: "Cleanup finished", fr: "Nettoyage terminé", de: "Bereinigung beendet", zh: "清理已完成" }) : !running ? t({ en: "Last reported progress", fr: "Dernier état reçu", de: "Zuletzt gemeldeter Fortschritt", zh: "最新报告的进度" }) : progress?.message || t({ en: "Preparing cleanup...", fr: "Préparation du nettoyage...", de: "Bereinigung wird vorbereitet...", zh: "正在准备清理…" })}
      count={result ? t({ en: `${formatCompactNumber(deleted)} removed`, fr: `${formatCompactNumber(deleted)} supprimés`, de: `${formatCompactNumber(deleted)} entfernt`, zh: `已删除 ${formatCompactNumber(deleted)} 项` }) : <>{formatCompactNumber(deleted)} / {progress?.total_candidates_final
        ? formatCompactNumber(progress.delete_candidates)
        : progress && progress.delete_candidates > 0 ? t({ en: `at least ${formatCompactNumber(progress.delete_candidates)}`, fr: `au moins ${formatCompactNumber(progress.delete_candidates)}`, de: `mindestens ${formatCompactNumber(progress.delete_candidates)}`, zh: `至少 ${formatCompactNumber(progress.delete_candidates)}` })
        : t({ en: "discovering", fr: "détection", de: "wird ermittelt", zh: "正在查找" })}</>}
      value={percent} detail={t({
        en: `${formatCompactNumber(counts?.scanned_versions ?? 0)} versions and ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} deletion records scanned.`,
        fr: `${formatCompactNumber(counts?.scanned_versions ?? 0)} versions et ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} traces de suppression analysées.`,
        de: `${formatCompactNumber(counts?.scanned_versions ?? 0)} Versionen und ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} Löschvermerke geprüft.`,
        zh: `已扫描 ${formatCompactNumber(counts?.scanned_versions ?? 0)} 个版本和 ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} 条删除记录。`,
      })} />}
    {progress && !result && <InlineSummary items={[{ label: t({ en: "Space gained so far", fr: "Espace gagné pour l'instant", de: "Bisher frei geworden", zh: "目前已释放的空间" }), value: formatBytes(progress.bytes_freed) }]} />}
    {result && <WorkflowSection title={t({ en: "Result", fr: "Résultat", de: "Ergebnis", zh: "结果" })}>
      {result.status !== "completed" && <UiInlineMessage tone="warning" role="status">{result.status === "canceled"
        ? t({ en: "Cleanup stopped before completion.", fr: "Nettoyage arrêté avant la fin.", de: "Bereinigung vorzeitig gestoppt.", zh: "清理在完成前已停止。" })
        : t({ en: "Cleanup failed. Review the partial result below.", fr: "Le nettoyage a échoué. Consultez le résultat partiel ci-dessous.", de: "Bereinigung fehlgeschlagen. Prüfen Sie das Teilergebnis unten.", zh: "清理失败。请查看下方的部分结果。" })}</UiInlineMessage>}
      <InlineSummary items={[
        { label: t({ en: "Space gained", fr: "Espace gagné", de: "Frei geworden", zh: "已释放空间" }), value: formatBytes(result.bytes_freed), hint: t({ en: "estimated", fr: "estimé", de: "geschätzt", zh: "估算值" }) },
        { label: t({ en: "Versions deleted", fr: "Versions supprimées", de: "Versionen gelöscht", zh: "已删除版本" }), value: formatCompactNumber(result.deleted_versions), hint: t({ en: "historical", fr: "historiques", de: "historisch", zh: "历史版本" }) },
        { label: t({ en: "Deletion records removed", fr: "Traces de suppression retirées", de: "Löschvermerke entfernt", zh: "已删除的删除记录" }), value: formatCompactNumber(result.deleted_delete_markers) },
      ]} />
    </WorkflowSection>}
  </PortalOperationLayout>;
}
