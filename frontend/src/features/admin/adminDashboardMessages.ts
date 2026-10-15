/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n, type I18nMessage } from "../../i18n";

const m = (en: string, zh: string) => ({ en, zh });

const messages = {
  admin: m("Admin", "管理"),
  dashboard: m("Dashboard", "仪表盘"),
  title: m("Admin overview", "管理概览"),
  description: m("Monitor the health and status of your S3 infrastructure.", "监控 S3 基础设施的健康状况和运行状态。"),
  dateUnavailable: m("Date unavailable", "日期不可用"),
  justNow: m("just now", "刚刚"),
  minutesAgo: m("{count}m ago", "{count} 分钟前"),
  hoursAgo: m("{count}h ago", "{count} 小时前"),
  daysAgo: m("{count}d ago", "{count} 天前"),
  hours: m("{count}h", "{count} 小时"),
  minutes: m("{count}m", "{count} 分钟"),
  seconds: m("{count}s", "{count} 秒"),
  noHealthcheckData: m("Endpoint Status is enabled, but no endpoint healthcheck data is available.", "端点状态已启用，但没有可用的端点健康检查数据。"),
  staleAfter: m(" after {threshold}", "（超过 {threshold}）"),
  staleHealthcheckData: m("{count}/{total} endpoint(s) have stale healthcheck data{threshold}. Stale endpoints are shown as Unknown until a fresh check is stored.", "{count}/{total} 个端点的健康检查数据已过期{threshold}。在保存新的检查结果之前，过期端点将显示为未知。"),
  userLoggedIn: m("User {email} logged in", "用户 {email} 已登录"),
  bucketAction: m('Bucket "{id}" {action}', '存储桶“{id}” {action}'),
  endpointAction: m("Endpoint {id} {action}", "端点 {id} {action}"),
  entityAction: m("{entity} {id} {action}", "{entity} {id} {action}"),
  entity: m("Entity", "实体"),
  endpointHealth: m("Endpoint Health", "端点健康"),
  openEndpointStatus: m("Open Endpoint Status", "打开端点状态"),
  healthSamples: m("Stored healthcheck samples and latency.", "已保存的健康检查样本和延迟。"),
  dataRefreshed: m(" Data refreshed {timestamp}.", " 数据更新时间：{timestamp}。"),
  loadingHealth: m("Loading endpoint health…", "正在加载端点健康状态…"),
  status_up: m("Up", "正常"),
  status_degraded: m("Degraded", "降级"),
  status_down: m("Down", "不可用"),
  status_unknown: m("Unknown", "未知"),
  endpointHealthSamples: m("Endpoint health samples", "端点健康样本"),
  moreEndpoints: m("+ {count} more endpoint(s)", "+ 另有 {count} 个端点"),
  allIncidents: m("View all incidents", "查看所有事件"),
  checked: m("Checked {time}{stale}", "检查于{time}{stale}"),
  stale: m(" · Stale", " · 已过期"),
  noHealthcheck: m("No healthcheck yet", "尚无健康检查"),
  partialData: m("Partial data", "部分数据"),
  dataUnavailable: m("Data unavailable", "数据不可用"),
  coverageNote: m("{prefix} — {complete}/{total} endpoints fully measured.{details}", "{prefix} — {complete}/{total} 个端点已完成全部测量。{details}"),
  storageUnavailable: m("Storage metrics are not available.", "存储指标不可用。"),
  trafficUnavailable: m("Usage logs are not available.", "用量日志不可用。"),
  noStorageEndpoint: m("No managed Ceph endpoint has ready Supervision credentials and Metrics enabled.", "没有具备可用 Supervision 凭据且启用了指标的托管 Ceph 端点。"),
  noTrafficEndpoint: m("No managed Ceph endpoint has ready Supervision credentials and Usage enabled.", "没有具备可用 Supervision 凭据且启用了用量统计的托管 Ceph 端点。"),
  unavailableStatus: m("{label} unavailable", "{label}不可用"),
  partialStatus: m("{label} partial", "{label}数据不完整"),
  storage: m("Storage", "存储"),
  traffic: m("Traffic", "流量"),
  availability: m("Availability", "可用率"),
  availabilityUnavailable: m("Availability unavailable", "可用率不可用"),
  availabilityPartial: m("Availability partial", "可用率数据不完整"),
  buckets: m("Buckets", "存储桶"),
  objects: m("Objects", "对象"),
  storedData: m("Stored data", "已存储数据"),
  requests: m("Requests (24h)", "请求数（24 小时）"),
  success: m("{percent} success", "成功率 {percent}"),
  availabilityWeek: m("Availability (7 days)", "可用率（7 天）"),
  storageTraffic: m("Storage & traffic", "存储与流量"),
  aboutMetrics: m("About storage and traffic metrics", "关于存储和流量指标"),
  aggregation: m("Aggregated across managed and supervised Ceph endpoints. Includes Accounts and S3 Users registered in BucketReef.", "汇总已托管并受监测的 Ceph 端点数据，包括在 BucketReef 中注册的账户和 S3 用户。"),
  metricCoverage: m("Metric coverage and dates", "指标覆盖范围和日期"),
  measure: m("Measure", "指标"),
  endpoints: m("Endpoints", "端点"),
  dataDate: m("Data date", "数据日期"),
  loading: m("Loading…", "正在加载…"),
  weekMean: m("7-day mean", "7 天平均值"),
  storageDetail: m("Storage: {reason}", "存储：{reason}"),
  trafficDetail: m("Traffic: {reason}", "流量：{reason}"),
  availabilityDetail: m("Availability: {reason}", "可用率：{reason}"),
  coverageHelp: m("Coverage counts fully measured endpoints. Partial totals remain visible.", "覆盖数量仅统计已完成全部测量的端点。部分汇总数据仍会显示。"),
  availabilityHelp: m("Mean availability across endpoints with measurements.", "有测量数据的端点的平均可用率。"),
  cacheHelp: m("Storage and traffic are cached for up to 30 minutes. Refresh respects this expiry.", "存储和流量数据最多缓存 30 分钟。刷新操作遵循此缓存有效期。"),
  supervisedCeph: m("Managed & supervised Ceph", "已托管并受监测的 Ceph"),
  recentActivity: m("Recent activity", "最近活动"),
  loadingActivity: m("Loading activity…", "正在加载活动…"),
  noActivity: m("No recent audit activity.", "最近没有审计活动。"),
  auditLogs: m("View audit logs", "查看审计日志"),
  loadOverviewError: m("Unable to load admin overview.", "无法加载管理概览。"),
  loadScopeError: m("Unable to load supervised endpoint scope.", "无法加载受监测的端点范围。"),
  loadActivityError: m("Audit activity is not available.", "审计活动不可用。"),
  loadHealthError: m("Unable to load workspace endpoint health.", "无法加载工作区端点健康状态。"),
  loadMapError: m("Unable to load endpoint map coordinates.", "无法加载端点地图坐标。"),
  healthHistoryUnavailable: m("7-day endpoint health history is not available.", "端点的 7 天健康历史不可用。"),
  hideSetupError: m("Unable to hide setup yet.", "暂时无法隐藏设置向导。"),
  loadSetupError: m("Unable to load onboarding status.", "无法加载设置向导状态。"),
  manager: m("Manager", "Manager"),
  browser: m("Browser", "Browser"),
  portal: m("Portal", "Portal"),
  cephAdmin: m("Ceph Admin", "Ceph Admin"),
  storageOps: m("Storage Ops", "Storage Ops"),
  billing: m("Billing", "计费"),
  endpointStatus: m("Endpoint Status", "端点状态"),
  quotaAlerts: m("Quota alerts", "配额告警"),
  usageHistory: m("Usage history", "用量历史"),
  coreFeatures: m("Core features", "核心功能"),
  extraFeatures: m("Extra features", "附加功能"),
  uiUsers: m("UI Users", "界面用户"),
  userCounts: m("Admins: {admins}  Users: {users}", "管理员：{admins}  用户：{users}"),
  activeSessions: m("Active Sessions", "活跃会话"),
  sessionCounts: m("UI: {ui} · S3: {s3}", "界面：{ui} · S3：{s3}"),
  accounts: m("Accounts", "账户"),
  assigned: m("Assigned: {count}", "已分配：{count}"),
  s3Users: m("S3 Users", "S3 用户"),
  sharedConnections: m("Shared S3 Connections", "共享 S3 连接"),
  adminManaged: m("Admin-managed", "由管理员管理"),
  endpointCounts: m("Ceph: {ceph}  Other: {other}", "Ceph：{ceph}  其他：{other}"),
  endpointStatusDisabled: m("Endpoint Status feature is disabled.", "端点状态功能已禁用。"),
  noEndpointData: m("Endpoint Status has no endpoint data yet.", "端点状态尚无端点数据。"),
  missingWeekMeasurements: m("7-day measurements unavailable: {endpoints}.", "以下端点的 7 天测量数据不可用：{endpoints}。"),
  noSupervisedEndpoint: m("No managed and supervised Ceph endpoint has Metrics or Usage enabled.", "没有启用了指标或用量统计的已托管并受监测的 Ceph 端点。"),
  lastRetrievalHelp: m("Last dashboard retrieval; metrics and healthcheck samples retain their own timestamps.", "最近一次获取仪表盘数据的时间；指标和健康检查样本保留各自的时间戳。"),
  updated: m("Updated {timestamp}", "更新时间：{timestamp}"),
  refresh: m("Refresh admin dashboard", "刷新管理仪表盘"),
  refreshHelp: m("Refresh dashboard; storage and traffic respect the cache for up to 30 minutes.", "刷新仪表盘；存储和流量数据遵循最长 30 分钟的缓存有效期。"),
  administration: m("Administration", "管理"),
  enabledFeatures: m("Enabled features", "已启用的功能"),
} satisfies Record<string, I18nMessage>;

type AdminDashboardMessageKey = keyof typeof messages;
const sourceKeys = new Map<string, AdminDashboardMessageKey>(
  Object.entries(messages).map(([key, message]) => [message.en, key as AdminDashboardMessageKey]),
);

// Request fallbacks stay stable so locale changes only update the rendered copy.
export function adminDashboardSourceText(key: AdminDashboardMessageKey): string {
  return messages[key].en;
}

export function useAdminDashboardI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: AdminDashboardMessageKey, values?: Record<string, string | number>) =>
      t(messages[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  const translateText = useCallback((message: string) => {
    const key = sourceKeys.get(message);
    return key ? text(key) : message;
  }, [text]);
  return { text, translateText };
}
