/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";

import { interpolateText, useI18n, type I18nMessage } from "../i18n";

const m = (en: string, zh: string): I18nMessage => ({ en, zh });

export const metricsMessage = {
  updated: m("Updated:", "更新时间："),
  loadingValue: m("...", "…"),
  emptyMetrics: m("No usable metrics yet.", "暂无可用指标。"),
  emptyPeriod: m("No usable metrics for this period yet.", "此时间段暂无可用指标。"),
  dayLabel: m("24h", "24 小时"),
  dayHelper: m("Last 24 hours", "最近 24 小时"),
  weekLabel: m("7d", "7 天"),
  weekHelper: m("Weekly trend", "一周趋势"),
  monthLabel: m("30d", "30 天"),
  monthHelper: m("Monthly trend", "一个月趋势"),
  selectedRange: m("Selected range", "所选范围"),
  trafficTitle: m("RGW traffic", "RGW 流量"),
  trafficDescription: m(
    "Reading RGW logs ({range}) for the selected window.",
    "读取所选时间窗内的 RGW 日志（{range}）。",
  ),
  trafficWindowAria: m("{title} window", "{title}时间窗"),
  mostActiveBuckets: m("Most active buckets", "最活跃的存储桶"),
  mostActiveAccounts: m("Most active accounts", "最活跃的账户"),
  egress: m("Egress", "出站流量"),
  egressHint: m("Outgoing bytes", "出站字节数"),
  ingress: m("Ingress", "入站流量"),
  ingressHint: m("Incoming bytes", "入站字节数"),
  successRate: m("Success rate", "成功率"),
  requests: m("requests", "次请求"),
  emptyTraffic: m("No traffic data available for this window.", "此时间窗暂无流量数据。"),
  dailyTraffic: m("Daily traffic", "每日流量"),
  hourlyTraffic: m("Hourly traffic", "每小时流量"),
  trafficComparison: m("Ingress vs egress comparison", "入站与出站流量对比"),
  callVolume: m("Call volume", "调用量"),
  opsPerSlot: m("Ops per slot", "每个时间段的操作数"),
  opsTitle: m("Ops", "操作数"),
  ops: m("ops", "次操作"),
  notAvailable: m("n/a", "不适用"),
  success: m("success", "成功"),
  inbound: m("In", "入站"),
  outbound: m("Out", "出站"),
  requestBreakdown: m("Request breakdown", "请求分类"),
};

export type MetricsMessageKey = keyof typeof metricsMessage;

export function useMetricsI18n() {
  const { locale, t } = useI18n();
  const text = useCallback(
    (key: MetricsMessageKey, values?: Record<string, string | number>) =>
      interpolateText(t(metricsMessage[key]), values),
    [t],
  );

  return { locale, text };
}
