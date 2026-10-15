/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import type { BucketUsageStatsDistributionEntry } from "../../api/bucketUsageStats";
import type { UiLanguage } from "../../components/language";
import { translate, useI18n, type I18nMessage } from "../../i18n";

const m = (en: string, zh: string) => ({ en, zh });

export const bucketUsageStatsMessage = {
  buckets: m("buckets", "个存储桶"),
  bucketsBreadcrumb: m("Buckets", "存储桶"),
  usageStats: m("Usage stats", "用量统计"),
  coverage: m("Coverage", "覆盖率"),
  coverageCount: m("{covered} / {total} {items} covered", "已覆盖 {covered} / {total} {items}"),
  bucketCoverageCount: m("{covered} / {total} buckets covered", "已覆盖 {covered} / {total} 个存储桶"),
  emptyCoverageCount: m("0 / {total} {items} covered.", "已覆盖 0 / {total} {items}。"),
  managedAccountCoverage: m("{listed} / {total} managed accounts listed", "已列出 {listed} / {total} 个受管理账户"),
  latestDate: m("Latest {date}", "最近计算时间：{date}"),
  calculatedDate: m("Calculated {date}", "计算时间：{date}"),
  latestBucketSnapshots: m("Latest bucket snapshots", "最新存储桶快照"),
  noSnapshot: m("No usage stats snapshot yet.", "尚无用量统计快照。"),
  noCalculation: m("No usage stats calculated yet.", "尚未计算用量统计。"),
  firstSnapshotDescription: m("Run a calculation to create the first snapshot.", "运行计算以创建首份快照。"),
  persistSnapshotDescription: m("Run a calculation to persist the latest bucket snapshot.", "运行计算以保存最新存储桶快照。"),
  snapshotDescription: m("Latest persisted calculation from object listings. Space ratios use logical object-version bytes.", "根据对象列表保存的最新计算结果。空间占比按对象版本的逻辑字节数计算。"),
  loading: m("Loading...", "正在加载…"),
  refresh: m("Refresh", "刷新"),
  recalculate: m("Recalculate", "重新计算"),
  cancelCalculation: m("Cancel calculation", "取消计算"),
  logicalBytes: m("Logical bytes", "逻辑字节数"),
  currentBytes: m("Current bytes", "当前版本字节数"),
  noncurrentBytes: m("Non-current bytes", "非当前版本字节数"),
  versionsUnit: m("version(s)", "个版本"),
  versionCount: m("{count} version(s)", "{count} 个版本"),
  logicalByteCount: m("{bytes} logical bytes", "{bytes} 逻辑字节"),
  unavailable: m("Unavailable", "不可用"),
  noData: m("No data available.", "暂无数据。"),
  currentVsNoncurrentUnavailable: m("Current/non-current unavailable.", "当前与非当前版本分布不可用。"),
  fallbackScanUnavailable: m("Unavailable for fallback current-only scans.", "回退为仅扫描当前对象时不可用。"),
  versionListingWarning: m("Version listing was unavailable. Current/non-current space distribution cannot be calculated from the fallback listing.", "版本列表不可用，无法根据回退列表计算当前与非当前版本的空间分布。"),
  dataTypesTitle: m("Data types", "数据类型"),
  dataTypesSubtitle: m("Logical bytes by inferred object type", "按推断的对象类型统计逻辑字节数"),
  currentVsNoncurrentTitle: m("Current vs non-current", "当前与非当前版本"),
  currentVsNoncurrentSubtitle: m("Stored object-version bytes", "已存储的对象版本字节数"),
  storageClassesTitle: m("Storage classes", "存储类"),
  storageClassesSubtitle: m("Logical bytes by storage class", "按存储类统计逻辑字节数"),
  objectSizesTitle: m("Object sizes", "对象大小"),
  objectSizesSubtitle: m("Version count by object size", "按对象大小统计版本数量"),
  objectAgeTitle: m("Object age", "对象年龄"),
  objectAgeSubtitle: m("Version count by last modified date", "按最后修改日期统计版本数量"),
  deleteMarkers: m("Delete markers", "删除标记"),
  calculateTitle: m("Calculate bucket usage stats", "计算存储桶用量统计"),
  calculateDescription: m("Run the calculation as a page-level task and keep progress and per-bucket results visible.", "以页面任务运行计算，并显示进度及各存储桶的结果。"),
  stopAndReturn: m("Stop and return", "停止并返回"),
  backToBuckets: m("Back to buckets", "返回存储桶"),
  targetBucket: m("{count} bucket", "{count} 个存储桶"),
  targetBuckets: m("{count} buckets", "{count} 个存储桶"),
  endpoint: m("Endpoint {id}", "端点 {id}"),
  cephAdmin: m("Ceph Admin", "Ceph 管理"),
  storageOps: m("Storage Ops", "存储运维"),
  parallelism: m("Parallelism", "并发数"),
  cancel: m("Cancel", "取消"),
  runCalculation: m("Run calculation", "运行计算"),
  progressLabel: m("Bucket usage stats progress", "存储桶用量统计进度"),
  progressMetric: m("{versions} version(s) - {bytes}", "{versions} 个版本 - {bytes}"),
  bucketsCompleted: m("{completed} / {total} buckets completed", "已完成 {completed} / {total} 个存储桶"),
  bucketsCompletedWithMarkers: m("{completed} / {total} buckets completed - {markers} delete markers", "已完成 {completed} / {total} 个存储桶 - {markers} 个删除标记"),
  versionsListed: m("Versions listed", "已列出的版本"),
  failedBuckets: m("Failed buckets", "失败的存储桶"),
  bucket: m("Bucket", "存储桶"),
  status: m("Status", "状态"),
  bytes: m("Bytes", "字节数"),
  versions: m("Versions", "版本数"),
  notes: m("Notes", "说明"),
  readyTitle: m("Ready to calculate", "准备计算"),
  readyDescription: m("The calculation lists object versions first. If an endpoint does not support version listing, it falls back to current objects only.", "计算时优先列出对象版本。如果端点不支持版本列表，则回退为仅列出当前对象。"),
  statusCompleted: m("completed", "已完成"),
  statusCompletedWithWarnings: m("completed with warnings", "已完成，有警告"),
  statusCanceled: m("canceled", "已取消"),
  statusFailed: m("failed", "失败"),
  statusSkipped: m("skipped", "已跳过"),
  stagePrepare: m("prepare", "准备"),
  stageList: m("list", "列出对象"),
  stagePersist: m("persist", "保存快照"),
  stageCompleted: m("completed", "已完成"),
  calculationCompleted: m("Calculation completed.", "计算已完成。"),
  calculationCompletedWithWarnings: m("Calculation completed with warnings.", "计算已完成，有警告。"),
  calculationCanceled: m("Calculation canceled.", "计算已取消。"),
  calculationFailed: m("Calculation failed.", "计算失败。"),
  invalidOptions: m("Invalid options.", "选项无效。"),
  calculationError: m("Bucket usage stats calculation failed.", "存储桶用量统计计算失败。"),
  loadError: m("Unable to load bucket usage stats.", "无法加载存储桶用量统计。"),
  recalculateError: m("Unable to calculate bucket usage stats.", "无法计算存储桶用量统计。"),
  dataTypeDocuments: m("Documents", "文档"),
  dataTypeImages: m("Images", "图像"),
  dataTypeVideos: m("Videos", "视频"),
  dataTypeAudio: m("Audio", "音频"),
  dataTypeArchives: m("Archives", "归档文件"),
  dataTypeScientificData: m("Scientific data", "科学数据"),
  dataTypeSourceCode: m("Source code", "源代码"),
  dataTypeBackups: m("Backups", "备份"),
  dataTypeOther: m("Other", "其他"),
  distributionUnknown: m("Unknown", "未知"),
  currentVersions: m("Current versions", "当前版本"),
  noncurrentVersions: m("Non-current versions", "非当前版本"),
  sizeZero: m("0 B", "0 B"),
  sizeUpTo128Kib: m("1 B-128 KiB", "1 B–128 KiB"),
  size128KibTo1Mib: m("128 KiB-1 MiB", "128 KiB–1 MiB"),
  size1To10Mib: m("1-10 MiB", "1–10 MiB"),
  size10To100Mib: m("10-100 MiB", "10–100 MiB"),
  size100MibTo1Gib: m("100 MiB-1 GiB", "100 MiB–1 GiB"),
  size1To10Gib: m("1-10 GiB", "1–10 GiB"),
  sizeOver10Gib: m(">10 GiB", ">10 GiB"),
  ageUnder7Days: m("<7d", "少于 7 天"),
  age7To30Days: m("7-30d", "7–30 天"),
  age30To90Days: m("30-90d", "30–90 天"),
  age90To365Days: m("90-365d", "90–365 天"),
  age1To3Years: m("1-3y", "1–3 年"),
  ageOver3Years: m(">3y", "超过 3 年"),
} satisfies Record<string, I18nMessage>;

