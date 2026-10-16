/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { interpolateText, useI18n, type I18nMessage } from "../../i18n";
import { adminMessage } from "./adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

const adminMetricsMessage = {
  admin: m("Admin", "管理"),
  title: m("Usage & Metrics", "用量与指标"),
  description: m("Managed account usage composition, platform storage, and traffic analytics.", "查看托管账户用量构成、平台存储及流量分析。"),
  noEndpointError: m("No Ceph endpoint available for metrics.", "没有可用于指标统计的 Ceph 端点。"),
  loadEndpointsError: m("Unable to retrieve the endpoint list.", "无法获取端点列表。"),
  loadStorageError: m("Unable to load admin storage metrics.", "无法加载管理存储指标。"),
  loadTrafficError: m("Unable to retrieve RGW logs.", "无法获取 RGW 日志。"),
  loadHistoryError: m("Unable to load usage history trends.", "无法加载用量历史趋势。"),
  loadCompositionError: m("Unable to load managed accounts usage composition.", "无法加载托管账户用量构成。"),
  recalculateCompositionError: m("Unable to recalculate managed accounts usage composition.", "无法重新计算托管账户用量构成。"),
  userFallback: m("User #{id}", "用户 #{id}"),
  storage: m("Storage", "存储"),
  usageComposition: m("Usage composition", "用量构成"),
  usageHistory: m("Usage history", "用量历史"),
  traffic: m("Traffic", "流量"),
  managedAccountsComposition: m("Managed accounts usage composition", "托管账户用量构成"),
  managedAccountsDescription: m("Latest calculated bucket snapshots for S3 accounts managed by the application on the selected endpoint.", "所选端点中由应用管理的 S3 账户的最新存储桶计算快照。"),
  recalculateEndpoint: m("Recalculate endpoint", "重新计算端点"),
  endpoint: m("Ceph endpoint", "Ceph 端点"),
  loading: m("Loading...", "正在加载…"),
  noEndpoint: m("No Ceph endpoint", "没有 Ceph 端点"),
  defaultEndpoint: m("{name} (default)", "{name}（默认）"),
  noEndpointTitle: m("No Ceph endpoint available for metrics", "没有可用于指标统计的 Ceph 端点"),
  noEndpointDescription: m("Add or enable a Ceph endpoint before loading platform metrics.", "请先添加或启用 Ceph 端点，再加载平台指标。"),
  openEndpoints: m("Open endpoints", "打开端点设置"),
  sections: m("Admin metrics sections", "管理指标分区"),
  storageSnapshot: m("Storage snapshot", "存储快照"),
  storageSnapshotDescription: m("Aggregated stats across known S3 accounts.", "汇总已知 S3 账户的统计数据。"),
  storedVolume: m("Stored volume", "存储用量"),
  knownBuckets: m("Sum of known buckets", "已知存储桶用量总和"),
  objects: m("Objects", "对象数量"),
  instantCount: m("Instant count", "当前数量"),
  visibleBuckets: m("Visible buckets", "可见存储桶"),
  rootCredentials: m("Based on root credentials", "基于根凭据统计"),
  s3Accounts: m("S3 accounts", "S3 账户"),
  s3UsersCount: m("{count} S3 users", "{count} 个 S3 用户"),
  storageBreakdown: m("Storage breakdown", "存储分布"),
  storageBreakdownDescription: m("Accounts and S3 users by volume and object count.", "按存储用量和对象数量查看账户及 S3 用户分布。"),
  accountsVolume: m("Accounts (volume)", "账户（存储用量）"),
  accountsObjects: m("Accounts (objects)", "账户（对象数量）"),
  usersVolume: m("S3 users (volume)", "S3 用户（存储用量）"),
  usersObjects: m("S3 users (objects)", "S3 用户（对象数量）"),
  noVolume: m("No volume data available.", "没有可用的存储用量数据。"),
  noObjects: m("No object data available.", "没有可用的对象数量数据。"),
  noUserMetrics: m("No S3 users with metrics.", "没有可用的 S3 用户指标。"),
  objectUnit: m("objects", "个对象"),
  others: m("Others", "其他"),
  total: m("Total", "总计"),
  historyDescription: m("Stored quota snapshots across accounts and S3 users for the selected endpoint.", "所选端点中账户及 S3 用户的已保存配额快照。"),
  hourlySnapshots: m("Hourly snapshots", "每小时快照"),
  dailySnapshots: m("Daily snapshots", "每日快照"),
  storedSnapshots: m("Stored snapshots", "已保存快照"),
  historySubtitle: m("{helper} from collected quota usage history.", "用量历史采集得到的{helper}。"),
  historyUnavailableDescription: m("Stored quota snapshots over time.", "随时间保存的配额快照。"),
  historyUnavailable: m("Usage history trends are unavailable for this context.", "此上下文无法使用用量历史趋势。"),
  historyWindow: m("{title} window", "{title}时间范围"),
  latestStorage: m("Latest storage", "最新存储用量"),
  subjectsCount: m("{count} subjects", "{count} 个对象"),
  latestObjects: m("Latest objects", "最新对象数量"),
  bucketsCount: m("{count} buckets", "{count} 个存储桶"),
  maxQuotaRatio: m("Max quota ratio", "最高配额使用率"),
  highestPoint: m("Highest point", "最高点"),
  snapshots: m("Snapshots", "快照"),
  periodsCount: m("{count} periods", "{count} 个时段"),
  storageEvolution: m("Storage evolution", "存储变化"),
  usedBytesOverTime: m("Used bytes over time", "存储用量随时间变化"),
  noHistorySnapshots: m("No usage history snapshots for this window yet.", "此时间范围内尚无用量历史快照。"),
  objectsAndBuckets: m("Objects & buckets", "对象与存储桶"),
  inventorySnapshots: m("Inventory snapshots over time", "对象与存储桶数量随时间变化"),
  buckets: m("Buckets", "存储桶"),
} satisfies Record<string, I18nMessage>;

type AdminMetricsMessageKey = keyof typeof adminMetricsMessage;
const sourceKeys = new Map<string, AdminMetricsMessageKey>(
  Object.entries(adminMetricsMessage).map(([key, message]) => [message.en, key as AdminMetricsMessageKey]),
);

// Keep request fallbacks independent of the selected language.
export function adminMetricsSourceText(key: AdminMetricsMessageKey): string {
  return adminMetricsMessage[key].en;
}

export function useAdminMetricsI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: AdminMetricsMessageKey, values?: Record<string, string | number>) =>
      interpolateText(t(adminMetricsMessage[key]), values),
    [t],
  );
  const translateText = useCallback(
    (message: string, values?: Record<string, string | number>) => {
      const key = sourceKeys.get(message);
      return key ? text(key, values) : interpolateText(message, values);
    },
    [text],
  );
  return { text, translateText };
}
