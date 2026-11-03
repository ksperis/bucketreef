/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatPercentage } from "../utils/format";
import { clampPercentage, clampedPercentageOf } from "../utils/numbers";
import { useI18n } from "../i18n";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "./ui/styles";

export type UsageTileQuotaLine = {
  label: string;
  value: number;
};

type UsageTileProps = {
  label: string;
  used?: number | null;
  quota?: number | null;
  quotaLines?: UsageTileQuotaLine[];
  formatter: (value?: number | null) => string;
  quotaFormatter?: (value?: number | null) => string;
  loading?: boolean;
  unitHint?: string;
  emptyHint?: string;
  usageRatio?: number | null;
  limitWarning?: string;
  onClick?: () => void;
  actionLabel?: string;
};

export default function UsageTile({
  label,
  used,
  quota,
  quotaLines,
  formatter,
  quotaFormatter,
  loading,
  unitHint,
  emptyHint,
  usageRatio,
  limitWarning,
  onClick,
  actionLabel,
}: UsageTileProps) {
  const { t } = useI18n();
  const hasUsage = typeof used === "number" && !Number.isNaN(used);
  const ratio = usageRatio !== undefined
    ? usageRatio
    : hasUsage
      ? clampedPercentageOf(used, quota)
      : null;
  const usedDisplay = hasUsage ? formatter(used) : loading ? t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen...", zh: "正在加载..." }) : "—";
  const fallbackQuota = typeof quota === "number" && Number.isFinite(quota) && quota > 0
    ? [{ label: t({ en: "Quota", fr: "Quota", de: "Kontingent", zh: "配额" }), value: quota }]
    : [];
  const configuredQuotas = quotaLines ?? fallbackQuota;

  const cardClassName = cx(
    uiCardMutedClass,
    "p-3",
    onClick && "w-full cursor-pointer text-left transition-colors hover:border-[color:var(--ui-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ui-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--ui-surface)]",
  );
  const content = (
    <>
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          {ratio === null ? (
            <div className={cx("flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-[color:var(--ui-border)] ui-caption font-semibold", uiMutedTextClass)}>
              {t({ en: "N/A", fr: "N/D", de: "k. A.", zh: "不适用" })}
            </div>
          ) : (
            <UsageGauge ratio={ratio} />
          )}
        </div>
        <div className="flex-1 space-y-1">
          <p className={cx("ui-caption font-semibold", uiMutedTextClass)}>{label}</p>
          <p className={cx("ui-title", uiTitleTextClass)}>
            {usedDisplay}
            {unitHint && hasUsage && <span className={cx("ui-caption font-normal", uiMutedTextClass)}> {unitHint}</span>}
          </p>
          {configuredQuotas.length > 0 ? (
            <dl className="space-y-0.5 pt-0.5">
              {configuredQuotas.map((configuredQuota) => (
                <div key={configuredQuota.label} className="flex items-baseline justify-between gap-3 ui-caption">
                  <dt className={uiMutedTextClass}>{configuredQuota.label}</dt>
                  <dd className={cx("font-medium", uiTitleTextClass)}>
                    {quotaFormatter ? quotaFormatter(configuredQuota.value) : formatter(configuredQuota.value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={cx("ui-caption", uiMutedTextClass)}>{emptyHint ?? t({ en: "No quota defined.", fr: "Aucun quota défini.", de: "Kein Kontingent definiert.", zh: "未定义配额。" })}</p>
          )}
          {limitWarning && <p className={cx("ui-caption", uiMutedTextClass)}>{limitWarning}</p>}
        </div>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={cardClassName} onClick={onClick} aria-label={actionLabel ?? label}>
        {content}
      </button>
    );
  }

  return <div className={cardClassName}>{content}</div>;
}

function UsageGauge({ ratio }: { ratio: number }) {
  const { t } = useI18n();
  const clamped = clampPercentage(ratio);
  const angle = (clamped / 100) * 360;
  const color = getAccentColor(clamped);
  const track = "rgba(148, 163, 184, 0.25)";

  return (
    <div
      className="relative h-16 w-16 rounded-full"
      role="img"
      aria-label={t({ en: `Usage at ${formatPercentage(clamped)}`, fr: `Utilisation à ${formatPercentage(clamped)}`, de: `Auslastung bei ${formatPercentage(clamped)}`, zh: `使用率为 ${formatPercentage(clamped)}` })}
      style={{
        background: `conic-gradient(${color} ${angle}deg, ${track} ${angle}deg 360deg)`,
      }}
    >
      <div className={cx("absolute inset-1.5 flex items-center justify-center rounded-full bg-[var(--ui-surface)] ui-caption", uiTitleTextClass)}>
        {formatPercentage(clamped)}
      </div>
    </div>
  );
}

function getAccentColor(ratio: number) {
  if (ratio >= 90) return "#f43f5e";
  if (ratio >= 75) return "#f97316";
  return "#0569f8";
}
