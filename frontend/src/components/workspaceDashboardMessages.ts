/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n, type I18nMessage } from "../i18n";

const m = (en: string, zh: string) => ({ en, zh });

const workspaceDashboardMessages = {
  up: m("Up", "正常"),
  degraded: m("Degraded", "降级"),
  down: m("Down", "不可用"),
  unknown: m("Unknown", "未知"),
  quotaUsage: m("Quota usage", "配额使用量"),
  metricQuotaUsage: m("{label} quota usage", "{label}配额使用量"),
  noStorageHistory: m("No storage history yet.", "暂无存储历史记录。"),
  storageEvolutionChart: m("Storage evolution chart", "存储变化图表"),
  trendLine: m("Trend line", "趋势线"),
  administration: m("Administration", "管理"),
  featureSummary: m("{title} summary", "{title}摘要"),
  enabledCount: m("{count} enabled", "已启用 {count} 项"),
  noneEnabled: m("None enabled", "尚未启用任何功能"),
  massManagement: m("Mass management", "批量管理"),
  massManagementAbbreviation: m("MM", "MM"),
} satisfies Record<string, I18nMessage>;

type WorkspaceDashboardMessageKey = keyof typeof workspaceDashboardMessages;

export function useWorkspaceDashboardI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: WorkspaceDashboardMessageKey, values?: Record<string, string | number>) =>
      t(workspaceDashboardMessages[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { text };
}
