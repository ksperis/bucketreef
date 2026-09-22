/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { getPortalBillingMe, type BillingSubjectDetail } from "../../api/billing";
import type { BucketUsageStatsAggregate } from "../../api/bucketUsageStats";
import type { HealthCheckStatus } from "../../api/healthchecks";
import { fetchPortalUsageHistoryTrends, getPortalUsageStatsAggregate } from "../../api/portalUsage";
import type { TrafficWindow } from "../../api/stats";
import type { UsageHistoryTrendResponse, UsageHistoryTrendWindow } from "../../api/usageHistory";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard } from "../../components/MetricsTrafficOverview";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageShell from "../../components/PageShell";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import { WorkspaceStatusDot } from "../../components/WorkspaceDashboardKit";
import UiBadge from "../../components/ui/UiBadge";
import { cx, uiCardMutedClass, uiInputClass, uiLabelClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { currentUtcMonthInputValue } from "../../utils/dateInputValues";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import { formatPortalCurrency } from "./portalI18n";
import {
  portalActivitySourceTitle,
  portalTrafficLabels,
  portalUsageCompositionLabels,
} from "./portalStatisticsLabels";
import { PortalPageState } from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type PortalUsageTab = "storage" | "storage-spaces" | "usage-composition" | "usage-history" | "traffic" | "billing";

function percent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

function backendStatusFromHealth(health: ReturnType<typeof usePortalWorkspaceData>["health"]): HealthCheckStatus {
  if (!health || health.endpoint_count <= 0) return "unknown";
  if (health.down_count > 0) return "down";
  if (health.degraded_count > 0) return "degraded";
  if (health.up_count > 0) return "up";
  return "unknown";
}

function backendStatusTone(status: HealthCheckStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "up") return "success";
  if (status === "degraded") return "warning";
  if (status === "down") return "danger";
  return "neutral";
}

function backendStatusLabel(status: HealthCheckStatus, t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "up") return t({ en: "Operational", fr: "Opérationnel", de: "Betriebsbereit", zh: "正常" });
  if (status === "degraded") return t({ en: "Degraded", fr: "Dégradé", de: "Beeinträchtigt", zh: "性能下降" });
  if (status === "down") return t({ en: "Issue", fr: "Incident", de: "Problem", zh: "异常" });
  return t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar", zh: "不可用" });
}

function backendStatusHint(status: HealthCheckStatus, t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "up") return t({ en: "The storage service is responding normally.", fr: "Le service de stockage répond normalement.", de: "Der Speicherdienst antwortet normal.", zh: "存储服务响应正常。" });
  if (status === "degraded") return t({ en: "Some storage checks are degraded.", fr: "Certains contrôles du stockage sont dégradés.", de: "Einige Speicherprüfungen sind beeinträchtigt.", zh: "部分存储检查显示性能下降。" });
  if (status === "down") return t({ en: "Some storage checks are failing.", fr: "Certains contrôles du stockage échouent.", de: "Einige Speicherprüfungen schlagen fehl.", zh: "部分存储检查失败。" });
  return t({ en: "No recent backend check is available.", fr: "Aucun contrôle récent du backend n'est disponible.", de: "Keine aktuelle Backend-Prüfung verfügbar.", zh: "没有近期的后端检查结果。" });
}

