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
    stoppedMessage: t({ en: "Cleanup stopped. History already removed cannot be restored.", fr: "Nettoyage arrêté. L'historique déjà supprimé ne peut pas être restauré.", de: "Bereinigung gestoppt. Bereits gelöschte Historie kann nicht wiederhergestellt werden." }),
    errorMessage: cause => extractApiError(cause, t({ en: "Unable to clean up this Storage Space history.", fr: "Impossible de nettoyer l'historique de cet espace.", de: "Der Verlauf dieses Bereichs kann nicht bereinigt werden." })),
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
      })}
      description={t({
        en: "Review the impact, follow the complete scan and keep the cleanup result visible.",
        fr: "Vérifiez l'impact, suivez l'analyse complète et conservez le résultat du nettoyage visible.",
        de: "Prüfen Sie die Auswirkungen, verfolgen Sie den vollständigen Scan und behalten Sie das Ergebnis sichtbar.",
      })}
      breadcrumbs={portalBreadcrumbs(
        {
          label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }),
          to: "/portal/storage-spaces",
        },
        { label: spaceName },
        {
          label: t({
            en: "History cleanup",
            fr: "Nettoyage de l'historique",
            de: "Historienbereinigung",
          }),
        },
      )}
      backLabel={t({
        en: "Back to the space",
        fr: "Retour à l'espace",
        de: "Zurück zum Bereich",
      })}
      running={running} onClose={onClose}
      metadata={[{ label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: spaceName },
        { label: t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher" }), value: formatBytes(usedBytes) }]}
      actions={running ? <SettingsButton variant="secondary" onClick={stop}>{t({ en: "Stop cleanup", fr: "Arrêter le nettoyage", de: "Bereinigung stoppen" })}</SettingsButton>
        : result ? <SettingsButton onClick={onClose}>{t({ en: "Done", fr: "Terminer", de: "Fertig" })}</SettingsButton>
        : <><SettingsButton variant="secondary" onClick={onClose}>{t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}</SettingsButton>
          <SettingsButton variant="danger" disabled={!enabled} onClick={() => void start()}>{t({ en: "Start cleanup", fr: "Démarrer le nettoyage", de: "Bereinigung starten" })}</SettingsButton></>}>
    <UiInlineMessage tone="warning">{t({
      en: "This scans the entire space, deletes older file versions, then removes leftover deletion records. Current files are kept, but deleted history cannot be restored from Portal.",
      fr: "Cette opération parcourt tout l'espace, supprime les anciennes versions de fichiers, puis retire les traces de suppression restantes. Les fichiers courants sont conservés, mais l'historique supprimé ne pourra pas être restauré depuis Portal.",
      de: "Diese Aktion durchsucht den gesamten Bereich, löscht ältere Dateiversionen und entfernt verbliebene Löschvermerke. Aktuelle Dateien bleiben erhalten, gelöschte Historie kann in Portal aber nicht wiederhergestellt werden.",
    })}</UiInlineMessage>
    {error && <UiInlineMessage tone="warning" role="alert">{error}</UiInlineMessage>}
    {(running || counts) && <PortalOperationProgress running={running}
      label={t({ en: "Storage Space history cleanup progress", fr: "Progression du nettoyage de l'historique", de: "Fortschritt der Historienbereinigung" })}
      message={result ? t({ en: "Cleanup finished", fr: "Nettoyage terminé", de: "Bereinigung beendet" }) : !running ? t({ en: "Last reported progress", fr: "Dernier état reçu", de: "Zuletzt gemeldeter Fortschritt" }) : progress?.message || t({ en: "Preparing cleanup...", fr: "Préparation du nettoyage...", de: "Bereinigung wird vorbereitet..." })}
      count={result ? t({ en: `${formatCompactNumber(deleted)} removed`, fr: `${formatCompactNumber(deleted)} supprimés`, de: `${formatCompactNumber(deleted)} entfernt` }) : <>{formatCompactNumber(deleted)} / {progress?.total_candidates_final
        ? formatCompactNumber(progress.delete_candidates)
        : progress && progress.delete_candidates > 0 ? t({ en: `at least ${formatCompactNumber(progress.delete_candidates)}`, fr: `au moins ${formatCompactNumber(progress.delete_candidates)}`, de: `mindestens ${formatCompactNumber(progress.delete_candidates)}` })
        : t({ en: "discovering", fr: "détection", de: "wird ermittelt" })}</>}
      value={percent} detail={t({
        en: `${formatCompactNumber(counts?.scanned_versions ?? 0)} versions and ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} deletion records scanned.`,
        fr: `${formatCompactNumber(counts?.scanned_versions ?? 0)} versions et ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} traces de suppression analysées.`,
        de: `${formatCompactNumber(counts?.scanned_versions ?? 0)} Versionen und ${formatCompactNumber(counts?.scanned_delete_markers ?? 0)} Löschvermerke geprüft.`,
      })} />}
    {progress && !result && <InlineSummary items={[{ label: t({ en: "Space gained so far", fr: "Espace gagné pour l'instant", de: "Bisher frei geworden" }), value: formatBytes(progress.bytes_freed) }]} />}
    {result && <WorkflowSection title={t({ en: "Result", fr: "Résultat", de: "Ergebnis" })}>
      {result.status !== "completed" && <UiInlineMessage tone="warning" role="status">{result.status === "canceled"
        ? t({ en: "Cleanup stopped before completion.", fr: "Nettoyage arrêté avant la fin.", de: "Bereinigung vorzeitig gestoppt." })
        : t({ en: "Cleanup failed. Review the partial result below.", fr: "Le nettoyage a échoué. Consultez le résultat partiel ci-dessous.", de: "Bereinigung fehlgeschlagen. Prüfen Sie das Teilergebnis unten." })}</UiInlineMessage>}
      <InlineSummary items={[
        { label: t({ en: "Space gained", fr: "Espace gagné", de: "Frei geworden" }), value: formatBytes(result.bytes_freed), hint: t({ en: "estimated", fr: "estimé", de: "geschätzt" }) },
        { label: t({ en: "Versions deleted", fr: "Versions supprimées", de: "Versionen gelöscht" }), value: formatCompactNumber(result.deleted_versions), hint: t({ en: "historical", fr: "historiques", de: "historisch" }) },
        { label: t({ en: "Deletion records removed", fr: "Traces de suppression retirées", de: "Löschvermerke entfernt" }), value: formatCompactNumber(result.deleted_delete_markers) },
      ]} />
    </WorkflowSection>}
  </PortalOperationLayout>;
}
