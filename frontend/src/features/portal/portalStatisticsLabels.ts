/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { useI18n } from "../../i18n";
import type { BucketUsageStatsCompositionLabels } from "../shared/BucketUsageStatsVisuals";

type PortalTranslate = ReturnType<typeof useI18n>["t"];

export function portalUsageCompositionLabels(t: PortalTranslate): BucketUsageStatsCompositionLabels {
  return {
    logicalBytes: t({ en: "Stored data", fr: "Données stockées", de: "Gespeicherte Daten", zh: "存储数据" }),
    currentBytes: t({ en: "Current files", fr: "Fichiers courants", de: "Aktuelle Dateien", zh: "当前文件" }),
    noncurrentBytes: t({ en: "Older versions", fr: "Anciennes versions", de: "Ältere Versionen", zh: "旧版本" }),
    versionsUnit: t({ en: "versions", fr: "versions", de: "Versionen", zh: "个版本" }),
    unavailable: t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar", zh: "不可用" }),
    versionListingWarning: t({
      en: "Older file versions could not be listed, so their storage distribution is unavailable.",
      fr: "Les anciennes versions de fichiers n’ont pas pu être listées : leur répartition de stockage est indisponible.",
      de: "Ältere Dateiversionen konnten nicht aufgelistet werden; ihre Speicherverteilung ist nicht verfügbar.",
      zh: "无法列出旧文件版本，因此无法获取其存储分布。",
    }),
    dataTypesTitle: t({ en: "File types", fr: "Types de fichiers", de: "Dateitypen", zh: "文件类型" }),
    dataTypesSubtitle: t({ en: "Stored data by inferred file type", fr: "Données stockées par type de fichier détecté", de: "Gespeicherte Daten nach erkanntem Dateityp", zh: "按推断文件类型划分的存储数据" }),
    currentVsNoncurrentTitle: t({ en: "Current and older versions", fr: "Versions courantes et anciennes", de: "Aktuelle und ältere Versionen", zh: "当前及旧版本" }),
    currentVsNoncurrentSubtitle: t({ en: "Storage used by file history", fr: "Stockage utilisé par l’historique des fichiers", de: "Vom Dateiverlauf belegter Speicher", zh: "文件历史占用的存储" }),
    storageClassesTitle: t({ en: "Storage classes", fr: "Classes de stockage", de: "Speicherklassen", zh: "存储类别" }),
    storageClassesSubtitle: t({ en: "Stored data by storage class", fr: "Données stockées par classe de stockage", de: "Gespeicherte Daten nach Speicherklasse", zh: "按存储类别划分的数据" }),
    objectSizesTitle: t({ en: "File sizes", fr: "Tailles des fichiers", de: "Dateigrößen", zh: "文件大小" }),
    objectSizesSubtitle: t({ en: "Versions by file size", fr: "Versions par taille de fichier", de: "Versionen nach Dateigröße", zh: "按文件大小划分的版本" }),
    objectAgeTitle: t({ en: "File age", fr: "Âge des fichiers", de: "Dateialter", zh: "文件年龄" }),
    objectAgeSubtitle: t({ en: "Versions by last modification date", fr: "Versions par date de dernière modification", de: "Versionen nach letzter Änderung", zh: "按最后修改日期划分的版本" }),
  };
}

export function portalTrafficLabels(t: PortalTranslate) {
  return {
    egress: t({ en: "Downloaded", fr: "Téléchargé", de: "Heruntergeladen", zh: "已下载" }),
    egressHint: t({ en: "Sent out", fr: "Sorti", de: "Ausgehend", zh: "传出" }),
    ingress: t({ en: "Uploaded", fr: "Envoyé", de: "Hochgeladen", zh: "已上传" }),
    ingressHint: t({ en: "Sent in", fr: "Entré", de: "Eingehend", zh: "传入" }),
    successRate: t({ en: "Completed activity", fr: "Activité réussie", de: "Abgeschlossene Aktivität", zh: "已完成活动" }),
    summaryActivityUnit: t({ en: "actions", fr: "actions", de: "Aktionen", zh: "次操作" }),
    trafficChartTitle: t({ en: "Movement over time", fr: "Mouvements dans le temps", de: "Bewegung im Zeitverlauf", zh: "传输趋势" }),
    trafficChartSubtitle: t({ en: "Uploads compared with downloads", fr: "Envois comparés aux téléchargements", de: "Uploads im Vergleich zu Downloads", zh: "上传与下载对比" }),
    callVolumeTitle: t({ en: "File activity", fr: "Activité fichier", de: "Dateiaktivität", zh: "文件活动" }),
    callVolumeSubtitle: t({ en: "Actions per period", fr: "Actions par période", de: "Aktionen pro Zeitraum", zh: "每个时段的操作数" }),
    requestBreakdownTitle: t({ en: "Action types", fr: "Types d’actions", de: "Aktionstypen", zh: "操作类型" }),
    emptyMessage: t({ en: "No upload or download activity for this window.", fr: "Aucun envoi ou téléchargement sur cette période.", de: "Keine Upload- oder Download-Aktivität in diesem Fenster.", zh: "此时间范围内没有上传或下载活动。" }),
    rankingActivityUnit: t({ en: "actions", fr: "actions", de: "Aktionen", zh: "次操作" }),
    successText: t({ en: "completed", fr: "réussies", de: "abgeschlossen", zh: "已完成" }),
    inboundLabel: t({ en: "Uploaded", fr: "Envoyé", de: "Hochgeladen", zh: "已上传" }),
    outboundLabel: t({ en: "Downloaded", fr: "Téléchargé", de: "Heruntergeladen", zh: "已下载" }),
    callVolumeBarName: t({ en: "Actions", fr: "Actions", de: "Aktionen", zh: "操作" }),
  };
}

export function portalActivitySourceTitle(t: PortalTranslate): string {
  return t({ en: "Activity source", fr: "Source de l’activité", de: "Aktivitätsquelle", zh: "活动来源" });
}
