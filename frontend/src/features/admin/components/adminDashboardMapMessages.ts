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
