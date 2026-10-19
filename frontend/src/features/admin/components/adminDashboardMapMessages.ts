/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { interpolateText, useI18n, type I18nMessage } from "../../../i18n";
import { adminMessage } from "../adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

const adminDashboardMapMessages = {
  loadingMap: m("Loading map...", "正在加载地图…"),
  endpointMap: m("Infrastructure endpoint map", "基础设施端点地图"),
  noCoordinates: m("No GPS coordinates available for endpoints.", "没有可用的端点 GPS 坐标。"),
  infrastructureMap: m("Infrastructure map", "基础设施地图"),
  geolocatedEndpoints: m("{count} geolocated endpoint(s)", "{count} 个已定位端点"),
  endpoint: m("Endpoint", "端点"),
  provider: m("Provider", "提供方"),
  providerCeph: m("Ceph", "Ceph"),
  providerAws: m("AWS", "AWS"),
  providerOther: m("Other", "其他"),
  status: m("Status", "状态"),
  up: m("Up", "正常"),
  degraded: m("Degraded", "降级"),
  down: m("Down", "不可用"),
  unknown: m("Unknown", "未知"),
  latency: m("Latency", "延迟"),
  default: m("Default", "默认"),
} satisfies Record<string, I18nMessage>;

type AdminDashboardMapMessageKey = keyof typeof adminDashboardMapMessages;

export function useAdminDashboardMapI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: AdminDashboardMapMessageKey, values?: Record<string, string | number>) =>
      interpolateText(t(adminDashboardMapMessages[key]), values),
    [t],
  );
  return { text };
}