export type BucketUsageStatsMessageKey = keyof typeof bucketUsageStatsMessage;
type TextValues = Record<string, string | number>;
export type BucketUsageStatsTextOverride = (message: string, values?: TextValues) => string;
export type BucketUsageStatsDistributionKind = "dataType" | "currentVersion" | "size" | "age" | "storageClass";

const distributionKeys: Record<BucketUsageStatsDistributionKind, Readonly<Record<string, BucketUsageStatsMessageKey>>> = {
  dataType: {
    documents: "dataTypeDocuments", images: "dataTypeImages", videos: "dataTypeVideos", audio: "dataTypeAudio",
    archives: "dataTypeArchives", scientific_data: "dataTypeScientificData", source_code: "dataTypeSourceCode",
    backups: "dataTypeBackups", other: "dataTypeOther", unknown: "distributionUnknown",
  },
  currentVersion: { current: "currentVersions", noncurrent: "noncurrentVersions" },
  size: {
    "0_b": "sizeZero", "1_b_128_kib": "sizeUpTo128Kib", "128_kib_1_mib": "size128KibTo1Mib",
    "1_mib_10_mib": "size1To10Mib", "10_mib_100_mib": "size10To100Mib", "100_mib_1_gib": "size100MibTo1Gib",
    "1_gib_10_gib": "size1To10Gib", gt_10_gib: "sizeOver10Gib", unknown: "distributionUnknown",
  },
  age: {
    lt_7d: "ageUnder7Days", "7_30d": "age7To30Days", "30_90d": "age30To90Days", "90_365d": "age90To365Days",
    "1_3y": "age1To3Years", gt_3y: "ageOver3Years", unknown: "distributionUnknown",
  },
  storageClass: {},
};

