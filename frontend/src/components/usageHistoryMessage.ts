/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";

import { useI18n, type I18nMessage } from "../i18n";

const m = (en: string, zh: string) => ({ en, zh });

export const usageHistoryMessage = {
  admin: m("Admin", "管理员"),
  breadcrumb: m("Usage History", "用量历史"),
  title: m("Usage history", "用量历史"),
  description: m("Review quota usage trends for RGW accounts and users.", "查看 RGW 账户和用户的配额用量趋势。"),
  allSubjects: m("All subjects", "所有对象"),
  rgwAccounts: m("RGW Accounts", "RGW 账户"),
  rgwUsers: m("RGW Users", "RGW 用户"),
  period: m("Period", "时段"),
  subject: m("Subject", "对象"),
  storage: m("Storage", "存储"),
  objects: m("Objects", "对象数量"),
  quotaRatio: m("Quota ratio", "配额使用率"),
  endpoint: m("Endpoint", "端点"),
  account: m("Account", "账户"),
  s3User: m("S3 user", "S3 用户"),
  quota: m("Quota {value}", "配额 {value}"),
  samples: m("Samples", "采样数"),
  collected: m("Collected", "采集时间"),
  loadEndpointsError: m("Unable to load endpoints.", "无法加载端点。"),
  loadHistoryError: m("Unable to load usage history.", "无法加载用量历史。"),
  collectError: m("Unable to trigger usage history collection.", "无法触发用量历史采集。"),
  collecting: m("Collecting...", "正在采集…"),
  collectUsage: m("Collect usage", "采集用量"),
  snapshots: m("Snapshots", "快照"),
  recordCount: m("{count} record", "{count} 条记录"),
  recordsCount: m("{count} records", "{count} 条记录"),
  granularity: m("Granularity", "粒度"),
  granularityDescription: m("Daily keeps the latest usage per day; hourly keeps each collected quota snapshot.", "每日粒度保留每天最新的用量；每小时粒度保留每次采集的配额快照。"),
  daily: m("Daily", "每日"),
  hourly: m("Hourly", "每小时"),
  dailyPeriod: m("daily", "每日"),
  hourlyPeriod: m("hourly", "每小时"),
  loading: m("Loading...", "正在加载…"),
  allEndpoints: m("All endpoints", "所有端点"),
  start: m("Start", "开始日期"),
  end: m("End", "结束日期"),
  refresh: m("Refresh", "刷新"),
  latestCollection: m("Latest collection", "最近采集时间"),
  maxQuotaRatio: m("Max quota ratio", "最高配额使用率"),
  loadingHistory: m("Loading usage history...", "正在加载用量历史…"),
  emptyHistory: m("No usage history for this scope.", "此范围内没有用量历史。"),
  sortBy: m("Sort by", "排序字段"),
  direction: m("Direction", "排序方向"),
  ascending: m("Ascending", "升序"),
  descending: m("Descending", "降序"),
  collectionSubjectSnapshot: m("Collection completed: {processed} subject processed, {hourly} hourly and {daily} daily snapshot.", "采集完成：已处理 {processed} 个对象，保存 {hourly} 份每小时快照和 {daily} 份每日快照。"),
  collectionSubjectsSnapshot: m("Collection completed: {processed} subjects processed, {hourly} hourly and {daily} daily snapshot.", "采集完成：已处理 {processed} 个对象，保存 {hourly} 份每小时快照和 {daily} 份每日快照。"),
  collectionSubjectSnapshots: m("Collection completed: {processed} subject processed, {hourly} hourly and {daily} daily snapshots.", "采集完成：已处理 {processed} 个对象，保存 {hourly} 份每小时快照和 {daily} 份每日快照。"),
  collectionSubjectsSnapshots: m("Collection completed: {processed} subjects processed, {hourly} hourly and {daily} daily snapshots.", "采集完成：已处理 {processed} 个对象，保存 {hourly} 份每小时快照和 {daily} 份每日快照。"),
  unknownError: m("Unknown error", "未知错误"),
  unknownWarning: m("Unknown warning", "未知警告"),
  collectionOneError: m("Collection finished with {count} error. First error: {first}", "采集结束，出现 {count} 个错误。首个错误：{first}"),
  collectionErrors: m("Collection finished with {count} errors. First error: {first}", "采集结束，出现 {count} 个错误。首个错误：{first}"),
  collectionOneWarning: m("Collection finished with {count} warning. First warning: {first}", "采集结束，出现 {count} 个警告。首个警告：{first}"),
  collectionWarnings: m("Collection finished with {count} warnings. First warning: {first}", "采集结束，出现 {count} 个警告。首个警告：{first}"),
  dayWindow: m("24h", "24 小时"),
  weekWindow: m("7d", "7 天"),
  monthWindow: m("30d", "30 天"),
  hourlySnapshots: m("Hourly snapshots", "每小时快照"),
  dailySnapshots: m("Daily snapshots", "每日快照"),
  storedSnapshots: m("Stored snapshots", "已保存快照"),
  trendsDescription: m("{helper} from collected quota usage history.", "用量历史采集得到的{helper}。"),
  unavailableDescription: m("Stored quota snapshots over time.", "随时间保存的配额快照。"),
  trendsUnavailable: m("Usage history trends are unavailable for this context.", "此上下文无法使用用量历史趋势。"),
  windowLabel: m("{title} window", "{title}时间范围"),
  latestStorage: m("Latest storage", "最新存储用量"),
  subjectsCount: m("{count} subjects", "{count} 个对象"),
  latestObjects: m("Latest objects", "最新对象数量"),
  bucketsCount: m("{count} buckets", "{count} 个存储桶"),
  highestPoint: m("Highest point", "最高点"),
  periodsCount: m("{count} periods", "{count} 个时段"),
  storageEvolution: m("Storage evolution", "存储变化"),
  usedBytesOverTime: m("Used bytes over time", "存储用量随时间变化"),
  emptyTrends: m("No usage history snapshots for this window yet.", "此时间范围内尚无用量历史快照。"),
  objectsAndBuckets: m("Objects & buckets", "对象与存储桶"),
  inventorySnapshots: m("Inventory snapshots over time", "对象与存储桶数量随时间变化"),
  buckets: m("Buckets", "存储桶"),
} satisfies Record<string, I18nMessage>;

export type UsageHistoryMessageKey = keyof typeof usageHistoryMessage;
export type UsageHistoryText = (key: UsageHistoryMessageKey, values?: Record<string, string | number>) => string;

export function useUsageHistoryI18n() {
  const { locale, t } = useI18n();
  const text: UsageHistoryText = useCallback(
    (key, values) => t(usageHistoryMessage[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { locale, text };
}