function formatBackendTimestamp(value: string | null | undefined, locale: ReturnType<typeof useI18n>["locale"]): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function PortalUsagePage() {
  const { locale, t } = useI18n();
  const { generalSettings } = useGeneralSettings();
  const [month, setMonth] = useState(currentUtcMonthInputValue());
  const [activeTab, setActiveTab] = useState<PortalUsageTab>("storage");
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("week");
  const [usageHistoryWindow, setUsageHistoryWindow] = useState<UsageHistoryTrendWindow>("month");
  const [billing, setBilling] = useState<BillingSubjectDetail | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageHistoryTrends, setUsageHistoryTrends] = useState<UsageHistoryTrendResponse | null>(null);
  const [usageHistoryLoading, setUsageHistoryLoading] = useState(false);
  const [usageHistoryError, setUsageHistoryError] = useState<string | null>(null);
  const {
    workspace,
    storageSpaces,
    usage,
    usageLoading,
    usageError,
    traffic,
    trafficLoading,
    trafficError,
    health,
    healthLoading,
    loading,
    error,
    accountError,
    accountLoading,
    hasAccountContext,
    accountIdForApi,
    selectedAccount,
  } = usePortalWorkspaceData({ includeUsage: true, includeTraffic: true, includeHealth: true, trafficWindow });

  const tabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: t({ en: "Overview", fr: "Vue d'ensemble", de: "Überblick", zh: "概览" }) },
        { id: "storage-spaces" as const, label: t({ en: "By space", fr: "Par espace", de: "Nach Bereich", zh: "按空间" }) },
        ...(generalSettings.bucket_usage_stats_enabled ? [{ id: "usage-composition" as const, label: t({ en: "File types", fr: "Types de fichiers", de: "Dateitypen", zh: "文件类型" }) }] : []),
        ...(generalSettings.usage_history_enabled ? [{ id: "usage-history" as const, label: t({ en: "Trends", fr: "Tendances", de: "Trends", zh: "趋势" }) }] : []),
        { id: "traffic" as const, label: t({ en: "Uploads & downloads", fr: "Envois et téléchargements", de: "Uploads & Downloads", zh: "上传与下载" }) },
        ...(generalSettings.billing_enabled ? [{ id: "billing" as const, label: t({ en: "Costs", fr: "Coûts", de: "Kosten", zh: "费用" }) }] : []),
      ],
    [generalSettings.billing_enabled, generalSettings.bucket_usage_stats_enabled, generalSettings.usage_history_enabled, t]
  );

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0]?.id ?? "storage");
    }
  }, [activeTab, tabs]);

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.bucket_usage_stats_enabled || !hasAccountContext || !accountIdForApi) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return () => {
        cancelled = true;
      };
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    getPortalUsageStatsAggregate(accountIdForApi)
      .then((data) => {
        if (!cancelled) setUsageStatsAggregate(data.aggregate);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageStatsAggregate(null);
          setUsageStatsError(extractApiError(err, t({ en: "Unable to load usage composition.", fr: "Impossible de charger la composition d'utilisation.", de: "Nutzungszusammensetzung kann nicht geladen werden.", zh: "无法加载用量组成。" })));
        }
      })
      .finally(() => {
        if (!cancelled) setUsageStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.bucket_usage_stats_enabled, hasAccountContext, t]);

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.usage_history_enabled || !hasAccountContext || !accountIdForApi) {
      setUsageHistoryTrends(null);
      setUsageHistoryLoading(false);
      setUsageHistoryError(null);
      return () => {
        cancelled = true;
      };
    }
    setUsageHistoryLoading(true);
    setUsageHistoryError(null);
    fetchPortalUsageHistoryTrends(accountIdForApi, usageHistoryWindow)
      .then((data) => {
        if (!cancelled) setUsageHistoryTrends(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageHistoryTrends(null);
          setUsageHistoryError(extractApiError(err, t({ en: "Unable to load usage history trends.", fr: "Impossible de charger les tendances d'historique d'utilisation.", de: "Nutzungsverlaufstrends können nicht geladen werden.", zh: "无法加载历史用量趋势。" })));
        }
      })
      .finally(() => {
        if (!cancelled) setUsageHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.usage_history_enabled, hasAccountContext, t, usageHistoryWindow]);

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.billing_enabled || !hasAccountContext || !accountIdForApi || !month) {
      setBilling(null);
      setBillingLoading(false);
      setBillingUnavailable(false);
      setBillingError(null);
      return () => {
        cancelled = true;
      };
    }
    setBillingLoading(true);
    setBillingUnavailable(false);
    setBillingError(null);
    getPortalBillingMe(month, accountIdForApi)
      .then((data) => {
        if (!cancelled) setBilling(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setBilling(null);
          setBillingUnavailable(true);
          setBillingError(extractApiError(err, t({ en: "Unable to load billing source.", fr: "Impossible de charger la source de facturation.", de: "Abrechnungsquelle kann nicht geladen werden.", zh: "无法加载计费来源。" })));
        }
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.billing_enabled, hasAccountContext, month, t]);

  const storageBySpace = useMemo(() => {
    const usageSpaces = usage?.storage_spaces ?? [];
    if (usageSpaces.length > 0) {
      return usageSpaces
        .map((space) => ({
          id: space.id,
          name: space.name,
          usedBytes: space.used_bytes ?? null,
          objectCount: space.object_count ?? null,
          quotaBytes: space.quota_max_size_bytes ?? null,
        }))
        .filter((space) => space.usedBytes != null || space.objectCount != null);
    }
    const apiSpaces = storageSpaces ?? [];
    return apiSpaces
      .map((space) => {
        const workspaceSpace = workspace.spaces.find((item) => item.id === space.id);
        return {
          id: space.id,
          name: workspaceSpace?.name ?? space.name,
          usedBytes: space.used_bytes ?? null,
          objectCount: space.object_count ?? null,
          quotaBytes: space.quota_max_size_bytes ?? null,
        };
      })
      .filter((space) => space.usedBytes != null || space.objectCount != null);
  }, [storageSpaces, usage?.storage_spaces, workspace.spaces]);

  const storageSpaceItems = useMemo(
    () =>
      storageBySpace.map((space) => ({
        id: space.id,
        label: space.name,
        usedBytes: space.usedBytes,
        objectCount: space.objectCount,
      })),
    [storageBySpace]
  );

  const totalUsedBytes =
    usage?.used_bytes ??
    (storageBySpace.some((space) => space.usedBytes != null)
      ? storageBySpace.reduce((sum, space) => sum + (space.usedBytes ?? 0), 0)
      : workspace.usedBytes ?? null);
  const totalObjects =
    usage?.used_objects ??
    (storageBySpace.some((space) => space.objectCount != null)
      ? storageBySpace.reduce((sum, space) => sum + (space.objectCount ?? 0), 0)
      : workspace.usedObjects ?? null);
  const quotaBytes = usage?.quota_max_size_bytes ?? workspace.quotaBytes ?? null;
  const quotaObjects = usage?.quota_max_objects ?? workspace.quotaObjects ?? null;
  const quotaPercent = percent(totalUsedBytes, quotaBytes);
  const objectQuotaPercent = percent(totalObjects, quotaObjects);
  const remainingBytes =
    totalUsedBytes != null && quotaBytes != null && quotaBytes >= 0
      ? Math.max(0, quotaBytes - totalUsedBytes)
      : null;
  const storageSpaceCount = workspace.spaces.length || storageSpaces?.length || 0;
  const billingUsage = billing?.usage ?? null;
  const cost = billing?.cost ?? null;
  const billingCoverage = billing?.coverage ?? null;
  const trafficMissing = !traffic && !trafficLoading && !trafficError;
  const backendStatus = backendStatusFromHealth(health);
  const backendIssueCount = (health?.down_count ?? 0) + (health?.degraded_count ?? 0);
  const bucketRankingLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    workspace.spaces.forEach((space) => {
      labels[space.id] = space.name;
      if (space.internalName) {
        labels[space.internalName] = space.name;
      }
    });
    return labels;
  }, [workspace.spaces]);
  const userRankingLabels = useMemo(() => {
    const rgwAccountId = selectedAccount?.rgw_account_id?.trim();
    return rgwAccountId ? { [rgwAccountId]: workspace.accountName } : {};
  }, [selectedAccount?.rgw_account_id, workspace.accountName]);

  const billingMonthControl = (
    <label className={cx(uiCardMutedClass, "flex h-9 items-center gap-2 px-3 ui-caption font-semibold", uiMutedTextClass)}>
      <span>{t({ en: "Month", fr: "Mois", de: "Monat", zh: "月份" })}</span>
      <input
        type="month"
        value={month}
        onChange={(event) => setMonth(event.target.value)}
        className={cx(uiInputClass, "h-6 w-[120px] border-0 bg-transparent p-0 ui-caption font-semibold shadow-none")}
      />
    </label>
  );

  if (accountLoading || loading) {
    return <PortalPageState>{t({ en: "Loading storage health...", fr: "Chargement de l'état du stockage...", de: "Speicherstatus wird geladen...", zh: "正在加载存储健康状况…" })}</PortalPageState>;
  }

  if (accountError || error) {
    return <PortalPageState tone="error">{accountError ?? error}</PortalPageState>;
  }

  if (!hasAccountContext) {
    return (
      <div className="space-y-4">
        <PageEmptyState
          title={t({ en: "Select a project to view storage health", fr: "Sélectionnez un projet pour voir l'état du stockage", de: "Wählen Sie ein Projekt aus, um den Speicherstatus anzuzeigen", zh: "选择项目以查看存储健康状况" })}
          description={t({ en: "Storage room, space usage, transfer activity, and costs belong to the selected project.", fr: "L'espace disponible, l'utilisation par espace, l'activité de transfert et les coûts dépendent du projet sélectionné.", de: "Speicherplatz, Bereichsnutzung, Transferaktivität und Kosten gehören zum ausgewählten Projekt.", zh: "存储容量、空间用量、传输活动和费用均属于所选项目。" })}
          tone="warning"
        />
      </div>
    );
  }

  return (
    <PageShell
        title={t({ en: "Storage health", fr: "État du stockage", de: "Speicherstatus", zh: "存储健康状况" })}
        description={t({ en: "See how much room is left, which spaces are growing, and how files move in this workspace.", fr: "Voyez l'espace restant, les espaces qui grandissent et la façon dont les fichiers circulent dans ce workspace.", de: "Sehen Sie, wie viel Platz bleibt, welche Bereiche wachsen und wie Dateien in diesem Workspace bewegt werden.", zh: "查看此工作区的剩余容量、空间增长情况及文件传输情况。" })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Storage health", fr: "État du stockage", de: "Speicherstatus", zh: "存储健康状况" }) })}
        actions={[
          { label: t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen", zh: "打开空间列表" }), to: "/portal/storage-spaces", variant: "secondary" },
        ]}
    >

      <PortalPageTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab as PortalUsageTab)}
        ariaLabel={t({ en: "Storage health views", fr: "Vues de l'état du stockage", de: "Ansichten des Speicherstatus", zh: "存储健康状况视图" })}
        idPrefix="portal-storage-health"
      />

      <PortalTabPanel idPrefix="portal-storage-health" tabId={activeTab} className="space-y-4">
      {activeTab === "storage" ? (
        <div className="space-y-4">
          <MetricsCard
            title={t({ en: "Room and files", fr: "Espace et fichiers", de: "Platz und Dateien", zh: "容量与文件" })}
            description={t({ en: "Current storage, file count, and remaining room for this workspace.", fr: "Stockage actuel, nombre de fichiers et espace restant pour ce workspace.", de: "Aktueller Speicher, Dateianzahl und verbleibender Platz für diesen Workspace.", zh: "此工作区的当前存储用量、文件数量和剩余容量。" })}
          >
            {usageError ? (
              <PageBanner tone="warning">{t({ en: "Usage data is unavailable from storage metrics. Available workspace data is still shown.", fr: "Les données d'utilisation sont indisponibles depuis les métriques de stockage. Les données disponibles de l'espace de travail restent affichées.", de: "Nutzungsdaten sind aus Speichermetriken nicht verfügbar. Verfügbare Arbeitsbereichsdaten werden weiterhin angezeigt.", zh: "无法从存储指标中获取用量数据。仍显示可用的工作区数据。" })}</PageBanner>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricsSnapshotCard
                label={t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher", zh: "已用存储" })}
                value={formatBytes(totalUsedBytes)}
                hint={quotaPercent == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar", zh: "无法获取配额" }) : t({ en: `${formatPercentage(quotaPercent)} of quota`, fr: `${formatPercentage(quotaPercent)} du quota`, de: `${formatPercentage(quotaPercent)} der Quote`, zh: `配额的 ${formatPercentage(quotaPercent)}` })}
                loading={usageLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Room left", fr: "Espace restant", de: "Verbleibender Platz", zh: "剩余容量" })}
                value={formatBytes(remainingBytes)}
                hint={quotaBytes == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar", zh: "无法获取配额" }) : t({ en: `${formatBytes(quotaBytes)} total`, fr: `${formatBytes(quotaBytes)} au total`, de: `${formatBytes(quotaBytes)} insgesamt`, zh: `总计 ${formatBytes(quotaBytes)}` })}
                loading={usageLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Files", fr: "Fichiers", de: "Dateien", zh: "文件" })}
                value={formatCompactNumber(totalObjects)}
                hint={objectQuotaPercent == null ? (totalObjects == null ? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar", zh: "不可用" }) : t({ en: "Tracked", fr: "Suivis", de: "Erfasst", zh: "已统计" })) : t({ en: `${formatPercentage(objectQuotaPercent)} of file quota`, fr: `${formatPercentage(objectQuotaPercent)} du quota de fichiers`, de: `${formatPercentage(objectQuotaPercent)} der Dateiquote`, zh: `文件配额的 ${formatPercentage(objectQuotaPercent)}` })}
                loading={usageLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Spaces", fr: "Espaces", de: "Bereiche", zh: "空间" })}
                value={formatCompactNumber(storageSpaceCount)}
                hint={t({ en: "Visible here", fr: "Visibles ici", de: "Hier sichtbar", zh: "此处可见" })}
                loading={usageLoading}
              />
            </div>
          </MetricsCard>

          <MetricsCard
            title={t({ en: "Backend status", fr: "Statut du backend", de: "Backend-Status", zh: "后端状态" })}
            description={t({ en: "Current availability of the storage service used by this workspace.", fr: "Disponibilité actuelle du service de stockage utilisé par ce workspace.", de: "Aktuelle Verfügbarkeit des Speicherdienstes für diesen Workspace.", zh: "此工作区所使用存储服务的当前可用性。" })}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className={cx(uiCardMutedClass, "px-4 py-3")}>
                <div className="flex items-center justify-between gap-3">
                  <p className={uiLabelClass}>{t({ en: "Backend status", fr: "Statut du backend", de: "Backend-Status", zh: "后端状态" })}</p>
                  {!healthLoading ? (
                    <UiBadge tone={backendStatusTone(backendStatus)} className="px-2 py-0 text-[11px] leading-5">
                      {backendStatusLabel(backendStatus, t)}
                    </UiBadge>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {!healthLoading ? <WorkspaceStatusDot status={backendStatus} className="h-2.5 w-2.5 shrink-0" /> : null}
                  <p className={cx("ui-subtitle", uiTitleTextClass)}>{healthLoading ? "..." : backendStatusLabel(backendStatus, t)}</p>
                </div>
                <p className={cx("ui-caption", uiMutedTextClass)}>
                  {healthLoading ? t({ en: "Checking storage service status...", fr: "Vérification du statut du service de stockage...", de: "Status des Speicherdienstes wird geprüft...", zh: "正在检查存储服务状态…" }) : backendStatusHint(backendStatus, t)}
                </p>
              </div>
              <MetricsSnapshotCard
                label={t({ en: "Current issues", fr: "Incidents en cours", de: "Aktuelle Probleme", zh: "当前问题" })}
                value={formatCompactNumber(backendIssueCount)}
                hint={t({ en: "Down or degraded checks", fr: "Contrôles en panne ou dégradés", de: "Ausgefallene oder beeinträchtigte Prüfungen", zh: "故障或性能下降的检查项" })}
                loading={healthLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Last check", fr: "Dernier contrôle", de: "Letzte Prüfung", zh: "上次检查" })}
                value={formatBackendTimestamp(health?.generated_at, locale)}
                hint={t({ en: "Latest backend reading", fr: "Dernière mesure du backend", de: "Letzte Backend-Messung", zh: "最新后端读数" })}
                loading={healthLoading}
              />
            </div>
          </MetricsCard>
        </div>
      ) : null}

      {activeTab === "storage-spaces" ? (
        <MetricsCard
          title={t({ en: "Space breakdown", fr: "Répartition par espace", de: "Bereichsaufteilung", zh: "空间用量明细" })}
          description={t({ en: "See which spaces use the most room or contain the most files.", fr: "Voyez les espaces qui utilisent le plus d'espace ou contiennent le plus de fichiers.", de: "Sehen Sie, welche Bereiche den meisten Platz nutzen oder die meisten Dateien enthalten.", zh: "查看哪些空间占用容量最多或包含文件最多。" })}
        >
          {usageError ? (
            <PageBanner tone="warning">{t({ en: "Per-space usage metrics are unavailable. Stored Storage Space metadata is still shown when present.", fr: "Les métriques par espace sont indisponibles. Les métadonnées d'espace stockées restent affichées si elles existent.", de: "Nutzungsmetriken pro Bereich sind nicht verfügbar. Gespeicherte Metadaten werden weiterhin angezeigt, wenn vorhanden.", zh: "无法获取各空间的用量指标。如果存在已保存的存储空间元数据，仍会显示。" })}</PageBanner>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            <UsageBreakdown
              title={t({ en: "Spaces by stored data", fr: "Espaces par données stockées", de: "Bereiche nach gespeicherten Daten", zh: "按存储数据量排列空间" })}
              loading={usageLoading}
              metric="bytes"
              items={storageSpaceItems}
              emptyMessage={t({ en: "No per-space storage data yet.", fr: "Aucune donnée de stockage par espace pour le moment.", de: "Noch keine Speicherdaten pro Bereich.", zh: "暂无各空间存储数据。" })}
              objectUnitLabel={t({ en: "files", fr: "fichiers", de: "Dateien", zh: "个文件" })}
            />
            <UsageBreakdown
              title={t({ en: "Spaces by files", fr: "Espaces par fichiers", de: "Bereiche nach Dateien", zh: "按文件数排列空间" })}
              loading={usageLoading}
              metric="objects"
              items={storageSpaceItems}
              emptyMessage={t({ en: "No per-space file counts yet.", fr: "Aucun nombre de fichiers par espace pour le moment.", de: "Noch keine Dateizahlen pro Bereich.", zh: "暂无各空间文件数量。" })}
              objectUnitLabel={t({ en: "files", fr: "fichiers", de: "Dateien", zh: "个文件" })}
            />
          </div>
        </MetricsCard>
      ) : null}

      {activeTab === "usage-composition" ? (
        <BucketUsageStatsAggregateCard
          title={t({ en: "File types and size mix", fr: "Types et tailles de fichiers", de: "Dateitypen und Größenmix", zh: "文件类型与大小组成" })}
          description={t({ en: "Latest breakdown of visible files by type, size, and storage class when collection is available.", fr: "Dernière répartition des fichiers visibles par type, taille et classe de stockage lorsque la collecte est disponible.", de: "Aktuelle Aufteilung sichtbarer Dateien nach Typ, Größe und Speicherklasse, wenn die Erfassung verfügbar ist.", zh: "在采集可用时，显示可见文件按类型、大小和存储类别划分的最新明细。" })}
          aggregate={usageStatsAggregate}
          loading={usageStatsLoading}
          error={usageStatsError}
          recalculateLabel={t({ en: "Recalculate", fr: "Recalculer", de: "Neu berechnen", zh: "重新计算" })}
          coverageItemLabel={t({ en: "spaces", fr: "espaces", de: "Bereiche", zh: "个空间" })}
          emptyTitle={t({ en: "No file-type breakdown yet.", fr: "Aucune répartition par type pour le moment.", de: "Noch keine Dateityp-Aufteilung.", zh: "暂无文件类型明细。" })}
          emptyDescription={t({ en: "The platform prepares this view automatically when file composition collection is available.", fr: "La plateforme prépare cette vue automatiquement lorsque la collecte de composition est disponible.", de: "Die Plattform erstellt diese Ansicht automatisch, wenn die Dateizusammensetzung erfasst wird.", zh: "文件组成采集可用时，平台会自动准备此视图。" })}
          compositionLabels={portalUsageCompositionLabels(t)}
        />
      ) : null}

      {activeTab === "usage-history" ? (
        <UsageHistoryTrendsSection
          trends={usageHistoryTrends}
          window={usageHistoryWindow}
          onWindowChange={setUsageHistoryWindow}
          loading={usageHistoryLoading}
          error={usageHistoryError}
          title={t({ en: "Growth over time", fr: "Évolution dans le temps", de: "Entwicklung im Zeitverlauf", zh: "增长趋势" })}
          description={t({ en: "Stored snapshots that show whether files and storage are growing.", fr: "Instantanés stockés qui montrent si les fichiers et le stockage augmentent.", de: "Gespeicherte Momentaufnahmen, die zeigen, ob Dateien und Speicher wachsen.", zh: "通过已存储快照查看文件数量与存储用量是否增长。" })}
          labels={{
            unavailableDescription: t({ en: "Storage trend snapshots over time.", fr: "Instantanés d'évolution du stockage dans le temps.", de: "Speichertrend-Momentaufnahmen im Zeitverlauf.", zh: "存储趋势随时间变化的快照。" }),
            latestStorage: t({ en: "Latest storage", fr: "Dernier stockage", de: "Neuester Speicher", zh: "最新存储用量" }),
            latestStorageHint: t({ en: "Latest reading", fr: "Dernière mesure", de: "Neuester Messwert", zh: "最新读数" }),
            latestObjects: t({ en: "Latest files", fr: "Derniers fichiers", de: "Neueste Dateien", zh: "最新文件数量" }),
            latestObjectsHint: t({ en: "Visible spaces", fr: "Espaces visibles", de: "Sichtbare Bereiche", zh: "可见空间" }),
            maxQuotaRatio: t({ en: "Highest quota use", fr: "Plus forte utilisation du quota", de: "Höchste Quotennutzung", zh: "最高配额使用率" }),
            maxQuotaHint: t({ en: "Peak point", fr: "Point le plus haut", de: "Höchstwert", zh: "峰值" }),
            snapshots: t({ en: "Readings", fr: "Mesures", de: "Messwerte", zh: "读数" }),
            snapshotsHint: t({ en: "Collected periods", fr: "Périodes collectées", de: "Erfasste Zeiträume", zh: "已采集时段" }),
            storageChartTitle: t({ en: "Storage growth", fr: "Croissance du stockage", de: "Speicherwachstum", zh: "存储增长" }),
            storageChartSubtitle: t({ en: "Stored data over time", fr: "Données stockées dans le temps", de: "Gespeicherte Daten im Zeitverlauf", zh: "存储数据随时间变化" }),
            inventoryChartTitle: t({ en: "Files & spaces", fr: "Fichiers et espaces", de: "Dateien & Bereiche", zh: "文件与空间" }),
            inventoryChartSubtitle: t({ en: "File counts over time", fr: "Nombre de fichiers dans le temps", de: "Dateizahlen im Zeitverlauf", zh: "文件数量随时间变化" }),
            storageLineName: t({ en: "Storage", fr: "Stockage", de: "Speicher", zh: "存储" }),
            objectLineName: t({ en: "Files", fr: "Fichiers", de: "Dateien", zh: "文件" }),
            bucketLineName: t({ en: "Spaces", fr: "Espaces", de: "Bereiche", zh: "空间" }),
            emptyMessage: t({ en: "No storage trend readings for this window yet.", fr: "Aucune mesure d'évolution du stockage pour cette période.", de: "Noch keine Speichertrend-Messwerte für dieses Fenster.", zh: "此时间范围内暂无存储趋势读数。" }),
          }}
        />
      ) : null}

      {activeTab === "traffic" ? (
        <MetricsTrafficOverview
          title={t({ en: "Transfer activity", fr: "Activité de transfert", de: "Übertragungsaktivität", zh: "传输活动" })}
          traffic={traffic}
          window={trafficWindow}
          onWindowChange={setTrafficWindow}
          loading={trafficLoading}
          error={trafficError}
          showEmpty={trafficMissing}
          description={t({ en: "How files moved in and out of this workspace.", fr: "Comment les fichiers sont entrés et sortis de ce workspace.", de: "Wie Dateien in diesen Workspace hinein- und hinausbewegt wurden.", zh: "此工作区的文件传入和传出情况。" })}
          bucketRankingTitle={t({ en: "Most active Storage Spaces", fr: "Espaces de stockage les plus actifs", de: "Aktivste Speicherbereiche", zh: "最活跃的存储空间" })}
          userRankingTitle={portalActivitySourceTitle(t)}
          bucketRankingLabels={bucketRankingLabels}
          userRankingLabels={userRankingLabels}
          labels={portalTrafficLabels(t)}
        />
      ) : null}

      {activeTab === "billing" ? (
        <MetricsCard
          title={t({ en: "Monthly cost", fr: "Coût mensuel", de: "Monatliche Kosten", zh: "月度费用" })}
          description={t({ en: "Estimated storage and transfer cost for the selected month.", fr: "Coût estimé du stockage et des transferts pour le mois sélectionné.", de: "Geschätzte Speicher- und Transferkosten für den ausgewählten Monat.", zh: "所选月份的预计存储和传输费用。" })}
          actions={billingMonthControl}
        >
          {billingLoading && !billing ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricsSnapshotCard label={t({ en: "Estimated cost", fr: "Coût estimé", de: "Geschätzte Kosten", zh: "预计费用" })} value="-" loading />
              <MetricsSnapshotCard label={t({ en: "Average storage", fr: "Stockage moyen", de: "Durchschnittlicher Speicher", zh: "平均存储用量" })} value="-" loading />
              <MetricsSnapshotCard label={t({ en: "File actions", fr: "Actions fichier", de: "Dateiaktionen", zh: "文件操作" })} value="-" loading />
              <MetricsSnapshotCard label={t({ en: "Coverage", fr: "Couverture", de: "Abdeckung", zh: "覆盖范围" })} value="-" loading />
            </div>
          ) : billing ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricsSnapshotCard
                  label={t({ en: "Estimated cost", fr: "Coût estimé", de: "Geschätzte Kosten", zh: "预计费用" })}
                  value={formatPortalCurrency(cost?.total_cost, cost?.currency, locale)}
                  hint={cost?.currency ?? t({ en: "Billing currency", fr: "Devise de facturation", de: "Abrechnungswährung", zh: "计费币种" })}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label={t({ en: "Average storage", fr: "Stockage moyen", de: "Durchschnittlicher Speicher", zh: "平均存储用量" })}
                  value={formatBytes(billing.storage.avg_bytes)}
                  hint={t({ en: `${formatCompactNumber(billing.storage.total_objects)} files`, fr: `${formatCompactNumber(billing.storage.total_objects)} fichiers`, de: `${formatCompactNumber(billing.storage.total_objects)} Dateien`, zh: `${formatCompactNumber(billing.storage.total_objects)} 个文件` })}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label={t({ en: "File actions", fr: "Actions fichier", de: "Dateiaktionen", zh: "文件操作" })}
                  value={formatCompactNumber(billingUsage?.ops_total)}
                  hint={t({ en: `${formatBytes(billingUsage?.bytes_out)} downloaded, ${formatBytes(billingUsage?.bytes_in)} uploaded`, fr: `${formatBytes(billingUsage?.bytes_out)} téléchargés, ${formatBytes(billingUsage?.bytes_in)} envoyés`, de: `${formatBytes(billingUsage?.bytes_out)} heruntergeladen, ${formatBytes(billingUsage?.bytes_in)} hochgeladen`, zh: `已下载 ${formatBytes(billingUsage?.bytes_out)}，已上传 ${formatBytes(billingUsage?.bytes_in)}` })}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label={t({ en: "Coverage", fr: "Couverture", de: "Abdeckung", zh: "覆盖范围" })}
                  value={billingCoverage ? t({ en: `${billingCoverage.days_collected}/${billingCoverage.days_in_month} days`, fr: `${billingCoverage.days_collected}/${billingCoverage.days_in_month} jours`, de: `${billingCoverage.days_collected}/${billingCoverage.days_in_month} Tage`, zh: `${billingCoverage.days_collected}/${billingCoverage.days_in_month} 天` }) : "-"}
                  hint={billingCoverage ? formatPercentage(billingCoverage.coverage_ratio * 100) : t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar", zh: "不可用" })}
                  loading={billingLoading}
                />
              </div>
              <div className={cx(uiCardMutedClass, "px-4 py-3")}>
                <p className={cx("ui-caption font-semibold", uiMutedTextClass)}>{t({ en: "Rate card", fr: "Grille tarifaire", de: "Tarifkarte", zh: "费率表" })}</p>
                <p className={cx("ui-body font-semibold", uiTitleTextClass)}>
                  {cost?.rate_card_name ? cost.rate_card_name : t({ en: "No rate card attached.", fr: "Aucune grille tarifaire associée.", de: "Keine Tarifkarte zugeordnet.", zh: "未关联费率表。" })}
                </p>
              </div>
            </>
          ) : (
            <MetricsEmptyState>
              {billingUnavailable
                ? billingError ?? t({ en: "Billing source is disabled or unavailable.", fr: "La source de facturation est désactivée ou indisponible.", de: "Abrechnungsquelle ist deaktiviert oder nicht verfügbar.", zh: "计费来源已禁用或不可用。" })
                : t({ en: "No billing source data available.", fr: "Aucune donnée de source de facturation disponible.", de: "Keine Daten aus der Abrechnungsquelle verfügbar.", zh: "没有可用的计费来源数据。" })}
            </MetricsEmptyState>
          )}
        </MetricsCard>
      ) : null}
      </PortalTabPanel>
    </PageShell>
  );
}