function interpolate(message: string, values?: TextValues): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

export function bucketUsageStatsErrorMessage(message: string | null, locale: UiLanguage): string | null {
  const keys = ["invalidOptions", "calculationError", "loadError", "recalculateError"] as const;
  const key = keys.find((candidate) => bucketUsageStatsMessage[candidate].en === message);
  return key ? translate(bucketUsageStatsMessage[key], locale) : message;
}

export function useBucketUsageStatsI18n(overrideText?: BucketUsageStatsTextOverride) {
  const { locale, t } = useI18n();
  const text = useCallback(
    (key: BucketUsageStatsMessageKey, values?: TextValues) => overrideText
      ? overrideText(bucketUsageStatsMessage[key].en, values)
      : interpolate(t(bucketUsageStatsMessage[key]), values),
    [overrideText, t],
  );
  const distributionLabel = useCallback(
    (entry: Pick<BucketUsageStatsDistributionEntry, "key" | "label">, kind: BucketUsageStatsDistributionKind) => {
      const key = Object.prototype.hasOwnProperty.call(distributionKeys[kind], entry.key)
        ? distributionKeys[kind][entry.key]
        : undefined;
      if (!key) return entry.label;
      if (overrideText) return overrideText(entry.label);
      return locale === "zh" ? text(key) : entry.label;
    },
    [locale, overrideText, text],
  );
  return { locale, text, distributionLabel };
}
