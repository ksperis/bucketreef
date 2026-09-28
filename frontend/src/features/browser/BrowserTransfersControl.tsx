import { DownloadIcon } from "./browserIcons";
/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import type { BrowserWorkspaceSurface } from "../../api/browserWorkspace";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../utils/format";
import { listLocalUploads, listTransferHistory, removeLocalUpload, withLocalUploadLock, type LocalUpload, type LocalTransferBatch } from "./browserTransferStore";
import type { OperationItem } from "./browserTypes";
import { operationCompletionLabel } from "./browserOperationStatus";

type Props = {
  owner: string; workspace: BrowserWorkspaceSurface; accountId: string; currentBucket: string; canWrite: boolean; lockedBucket?: string;
  hasSseKey: boolean; operations: OperationItem[];
  onResume: (upload: LocalUpload, file: File) => Promise<void>;
  onAbort: (upload: LocalUpload) => Promise<void>;
  onCancel: (id: string) => void;
  onOpenDestination: (target: NonNullable<OperationItem["destination"]>) => void;
};

export default function BrowserTransfersControl({ owner, workspace, accountId, currentBucket, canWrite, lockedBucket, hasSseKey, operations, onResume, onAbort, onCancel, onOpenDestination }: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [uploads, setUploads] = useState<LocalUpload[]>([]);
  const [history, setHistory] = useState<LocalTransferBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [forget, setForget] = useState<LocalUpload | null>(null);
  const refresh = useCallback(async () => {
    if (!owner) return;
    try {
      const [pending, completed] = await Promise.all([listLocalUploads(owner, workspace), listTransferHistory(owner, workspace)]);
      setUploads(pending); setHistory(completed);
    } catch { setError(t({ en: "Local storage is unavailable. Recovery and history cannot be loaded.", fr: "Le stockage local est indisponible. Impossible de charger les reprises et le bilan.", de: "Lokaler Speicher ist nicht verfügbar. Wiederaufnahme und Verlauf können nicht geladen werden.", zh: "本地存储不可用，无法加载恢复信息和历史记录。" })); }
  }, [owner, workspace, t]);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const reload = () => void refresh();
    window.addEventListener("browser-transfers-changed", reload); window.addEventListener("focus", reload);
    return () => { window.removeEventListener("browser-transfers-changed", reload); window.removeEventListener("focus", reload); };
  }, [open, refresh]);
  const available = (target: { accountId: string; bucket: string }) => target.accountId === accountId && (!lockedBucket || target.bucket === lockedBucket);
  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id); setError(null);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); await refresh(); }
  };
  const destinationButton = (target: NonNullable<OperationItem["destination"]>) => <UiButton size="sm" variant="secondary" disabled={!available(target)} onClick={() => { onOpenDestination(target); setOpen(false); }}>{t({ en: "Open destination", fr: "Ouvrir la destination", de: "Ziel öffnen", zh: "打开目标位置" })}</UiButton>;
  return <>
    <UiButton size="sm" variant="secondary" aria-label={t({ en: "Transfers and recovery", fr: "Transferts et reprise", de: "Transfers und Wiederaufnahme", zh: "传输和恢复" })} title={t({ en: "Transfers and recovery", fr: "Transferts et reprise", de: "Transfers und Wiederaufnahme", zh: "传输和恢复" })} onClick={() => setOpen(true)}><DownloadIcon className="h-4 w-4" /></UiButton>
    {open ? <Modal title={t({ en: "Transfers and local recovery", fr: "Transferts et reprise locale", de: "Transfers und lokale Wiederaufnahme", zh: "传输和本地恢复" })} maxWidthClass="max-w-4xl" onClose={() => setOpen(false)}>
      <div className="space-y-4">
        <p className="ui-body">{t({ en: "Closing the browser stops transfers. Resume explicitly after signing in and selecting the original file. Files, credentials and encryption keys are never stored here. Clearing browser storage loses recovery information.", fr: "Fermer le navigateur interrompt les transferts. Pour reprendre, reconnectez-vous et sélectionnez le fichier original. Aucun fichier, identifiant S3 ou clé de chiffrement n’est stocké ici. Effacer le stockage du navigateur supprime le suivi.", de: "Das Schließen des Browsers stoppt Transfers. Melden Sie sich an und wählen Sie die Originaldatei zur Wiederaufnahme. Dateien, Zugangsdaten und Schlüssel werden hier nicht gespeichert. Beim Löschen des Browserspeichers gehen Wiederaufnahmedaten verloren.", zh: "关闭浏览器会停止传输。登录后选择原始文件以手动恢复。此处不保存文件、凭据或加密密钥。清除浏览器存储会丢失恢复信息。" })}</p>
        {!owner ? <p>{t({ en: "The current session cannot identify saved transfers. Sign in again to enable local recovery.", fr: "La session actuelle ne permet pas d’identifier les transferts enregistrés. Reconnectez-vous pour activer la reprise locale.", de: "Die aktuelle Sitzung kann gespeicherte Transfers nicht zuordnen. Melden Sie sich für die lokale Wiederaufnahme erneut an.", zh: "当前会话无法识别已保存的传输。请重新登录以启用本地恢复。" })}</p> : null}
        {error ? <p role="alert" className="text-rose-700 dark:text-rose-300">{error}</p> : null}
        {operations.length ? <section className="space-y-2"><h4 className="ui-subtitle">{t({ en: "This session", fr: "Cette session", de: "Diese Sitzung", zh: "本次会话" })}</h4>{operations.filter(op => op.kind !== "activity").map(op => <div key={op.id} className="rounded border border-[var(--ui-border)] p-2">
          <p className="break-all ui-caption">{op.label} · {op.path} · {op.completedAt ? operationCompletionLabel(op.completionStatus) : `${op.progress}%`}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {!op.completedAt && op.pause ? <UiButton size="sm" variant="secondary" onClick={op.pause}>{t({ en: "Pause", fr: "Pause", de: "Pausieren", zh: "暂停" })}</UiButton> : null}
            {!op.completedAt && op.cancelable ? <UiButton size="sm" variant="danger" onClick={() => onCancel(op.id)}>{t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}</UiButton> : null}
            {op.completedAt && op.retry ? <UiButton size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void run(op.id, op.retry!)}>{op.completionStatus === "paused" ? t({ en: "Resume", fr: "Reprendre", de: "Fortsetzen", zh: "恢复" }) : t({ en: "Retry failures", fr: "Relancer les échecs", de: "Fehler erneut versuchen", zh: "重试失败项" })}</UiButton> : null}
            {op.destination ? destinationButton(op.destination) : null}
          </div>
        </div>)}</section> : null}
        <section className="space-y-2"><h4 className="ui-subtitle">{t({ en: "Pending multipart uploads", fr: "Uploads multipart en attente", de: "Ausstehende Multipart-Uploads", zh: "待处理的分段上传" })}</h4>
          {!uploads.length ? <p className="ui-caption">{t({ en: "No saved upload.", fr: "Aucun upload enregistré.", de: "Kein gespeicherter Upload.", zh: "没有已保存的上传。" })}</p> : null}
          {uploads.map(upload => {
            const inContext = available(upload) && upload.bucket === currentBucket;
            const active = operations.some(op => !op.completedAt && op.recoveryId === upload.id);
            const enabled = canWrite && inContext && !active && !busy && upload.state !== "unavailable" && (!upload.requiresSse || hasSseKey);
            return <div key={upload.id} className="space-y-2 rounded border border-[var(--ui-border)] p-3">
              <p className="break-all ui-body">{upload.bucket}/{upload.key} · {formatBytes(upload.size)}</p>
              <p className="ui-caption">{upload.parts.length} {t({ en: "saved part receipts", fr: "reçus de parties sauvegardés", de: "gespeicherte Teilbelege", zh: "个已保存的分段凭据" })} · {new Date(upload.updatedAt).toLocaleString(locale)}</p>
              {!inContext ? <p className="ui-caption">{t({ en: "Select the original context and Storage Space to resume.", fr: "Sélectionnez le contexte et l’espace d’origine pour reprendre.", de: "Wählen Sie den ursprünglichen Kontext und Speicherbereich.", zh: "请选择原始上下文和存储空间以恢复。" })} ({upload.accountId})</p> : null}
              {upload.requiresSse && !hasSseKey ? <p className="ui-caption">{t({ en: "Provide the original SSE-C key in Browser encryption settings.", fr: "Renseignez la clé SSE-C d’origine dans les réglages de chiffrement du Browser.", de: "Geben Sie den ursprünglichen SSE-C-Schlüssel in den Verschlüsselungseinstellungen ein.", zh: "请在加密设置中输入原始 SSE-C 密钥。" })}</p> : null}
              {upload.state === "unavailable" ? <p role="status">{t({ en: "Remote upload no longer exists; it cannot be resumed.", fr: "L’upload distant n’existe plus ; la reprise est impossible.", de: "Der entfernte Upload existiert nicht mehr und kann nicht fortgesetzt werden.", zh: "远程上传已不存在，无法恢复。" })}</p> : null}
              <label className="block ui-caption">{t({ en: "Reselect file to resume", fr: "Resélectionner le fichier pour reprendre", de: "Datei zur Wiederaufnahme auswählen", zh: "重新选择文件以恢复" })}<input type="file" className="mt-1 block w-full" disabled={!enabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(upload.id, () => onResume(upload, file)); }} /></label>
              <div className="flex flex-wrap gap-2">{destinationButton({ accountId: upload.accountId, bucket: upload.bucket, prefix: upload.key.slice(0, upload.key.lastIndexOf("/") + 1) })}
                <UiButton size="sm" variant="danger" disabled={!canWrite || !inContext || active || Boolean(busy)} onClick={() => void run(upload.id, () => onAbort(upload))}>{t({ en: "Cancel remote upload", fr: "Annuler l’upload distant", de: "Entfernten Upload abbrechen", zh: "取消远程上传" })}</UiButton>
                <UiButton size="sm" variant="secondary" disabled={active || Boolean(busy)} onClick={() => setForget(upload)}>{t({ en: "Forget local entry", fr: "Supprimer le suivi local", de: "Lokalen Eintrag entfernen", zh: "删除本地记录" })}</UiButton>
              </div>
            </div>;
          })}
        </section>
        <section className="space-y-2"><h4 className="ui-subtitle">{t({ en: "Local history · last 20 completed batches · 30 days", fr: "Bilan local · 20 derniers lots terminés · 30 jours", de: "Lokaler Verlauf · letzte 20 abgeschlossene Stapel · 30 Tage", zh: "本地历史 · 最近 20 个已完成批次 · 30 天" })}</h4>
          {history.map(batch => <div key={batch.id} className="rounded border border-[var(--ui-border)] p-2"><p className="break-all ui-caption">{batch.label} · {new Date(batch.completedAt).toLocaleString(locale)}</p><p className="ui-caption">✓ {batch.succeeded} · ✗ {batch.failed} · {t({ en: "cancelled", fr: "annulés", de: "abgebrochen", zh: "已取消" })} {batch.cancelled}</p>{destinationButton(batch)}</div>)}
        </section>
      </div>
    </Modal> : null}
    {forget ? <Modal title={t({ en: "Forget local recovery", fr: "Supprimer le suivi local", de: "Lokale Wiederaufnahme entfernen", zh: "删除本地恢复信息" })} onClose={() => setForget(null)}>
      <p className="mb-3 ui-body">{t({ en: "This removes local recovery information only. Remote parts remain on S3 until cancelled or removed by a lifecycle rule.", fr: "Cette action supprime uniquement le suivi local. Les parties restent sur S3 jusqu’à leur abandon ou leur suppression par une règle de cycle de vie.", de: "Nur lokale Wiederaufnahmedaten werden entfernt. Teile bleiben bis zum Abbruch oder zur Lebenszyklusbereinigung auf S3.", zh: "仅删除本地恢复信息。远程分段会保留，直到取消或由生命周期规则清理。" })}</p>
      <UiButton variant="danger" onClick={() => { const target = forget; setForget(null); void run(target.id, () => withLocalUploadLock(target.id, () => removeLocalUpload(target.id))); }}>{t({ en: "Forget", fr: "Supprimer le suivi", de: "Entfernen", zh: "删除记录" })}</UiButton>
    </Modal> : null}
  </>;
}
