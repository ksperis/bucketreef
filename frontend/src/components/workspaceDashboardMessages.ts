/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { interpolateText, useI18n, type I18nMessage } from "../i18n";

const m = (en: string, fr: string, de: string, zh: string): I18nMessage => ({ en, fr, de, zh });

const workspaceDashboardMessages = {
  up: m("Up", "Opérationnel", "Verfügbar", "正常"),
  degraded: m("Degraded", "Dégradé", "Beeinträchtigt", "降级"),
  down: m("Down", "Indisponible", "Nicht verfügbar", "不可用"),
  unknown: m("Unknown", "Inconnu", "Unbekannt", "未知"),
  quotaUsage: m("Quota usage", "Utilisation du quota", "Quotanutzung", "配额使用量"),
  metricQuotaUsage: m("{label} quota usage", "Utilisation du quota {label}", "Quotanutzung {label}", "{label}配额使用量"),
  noStorageHistory: m("No storage history yet.", "Aucun historique de stockage.", "Noch kein Speicherverlauf vorhanden.", "暂无存储历史记录。"),
  storageEvolutionChart: m("Storage evolution chart", "Graphique d’évolution du stockage", "Diagramm zur Speicherentwicklung", "存储变化图表"),
  trendLine: m("Trend line", "Ligne de tendance", "Trendlinie", "趋势线"),
  administration: m("Administration", "Administration", "Administration", "管理"),
  featureSummary: m("{title} summary", "Résumé : {title}", "Zusammenfassung: {title}", "{title}摘要"),
  enabledCount: m("{count} enabled", "{count} activé(s)", "{count} aktiviert", "已启用 {count} 项"),
  noneEnabled: m("None enabled", "Aucune fonctionnalité activée", "Keine Funktion aktiviert", "尚未启用任何功能"),
  massManagement: m("Mass management", "Gestion de masse", "Massenverwaltung", "批量管理"),
  massManagementAbbreviation: m("MM", "MM", "MM", "MM"),
  endpointHealth: m("Endpoint Health", "Santé de l’endpoint", "Endpunktzustand", "端点健康状态"),
  storedEndpointStatus: m(
    "Stored status from the latest endpoint check.",
    "État enregistré lors du dernier contrôle de l’endpoint.",
    "Gespeicherter Status der letzten Endpunktprüfung.",
    "最近一次端点检查保存的状态。",
  ),
  updatedAt: m("Updated {timestamp}", "Mis à jour le {timestamp}", "Aktualisiert {timestamp}", "更新时间：{timestamp}"),
  noEndpointLinked: m(
    "No endpoint linked to this workspace context.",
    "Aucun endpoint lié à ce contexte d’espace de travail.",
    "Kein Endpunkt mit diesem Arbeitsbereichskontext verknüpft.",
    "此工作区上下文未关联任何端点。",
  ),
  lastCheckAt: m("Last check {timestamp}", "Dernier contrôle {timestamp}", "Letzte Prüfung {timestamp}", "上次检查 {timestamp}"),
  staleSuffix: m(" · Stale", " · Obsolète", " · Veraltet", " · 已过期"),
  moreEndpoints: m("+{count} more endpoint(s).", "+{count} endpoint(s) supplémentaires.", "+{count} weitere Endpunkte.", "+{count} 个其他端点。"),
} satisfies Record<string, I18nMessage>;

type WorkspaceDashboardMessageKey = keyof typeof workspaceDashboardMessages;

export function useWorkspaceDashboardI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: WorkspaceDashboardMessageKey, values?: Record<string, string | number>) =>
      interpolateText(t(workspaceDashboardMessages[key]), values),
    [t],
  );
  return { text };
}
