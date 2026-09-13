/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  portalStorageSpaceVersionCleanupConfirmationPhrase,
  streamPortalStorageSpaceVersionCleanup,
  type PortalStorageSpaceVersionCleanupProgress,
  type PortalStorageSpaceVersionCleanupResult,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import WorkflowPage, { WorkflowActions } from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import UiProgressBar from "../../components/ui/UiProgressBar";
import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalWorkflowMetricCard from "./PortalWorkflowMetricCard";

type PortalStorageSpaceHistoryCleanupWorkflowProps = {
  accountId: string | number;
  spaceId: string;
  spaceName: string;
  usedBytes?: number | null;
  enabled: boolean;
  onClose: () => void;
  onStart: () => void;
  onCompleted: (bytesFreed: number) => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function PortalStorageSpaceHistoryCleanupWorkflow({
  accountId,
  spaceId,
  spaceName,
  usedBytes,
  enabled,
  onClose,
  onStart,
  onCompleted,
}: PortalStorageSpaceHistoryCleanupWorkflowProps) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] =
    useState<PortalStorageSpaceVersionCleanupProgress | null>(null);
  const [result, setResult] =
    useState<PortalStorageSpaceVersionCleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const runCleanup = useCallback(async () => {
    if (!enabled || runningRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    runningRef.current = true;
    setRunning(true);
    setProgress(null);
    setResult(null);
    setError(null);
    onStart();
    try {
      const cleanupResult = await streamPortalStorageSpaceVersionCleanup(
        accountId,
        spaceId,
        {
          confirmation:
            portalStorageSpaceVersionCleanupConfirmationPhrase(spaceName),
        },
        {
          signal: controller.signal,
          onProgress: setProgress,
        },
      );
      setResult(cleanupResult);
      onCompleted(cleanupResult.bytes_freed);
    } catch (cleanupError) {
      if (isAbortError(cleanupError)) {
        setError(
          t({
            en: "Cleanup canceled.",
            fr: "Nettoyage annulé.",
            de: "Bereinigung abgebrochen.",
            zh: "清理已取消。",
          }),
        );
      } else {
        setError(
          extractApiError(
            cleanupError,
            t({
              en: "Unable to clean up this Storage Space history.",
              fr: "Impossible de nettoyer l'historique de cet espace.",
              de: "Der Verlauf dieses Bereichs kann nicht bereinigt werden.",
              zh: "无法清理此存储空间的历史记录。",
            }),
          ),
        );
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [accountId, enabled, onCompleted, onStart, spaceId, spaceName, t]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runCleanup();
  }, [runCleanup]);

  const deletedEntries =
    (progress?.deleted_versions ?? 0) +
    (progress?.deleted_delete_markers ?? 0);
  const progressPercent = progress
    ? progress.delete_candidates > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((deletedEntries / progress.delete_candidates) * 100),
          ),
        )
      : progress.stage === "completed"
        ? 100
        : null
    : null;

  return (
    <WorkflowPage
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
      onBack={running ? undefined : onClose}
      width="standard"
    >
      <div className="space-y-4">
        {error ? <PageBanner tone="warning">{error}</PageBanner> : null}
        <PageBanner tone="warning">
          {t({
            en: "This scans the entire space, deletes older file versions, then removes leftover deletion records. Current files are kept, but deleted history cannot be restored from Portal.",
            fr: "Cette opération parcourt tout l'espace, supprime les anciennes versions de fichiers, puis retire les traces de suppression restantes. Les fichiers courants sont conservés, mais l'historique supprimé ne pourra pas être restauré depuis Portal.",
            de: "Diese Aktion durchsucht den gesamten Bereich, löscht ältere Dateiversionen und entfernt verbliebene Löschvermerke. Aktuelle Dateien bleiben erhalten, gelöschte Historie kann in Portal aber nicht wiederhergestellt werden.",
            zh: "此操作会扫描整个空间，删除旧文件版本，再移除残留删除记录。当前文件会保留，但删除的历史记录无法从 Portal 恢复。",
          })}
        </PageBanner>

        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" })}
            </dt>
            <dd className={cx("mt-1 break-all font-bold", uiTitleTextClass)}>
              {spaceName}
            </dd>
          </div>
          <div>
            <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
              {t({
                en: "Current storage",
                fr: "Stockage courant",
                de: "Aktueller Speicher",
                zh: "当前存储用量",
              })}
            </dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>
              {formatBytes(usedBytes)}
            </dd>
          </div>
        </dl>

        {progress ? (
          <div className="rounded-md border border-[color:var(--ui-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>
                {progress.message ?? progress.stage}
              </p>
              <p className={cx("ui-caption", uiMutedTextClass)}>
                {formatCompactNumber(deletedEntries)} /{" "}
                {progress.total_candidates_final
                  ? formatCompactNumber(progress.delete_candidates)
                  : progress.delete_candidates > 0
                    ? t({
                        en: `at least ${formatCompactNumber(progress.delete_candidates)}`,
                        fr: `au moins ${formatCompactNumber(progress.delete_candidates)}`,
                        de: `mindestens ${formatCompactNumber(progress.delete_candidates)}`,
                        zh: `至少 ${formatCompactNumber(progress.delete_candidates)}`,
                      })
                    : t({
                        en: "discovering",
                        fr: "détection",
                        de: "wird ermittelt",
                        zh: "正在查找",
                      })}
              </p>
            </div>
            {progressPercent === null ? (
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ui-surface-muted)]"
                role="progressbar"
                aria-label={t({
                  en: "Storage Space history cleanup progress",
                  fr: "Progression du nettoyage de l'historique",
                  de: "Fortschritt der Historienbereinigung",
                  zh: "存储空间历史记录清理进度",
                })}
              >
                <div className="h-full w-full animate-pulse rounded-full bg-rose-500/70" />
              </div>
            ) : (
              <UiProgressBar
                value={progressPercent}
                label={t({
                  en: "Storage Space history cleanup progress",
                  fr: "Progression du nettoyage de l'historique",
                  de: "Fortschritt der Historienbereinigung",
                  zh: "存储空间历史记录清理进度",
                })}
                className="mt-2 h-2 bg-[var(--ui-surface-muted)]"
                barClassName="bg-rose-600 transition-[width] duration-150 ease-out"
              />
            )}
            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
              {t({
                en: `${formatCompactNumber(progress.scanned_versions)} versions scanned, ${formatCompactNumber(progress.scanned_delete_markers)} delete markers scanned, ${formatBytes(progress.bytes_freed)} gained so far.`,
                fr: `${formatCompactNumber(progress.scanned_versions)} versions scannées, ${formatCompactNumber(progress.scanned_delete_markers)} delete markers scannés, ${formatBytes(progress.bytes_freed)} gagnés pour l'instant.`,
                de: `${formatCompactNumber(progress.scanned_versions)} Versionen geprüft, ${formatCompactNumber(progress.scanned_delete_markers)} Delete Marker geprüft, bisher ${formatBytes(progress.bytes_freed)} frei geworden.`,
                zh: `已扫描 ${formatCompactNumber(progress.scanned_versions)} 个版本、${formatCompactNumber(progress.scanned_delete_markers)} 个删除标记，目前已释放 ${formatBytes(progress.bytes_freed)}。`,
              })}
            </p>
          </div>
        ) : null}

        {result ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <PortalWorkflowMetricCard
              label={t({
                en: "Space gained",
                fr: "Espace gagné",
                de: "Frei geworden",
                zh: "已释放空间",
              })}
              value={formatBytes(result.bytes_freed)}
              detail={t({ en: "estimated", fr: "estimé", de: "geschätzt", zh: "估算值" })}
            />
            <PortalWorkflowMetricCard
              label={t({
                en: "Versions deleted",
                fr: "Versions supprimées",
                de: "Versionen gelöscht",
                zh: "已删除版本",
              })}
              value={formatCompactNumber(result.deleted_versions)}
              detail={t({
                en: "historical",
                fr: "historiques",
                de: "historisch",
                zh: "历史版本",
              })}
            />
            <PortalWorkflowMetricCard
              label={t({
                en: "Markers removed",
                fr: "Markers retirés",
                de: "Marker entfernt",
                zh: "已移除标记",
              })}
              value={formatCompactNumber(result.deleted_delete_markers)}
              detail={t({
                en: "orphan delete markers",
                fr: "delete markers orphelins",
                de: "verwaiste Delete Marker",
                zh: "孤立删除标记",
              })}
            />
          </div>
        ) : null}

        <WorkflowActions>
          <UiButton
            variant="secondary"
            onClick={onClose}
            disabled={running}
          >
            {result
              ? t({ en: "Done", fr: "Terminer", de: "Fertig", zh: "完成" })
              : t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
          </UiButton>
          {running ? (
            <UiButton variant="danger" onClick={() => abortRef.current?.abort()}>
              {t({
                en: "Stop cleanup",
                fr: "Arrêter le nettoyage",
                de: "Bereinigung stoppen",
                zh: "停止清理",
              })}
            </UiButton>
          ) : (
            <UiButton
              variant="danger"
              onClick={() => void runCleanup()}
              disabled={Boolean(result) || !enabled}
            >
              {t({
                en: "Start cleanup",
                fr: "Démarrer le nettoyage",
                de: "Bereinigung starten",
                zh: "开始清理",
              })}
            </UiButton>
          )}
        </WorkflowActions>
      </div>
    </WorkflowPage>
  );
}
