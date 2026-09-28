/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../utils/format";
import ObjectPreview, { OBJECT_PREVIEW_MAX_BYTES, OBJECT_PREVIEW_TEXT_MAX_BYTES, objectPreviewKind } from "./ObjectPreview";
import { objectVersionDiff } from "./objectVersionDiff";

export type InspectableObjectVersion = { version_id?: string | null; size?: number | null; last_modified?: string | null; is_delete_marker?: boolean };
type Props = { name: string; versions: InspectableObjectVersion[]; loadVersion: (versionId: string, signal: AbortSignal) => Promise<Blob> };

function VersionContent({ name, selected, loadVersion }: { name: string; selected: InspectableObjectVersion[]; loadVersion: Props["loadVersion"] }) {
  const { t } = useI18n();
  const [blobs, setBlobs] = useState<Blob[] | null>(null);
  const [texts, setTexts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const comparing = selected.length === 2;
  useEffect(() => {
    const controller = new AbortController();
    setBlobs(null); setTexts(null); setError(null);
    void Promise.all(selected.map(version => loadVersion(version.version_id!, controller.signal))).then(async loaded => {
      const limit = comparing ? OBJECT_PREVIEW_TEXT_MAX_BYTES : OBJECT_PREVIEW_MAX_BYTES;
      if (loaded.some(blob => blob.size > limit)) throw new Error(t({ en: "Content exceeds the preview or comparison limit.", fr: "Le contenu dépasse la limite d’aperçu ou de comparaison.", de: "Der Inhalt überschreitet das Vorschau- oder Vergleichslimit.", zh: "内容超出预览或比较限制。" }));
      if (comparing && loaded.some(blob => objectPreviewKind(name, blob.type) !== "text")) throw new Error(t({ en: "Comparison supports text and JSON only.", fr: "La comparaison concerne uniquement le texte et le JSON.", de: "Vergleiche unterstützen nur Text und JSON.", zh: "仅支持文本和 JSON 比较。" }));
      const decoded = comparing ? await Promise.all(loaded.map(blob => blob.text())) : null;
      if (controller.signal.aborted) return;
      setBlobs(loaded); setTexts(decoded);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [comparing, loadVersion, name, selected, t]);
  const loadPreview = useCallback(async () => blobs![0], [blobs]);
  const diff = useMemo(() => texts ? objectVersionDiff(texts[0], texts[1]) : [], [texts]);
  const blocks = useMemo(() => {
    const grouped: { kind: "equal" | "added" | "removed"; lines: string[] }[] = [];
    for (const line of diff) {
      if (grouped.at(-1)?.kind !== line.kind) grouped.push({ kind: line.kind, lines: [] });
      grouped.at(-1)!.lines.push(`${line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}${line.text}`);
    }
    return grouped;
  }, [diff]);
  if (error) return <p role="alert">{error}</p>;
  if (!blobs) return <p role="status">{t({ en: "Loading versions…", fr: "Chargement des versions…", de: "Versionen werden geladen…", zh: "正在加载版本…" })}</p>;
  if (!comparing) return <ObjectPreview name={name} sizeBytes={blobs[0].size} contentType={blobs[0].type} loadBlob={loadPreview} />;
  return <div className="space-y-2">
    <p className="ui-caption">+{diff.filter(line => line.kind === "added").length} / −{diff.filter(line => line.kind === "removed").length} {t({ en: "lines; − first version, + second version", fr: "lignes ; − première version, + seconde version", de: "Zeilen; − erste Version, + zweite Version", zh: "行；− 第一个版本，+ 第二个版本" })}</p>
    <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words border border-[var(--ui-border)] p-3 ui-caption">
      {blocks.map((block, index) => <span key={index} className={`block ${block.kind === "added" ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100" : block.kind === "removed" ? "bg-rose-100 text-rose-950 dark:bg-rose-950 dark:text-rose-100" : ""}`}>{block.lines.join("")}</span>)}
    </pre>
  </div>;
}

export default function ObjectVersionInspector({ name, versions, loadVersion }: Props) {
  const { t, locale } = useI18n();
  const candidates = versions.filter(version => version.version_id && !version.is_delete_marker);
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");
  const [selected, setSelected] = useState<InspectableObjectVersion[] | null>(null);
  const first = candidates.find(version => version.version_id === firstId) ?? candidates[0];
  const second = candidates.find(version => version.version_id === secondId) ?? candidates[1];
  const sizeAllowed = (version: InspectableObjectVersion | undefined, max: number) => typeof version?.size === "number" && Number.isFinite(version.size) && version.size >= 0 && version.size <= max;
  const previewAllowed = sizeAllowed(first, OBJECT_PREVIEW_MAX_BYTES);
  const compareAllowed = first?.version_id !== second?.version_id && sizeAllowed(first, OBJECT_PREVIEW_TEXT_MAX_BYTES) && sizeAllowed(second, OBJECT_PREVIEW_TEXT_MAX_BYTES);
  const label = (version: InspectableObjectVersion) => `${version.last_modified ? new Date(version.last_modified).toLocaleString(locale) : "—"} · ${formatBytes(version.size ?? 0)} · ${version.version_id}`;
  if (!candidates.length) return null;
  return <div className="space-y-2 rounded-md border border-[var(--ui-border)] p-3">
    <p className="ui-caption">{t({ en: "Read-only preview: 50 MiB. Text/JSON comparison: 64 KiB per version. Delete markers are excluded.", fr: "Aperçu en lecture seule : 50 Mio. Comparaison texte/JSON : 64 Kio par version. Les marqueurs de suppression sont exclus.", de: "Schreibgeschützte Vorschau: 50 MiB. Text-/JSON-Vergleich: 64 KiB je Version. Löschmarker sind ausgeschlossen.", zh: "只读预览：50 MiB。文本/JSON 比较：每个版本 64 KiB。不包括删除标记。" })}</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 ui-caption">{t({ en: "First version", fr: "Première version", de: "Erste Version", zh: "第一个版本" })}<select className="ui-select w-full" value={first?.version_id ?? ""} onChange={event => setFirstId(event.target.value)}>{candidates.map(version => <option key={version.version_id} value={version.version_id!}>{label(version)}</option>)}</select></label>
      <UiButton size="sm" variant="secondary" disabled={!previewAllowed} onClick={() => setSelected([first])}>{t({ en: "Preview version", fr: "Aperçu de la version", de: "Version ansehen", zh: "预览版本" })}</UiButton>
    </div>
    {candidates.length > 1 ? <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 ui-caption">{t({ en: "Second version", fr: "Seconde version", de: "Zweite Version", zh: "第二个版本" })}<select className="ui-select w-full" value={second?.version_id ?? ""} onChange={event => setSecondId(event.target.value)}>{candidates.map(version => <option key={version.version_id} value={version.version_id!}>{label(version)}</option>)}</select></label>
      <UiButton size="sm" variant="secondary" disabled={!compareAllowed} onClick={() => setSelected([first, second])}>{t({ en: "Compare versions", fr: "Comparer les versions", de: "Versionen vergleichen", zh: "比较版本" })}</UiButton>
    </div> : null}
    {selected ? <Modal title={t({ en: "Read-only version inspection", fr: "Consultation des versions en lecture seule", de: "Schreibgeschützte Versionsansicht", zh: "只读版本查看" })} maxWidthClass="max-w-5xl" onClose={() => setSelected(null)}>
      <p className="mb-3 break-all ui-caption">{name}</p>
      <ol className="mb-3 space-y-1 break-all ui-caption">{selected.map(version => <li key={version.version_id}>{label(version)}</li>)}</ol>
      <VersionContent name={name} selected={selected} loadVersion={loadVersion} />
    </Modal> : null}
  </div>;
}
