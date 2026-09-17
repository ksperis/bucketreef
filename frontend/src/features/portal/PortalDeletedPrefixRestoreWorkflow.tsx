/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { streamPortalDeletedPrefixRestore, type PortalDeletedPrefixRestoreProgress, type PortalDeletedPrefixRestoreResult } from "../../api/portal";
import InlineSummary from "../../components/InlineSummary";
import { WorkflowSection } from "../../components/WorkflowPage";
import { SettingsButton } from "../../components/settings/SettingsControls";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatCompactNumber } from "../../utils/format";
import type { BrowserObjectDetailsRouteTarget } from "../browser/browserPageContract";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalOperationLayout, { PortalOperationProgress } from "./PortalOperationLayout";
import { usePortalStreamOperation } from "./usePortalStreamOperation";

export default function PortalDeletedPrefixRestoreWorkflow({ accountId, spaceId, spaceName, target, onClose, onBrowserRefresh, onWorkspaceRefresh }: {
  accountId: string | number; spaceId: string; spaceName: string; target: BrowserObjectDetailsRouteTarget;
  onClose: () => void; onBrowserRefresh: () => void; onWorkspaceRefresh: () => void;
}) {
  const { t } = useI18n();
  const { running, progress, result, error, start, stop } = usePortalStreamOperation<PortalDeletedPrefixRestoreProgress, PortalDeletedPrefixRestoreResult>({
    execute: options => streamPortalDeletedPrefixRestore(accountId, spaceId, target.key, options),
    onResult: () => { onBrowserRefresh(); onWorkspaceRefresh(); },
    onStopped: onBrowserRefresh,
    stoppedMessage: t({ en: "Restoration stopped. Files already restored remain available.", fr: "Restauration arrêtée. Les fichiers déjà restaurés restent disponibles.", de: "Wiederherstellung gestoppt. Bereits wiederhergestellte Dateien bleiben verfügbar.", zh: "恢复已停止。已恢复的文件仍然可用。" }),
    errorMessage: cause => extractApiError(cause, t({ en: "Unable to restore the deleted files in this folder.", fr: "Impossible de restaurer les fichiers supprimés de ce dossier.", de: "Gelöschte Dateien in diesem Ordner konnten nicht wiederhergestellt werden.", zh: "无法恢复此文件夹中的已删除文件。" })),
  });
  const counts = result ?? progress;
  const processed = (counts?.restored_objects ?? 0) + (counts?.failed_objects ?? 0);
  const totalKnown = Boolean(result || progress?.total_candidates_final);
  const percent = totalKnown && counts && counts.restore_candidates > 0
    ? Math.min(100, Math.round(processed / counts.restore_candidates * 100))
    : result?.status === "completed" || progress?.stage === "completed" ? 100 : null;
  return <PortalOperationLayout
      title={t({
        en: "Restore deleted files",
        fr: "Restaurer les fichiers supprimés",
        de: "Gelöschte Dateien wiederherstellen",
        zh: "恢复已删除文件",
      })}
      description={t({
        en: "Restore recoverable files from this folder and its subfolders.",
        fr: "Restaurez les fichiers récupérables de ce dossier et de ses sous-dossiers.",
        de: "Stellen Sie wiederherstellbare Dateien aus diesem Ordner und seinen Unterordnern wieder her.",
        zh: "恢复此文件夹及其子文件夹中可恢复的文件。",
      })}
      breadcrumbs={portalBreadcrumbs(
        {
          label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche", zh: "空间" }),
          to: "/portal/storage-spaces",
        },
        { label: spaceName },
        {
          label: t({
            en: "Restore folder",
            fr: "Restaurer le dossier",
            de: "Ordner wiederherstellen",
            zh: "恢复文件夹",
          }),
        },
      )}
      backLabel={t({
        en: "Back to files",
        fr: "Retour aux fichiers",
        de: "Zurück zu Dateien",
        zh: "返回文件列表",
      })}
      running={running} onClose={onClose}
      metadata={[{ label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }), value: spaceName },
        { label: t({ en: "Folder", fr: "Dossier", de: "Ordner", zh: "文件夹" }), value: <span className="font-mono whitespace-pre-wrap">{target.key}</span> }]}
      actions={running ? <SettingsButton variant="secondary" onClick={stop}>{t({ en: "Stop", fr: "Arrêter", de: "Stoppen", zh: "停止" })}</SettingsButton>
        : result ? <SettingsButton onClick={onClose}>{t({ en: "Done", fr: "Terminer", de: "Fertig", zh: "完成" })}</SettingsButton>
        : <><SettingsButton variant="secondary" onClick={onClose}>{t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}</SettingsButton>
          <SettingsButton onClick={() => void start()}>{t({ en: "Restore files", fr: "Restaurer les fichiers", de: "Dateien wiederherstellen", zh: "恢复文件" })}</SettingsButton></>}>
    <UiInlineMessage>{t({
      en: "Only files that are currently deleted are restored. Existing files and version history are kept.",
      fr: "Seuls les fichiers actuellement supprimés sont restaurés. Les fichiers existants et leur historique sont conservés.",
      de: "Nur aktuell gelöschte Dateien werden wiederhergestellt. Vorhandene Dateien und der Versionsverlauf bleiben erhalten.",
      zh: "仅恢复当前已删除的文件。现有文件和版本历史将保留。",
    })}</UiInlineMessage>
    {error && <UiInlineMessage tone="warning" role="alert">{error}</UiInlineMessage>}
    {(running || counts) && <PortalOperationProgress running={running}
      label={t({ en: "Deleted file restoration progress", fr: "Progression de la restauration", de: "Fortschritt der Wiederherstellung", zh: "已删除文件恢复进度" })}
      message={result ? t({ en: "Restoration finished", fr: "Restauration terminée", de: "Wiederherstellung beendet", zh: "恢复已完成" }) : !running ? t({ en: "Last reported progress", fr: "Dernier état reçu", de: "Zuletzt gemeldeter Fortschritt", zh: "最新报告的进度" }) : progress?.message || t({ en: "Preparing restoration...", fr: "Préparation de la restauration...", de: "Wiederherstellung wird vorbereitet...", zh: "正在准备恢复…" })}
      count={<>{formatCompactNumber(processed)} / {totalKnown ? formatCompactNumber(counts?.restore_candidates ?? 0) : t({ en: "discovering", fr: "détection", de: "wird ermittelt", zh: "正在查找" })}</>}
      value={percent} detail={t({
        en: `${formatCompactNumber(counts?.scanned_versions ?? 0)} versions and ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} deletion records scanned.`,
        fr: `${formatCompactNumber(counts?.scanned_versions ?? 0)} versions et ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} traces de suppression analysées.`,
        de: `${formatCompactNumber(counts?.scanned_versions ?? 0)} Versionen und ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} Löschvermerke geprüft.`,
        zh: `已扫描 ${formatCompactNumber(counts?.scanned_versions ?? 0)} 个版本和 ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} 条删除记录。`,
      })} />}
    {result && <WorkflowSection title={t({ en: "Result", fr: "Résultat", de: "Ergebnis", zh: "结果" })}>
      {result.status === "canceled" && <UiInlineMessage tone="warning" role="status">{t({ en: "Restoration stopped. Files already restored remain available.", fr: "Restauration arrêtée. Les fichiers déjà restaurés restent disponibles.", de: "Wiederherstellung gestoppt. Bereits wiederhergestellte Dateien bleiben verfügbar.", zh: "恢复已停止。已恢复的文件仍然可用。" })}</UiInlineMessage>}
      <InlineSummary items={[
        { label: t({ en: "Found", fr: "Trouvés", de: "Gefunden", zh: "已找到" }), value: formatCompactNumber(result.restore_candidates), hint: t({ en: "recoverable files", fr: "fichiers récupérables", de: "wiederherstellbare Dateien", zh: "个可恢复文件" }) },
        { label: t({ en: "Restored", fr: "Restaurés", de: "Wiederhergestellt", zh: "已恢复" }), value: formatCompactNumber(result.restored_objects), hint: t({ en: "returned to their folders", fr: "replacés dans leurs dossiers", de: "in ihre Ordner zurückgelegt", zh: "已放回原文件夹" }) },
        { label: t({ en: "Failed", fr: "Échecs", de: "Fehlgeschlagen", zh: "失败" }), value: formatCompactNumber(result.failed_objects), hint: result.failed_objects > 0 ? t({ en: "review below", fr: "à vérifier ci-dessous", de: "unten prüfen", zh: "请查看下方" }) : undefined },
      ]} />
      {result.failures_truncated && <UiInlineMessage tone="warning">{t({ en: "Only some failure details are shown.", fr: "Seule une partie des erreurs est affichée.", de: "Es wird nur ein Teil der Fehlerdetails angezeigt.", zh: "仅显示部分失败详情。" })}</UiInlineMessage>}
      {result.failures.length > 0 && <WorkflowSection title={t({ en: "Files requiring attention", fr: "Fichiers à vérifier", de: "Zu prüfende Dateien", zh: "需要关注的文件" })}>
        <ul className="settings-description space-y-2">{result.failures.map(failure => <li key={failure.key} className="break-words [overflow-wrap:anywhere]">
          <span className="font-mono whitespace-pre-wrap">{failure.key}</span>{" — "}{failure.detail}
        </li>)}</ul>
      </WorkflowSection>}
    </WorkflowSection>}
  </PortalOperationLayout>;
}
