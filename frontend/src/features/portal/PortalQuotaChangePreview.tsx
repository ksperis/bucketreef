/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalQuotaDirection } from "../../api/portalRequests";
import {
  cx,
  uiLabelClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../utils/format";

type PortalQuotaChangePreviewProps = {
  usedBytes: number | null;
  currentQuotaBytes: number | null;
  targetQuotaBytes: number | null;
  loading: boolean;
  belowUsed: boolean;
  directionMismatch: boolean;
  direction: PortalQuotaDirection;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export default function PortalQuotaChangePreview({
  usedBytes,
  currentQuotaBytes,
  targetQuotaBytes,
  loading,
  belowUsed,
  directionMismatch,
  direction,
}: PortalQuotaChangePreviewProps) {
  const { t } = useI18n();
  const maxBytes = Math.max(
    usedBytes ?? 0,
    currentQuotaBytes ?? 0,
    targetQuotaBytes ?? 0,
    1,
  );
  const usedPct = clampPercent(((usedBytes ?? 0) / maxBytes) * 100);
  const currentPct =
    currentQuotaBytes == null
      ? null
      : clampPercent((currentQuotaBytes / maxBytes) * 100);
  const targetPct =
    targetQuotaBytes == null
      ? null
      : clampPercent((targetQuotaBytes / maxBytes) * 100);
  const targetTone =
    belowUsed || directionMismatch
      ? "bg-[var(--ui-danger)]"
      : "bg-[var(--ui-primary)]";
  const usedTone = belowUsed
    ? "bg-[var(--ui-danger)]"
    : "bg-[var(--ui-success)]";

  return (
    <div className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>
          {t({
            en: "Storage limit preview",
            fr: "Prévisualisation de la limite",
            de: "Vorschau der Speichergrenze",
            zh: "存储上限预览",
          })}
        </p>
        {loading ? (
          <p className={cx("ui-caption", uiMutedTextClass)}>
            {t({
              en: "Loading usage...",
              fr: "Chargement de l'usage...",
              de: "Nutzung wird geladen...",
              zh: "正在加载用量…",
            })}
          </p>
        ) : null}
      </div>
      <div
        className="relative mt-3 h-5 overflow-hidden rounded-full bg-[var(--ui-surface)] ring-1 ring-[var(--ui-border)]"
        aria-label={t({
          en: "Storage limit bar",
          fr: "Barre de limite",
          de: "Balken der Speichergrenze",
          zh: "存储上限进度条",
        })}
      >
        <div
          className={cx("h-full rounded-full transition-all", usedTone)}
          style={{ width: `${usedPct}%` }}
        />
        {currentPct != null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-[var(--ui-text)]/70"
            style={{ left: `${currentPct}%` }}
          />
        ) : null}
        {targetPct != null ? (
          <div
            className={cx("absolute inset-y-0 w-1 rounded-full", targetTone)}
            style={{ left: `${targetPct}%` }}
          />
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <QuotaLegendItem
          label={t({
            en: "Used now",
            fr: "Utilisé actuellement",
            de: "Aktuell genutzt",
            zh: "当前已用",
          })}
          value={
            usedBytes == null
              ? t({
                  en: "Unavailable",
                  fr: "Indisponible",
                  de: "Nicht verfügbar",
                  zh: "不可用",
                })
              : formatBytes(usedBytes)
          }
          swatchClassName={usedTone}
        />
        <QuotaLegendItem
          label={t({
            en: "Current limit",
            fr: "Limite actuelle",
            de: "Aktuelle Grenze",
            zh: "当前上限",
          })}
          value={
            currentQuotaBytes == null
              ? t({
                  en: "No limit",
                  fr: "Aucune limite",
                  de: "Keine Grenze",
                  zh: "无限制",
                })
              : formatBytes(currentQuotaBytes)
          }
          swatchClassName="bg-[var(--ui-text)]/70"
        />
        <QuotaLegendItem
          label={
            direction === "increase"
              ? t({
                  en: "Requested raise",
                  fr: "Augmentation demandée",
                  de: "Angeforderte Erhöhung",
                  zh: "申请提高至",
                })
              : t({
                  en: "Requested reduction",
                  fr: "Réduction demandée",
                  de: "Angeforderte Senkung",
                  zh: "申请降低至",
                })
          }
          value={
            targetQuotaBytes == null
              ? t({
                  en: "Enter a limit",
                  fr: "Saisir une limite",
                  de: "Grenze eingeben",
                  zh: "输入上限",
                })
              : formatBytes(targetQuotaBytes)
          }
          swatchClassName={targetTone}
        />
      </div>
    </div>
  );
}

function QuotaLegendItem({
  label,
  value,
  swatchClassName,
}: {
  label: string;
  value: string;
  swatchClassName: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span
          className={cx("h-2.5 w-2.5 rounded-full", swatchClassName)}
          aria-hidden="true"
        />
        <span className={uiLabelClass}>{label}</span>
      </div>
      <p className={cx("mt-1 truncate ui-body", uiTitleTextClass)}>{value}</p>
    </div>
  );
}
