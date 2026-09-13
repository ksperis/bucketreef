/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HealthCheckStatus } from "../../api/healthchecks";
import type { PortalUsageStorageSpace } from "../../api/portalUsage";
import type { ManagerUsageTrendBaseline } from "../../api/stats";
import PageEmptyState from "../../components/PageEmptyState";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import {
  buildWorkspaceStorageEvolutionPoints,
  WorkspaceDashboardCard,
  WorkspaceDashboardEmptyState,
  WorkspaceDashboardIconBubble as IconBubble,
  WorkspaceDashboardKpiRow as KpiRow,
  WorkspaceDashboardProgressBar as ProgressBar,
  WorkspaceDashboardStorageOverview,
  WorkspaceDashboardAction,
  WorkspaceDashboardActionLink,
  WorkspaceDashboardLinkRow,
  WorkspaceStatusDot,
  type WorkspaceDashboardMetric,
  type WorkspaceDashboardTone,
} from "../../components/WorkspaceDashboardKit";
import {
  buildWorkspaceDashboardKpis,
  formatWorkspaceProjectedFull,
  formatWorkspaceSignedBytesDelta,
  formatWorkspaceSignedTrend,
  selectWorkspaceTrafficTrend,
  workspaceStorageGrowthDelta,
  workspaceTrafficTotalBytes,
} from "../../components/workspaceDashboardKpis";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import UiBadge from "../../components/ui/UiBadge";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n, type I18nMessage } from "../../i18n";
import { formatBytes, formatPercentage, formatSpacedCompactNumber } from "../../utils/format";
import {
  BucketCollectionIcon,
  BucketIcon,
  FileIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  OpenIcon,
  TransferIcon,
} from "../browser/browserIcons";
import { storageSpacePath, type PortalWorkspaceSpace } from "./portalWorkspaceModel";
import {
  portalRoleTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import {
  portalRoleLabel,
  portalTrendPeriodLabel,
} from "./portalI18n";

type StorageSpaceRow = {
  id: string;
  name: string;
  usedBytes?: number | null;
  objectCount?: number | null;
  quotaBytes?: number | null;
  role?: PortalWorkspaceSpace["role"];
  status?: PortalWorkspaceSpace["status"];
  space?: PortalWorkspaceSpace;
  isOther?: boolean;
  percent: number | null;
};

type ActivityRow = {
  id: string;
  label: string;
  detail: string;
  time: string;
  tone: WorkspaceDashboardTone;
  icon: ReactNode;
};

type QuickLink = {
  label: string;
  detail: string;
  to: string;
  tone: WorkspaceDashboardTone;
  icon: ReactNode;
};

const TOP_STORAGE_SPACES_LIMIT = 4;

function percent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.max(0, Math.min(100, (used / quota) * 100));
}

function alertTone(tone: string) {
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "info") return "primary";
  return "neutral";
}

function workspaceHealthStatus(
  health: ReturnType<typeof usePortalWorkspaceData>["health"]
): HealthCheckStatus {
  if (!health || health.endpoint_count <= 0) return "unknown";
  const statuses = health.endpoints.map((endpoint) => endpoint.is_stale === true ? "unknown" : endpoint.status);
  if (statuses.includes("down")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("up")) return "up";
  return "unknown";
}

type TFunction = (message: I18nMessage) => string;

function workspaceHealthLabel(status: HealthCheckStatus, t: TFunction): string {
  if (status === "up") return t({ en: "Storage services operational", fr: "Services de stockage opérationnels", de: "Speicherdienste betriebsbereit", zh: "存储服务运行正常" });
  if (status === "degraded") return t({ en: "Storage services degraded", fr: "Services de stockage dégradés", de: "Speicherdienste beeinträchtigt", zh: "存储服务性能下降" });
  if (status === "down") return t({ en: "Storage service availability issue", fr: "Problème de disponibilité du service de stockage", de: "Verfügbarkeitsproblem des Speicherdienstes", zh: "存储服务可用性异常" });
  return t({ en: "Storage service status unavailable", fr: "Statut du service de stockage indisponible", de: "Status des Speicherdienstes nicht verfügbar", zh: "无法获取存储服务状态" });
}

function localizeTrendBaseline<T extends ManagerUsageTrendBaseline | null | undefined>(baseline: T, t: TFunction): T {
  if (!baseline) return baseline;
  return {
    ...baseline,
    label: portalTrendPeriodLabel(baseline.label, t),
  } as T;
}

function externalToolAccessDetail(count: number | null | undefined, t: TFunction): string {
  if (count == null) return "";
  return t({
    en: `${count} active external tool access${count === 1 ? "" : "es"}`,
    fr: `${count} accès outil externe actif${count > 1 ? "s" : ""}`,
    de: `${count} aktive${count === 1 ? "r" : ""} externe${count === 1 ? "r" : ""} Werkzeugzugriff${count === 1 ? "" : "e"}`,
    zh: `${count} 项已启用的外部工具访问凭据`,
  });
}

function hasOtherUsage(other?: PortalUsageStorageSpace | null): other is PortalUsageStorageSpace {
  return Boolean(other && ((other.used_bytes ?? 0) > 0 || (other.object_count ?? 0) > 0));
}

function buildStorageRows(spaces: PortalWorkspaceSpace[], other?: PortalUsageStorageSpace | null): StorageSpaceRow[] {
  const includeOther = hasOtherUsage(other);
  const namedLimit = includeOther ? TOP_STORAGE_SPACES_LIMIT - 1 : TOP_STORAGE_SPACES_LIMIT;
  const namedRows = [...spaces]
    .sort((left, right) => (right.usedBytes ?? 0) - (left.usedBytes ?? 0))
    .slice(0, namedLimit)
    .map((space) => ({
      id: space.id,
      name: space.name,
      usedBytes: space.usedBytes,
      objectCount: space.objectCount,
      quotaBytes: space.quotaBytes,
      role: space.role,
      status: space.status,
      space,
    }));
  const rows: Omit<StorageSpaceRow, "percent">[] = includeOther
    ? [
        ...namedRows,
        {
          id: other.id,
          name: other.name,
          usedBytes: other.used_bytes,
          objectCount: other.object_count,
          isOther: true,
        },
      ]
    : namedRows;
  const maxBytes = Math.max(...rows.map((row) => row.usedBytes ?? 0), 1);
  return rows.map((row) => {
    const quotaPercent = percent(row.usedBytes, row.quotaBytes);
    const rankingPercent = row.usedBytes == null ? null : Math.max(4, ((row.usedBytes ?? 0) / maxBytes) * 100);
    return { ...row, percent: quotaPercent ?? rankingPercent };
  });
}

function buildActivityRows(workspaceActivity: ReturnType<typeof usePortalWorkspaceData>["workspace"]["activity"], t: TFunction): ActivityRow[] {
  return workspaceActivity.slice(0, 5).map((item) => {
    const action = item.action.toLowerCase();
    const isShare = action.includes("share") || action.includes("partage") || action.includes("freigabe") || action.includes("link");
    return {
      id: item.id,
      label: t({ en: `${item.actor} ${action} ${item.target}`, fr: `${item.actor} ${action} ${item.target}`, de: `${item.actor} ${action} ${item.target}`, zh: `${item.actor} ${action} ${item.target}` }),
      detail: item.spaceName ?? item.ipAddress,
      time: item.timeLabel,
      tone: isShare ? "violet" : "blue",
      icon: isShare ? <LinkIcon className="h-4 w-4" /> : <HistoryIcon className="h-4 w-4" />,
    };
  });
}

function StorageOverviewCard({
  usedBytes,
  quotaBytes,
  trendBaseline,
  referenceDate,
}: {
  usedBytes: number | null | undefined;
  quotaBytes: number | null | undefined;
  trendBaseline?: ManagerUsageTrendBaseline | null;
  referenceDate?: string | Date | null;
}) {
  const { t } = useI18n();
  const usagePercent = percent(usedBytes, quotaBytes);
  const storageTrendPoints = useMemo(
    () => buildWorkspaceStorageEvolutionPoints(usedBytes, trendBaseline, referenceDate),
    [referenceDate, trendBaseline, usedBytes]
  );
  const growthDelta = workspaceStorageGrowthDelta(usedBytes, trendBaseline);
  const growthToneClass =
    growthDelta == null || growthDelta === 0
      ? "text-[var(--ui-text-muted)]"
      : growthDelta > 0
        ? "text-emerald-600 dark:text-emerald-300"
        : "text-rose-600 dark:text-rose-300";
  const growthLabel = trendBaseline?.label
    ? t({ en: `Growth (${trendBaseline.label})`, fr: `Croissance (${trendBaseline.label})`, de: `Wachstum (${trendBaseline.label})`, zh: `增长（${trendBaseline.label}）` })
    : t({ en: "Growth", fr: "Croissance", de: "Wachstum", zh: "增长" });
  const projectedFull = formatWorkspaceProjectedFull(usedBytes, quotaBytes, trendBaseline, {
    full: t({ en: "Full", fr: "Plein", de: "Voll", zh: "已满" }),
    stable: t({ en: "Stable", fr: "Stable", de: "Stabil", zh: "稳定" }),
    days: (value) => t({ en: `~${value} days`, fr: `~${value} jours`, de: `~${value} Tage`, zh: `约 ${value} 天` }),
    months: (value) => t({ en: `~${value} months`, fr: `~${value} mois`, de: `~${value} Monate`, zh: `约 ${value} 个月` }),
    years: (value) => t({ en: `~${value} years`, fr: `~${value} ans`, de: `~${value} Jahre`, zh: `约 ${value} 年` }),
  });
  return (
    <WorkspaceDashboardStorageOverview
      title={t({ en: "Storage overview", fr: "Vue du stockage", de: "Speicherübersicht", zh: "存储概览" })}
      action={<WorkspaceDashboardActionLink to="/portal/usage">{t({ en: "Usage analytics", fr: "Analyse d'utilisation", de: "Nutzungsanalyse", zh: "用量分析" })}<OpenIcon className="h-3.5 w-3.5" /></WorkspaceDashboardActionLink>}
      usedLabel={t({ en: "Storage Used", fr: "Stockage utilisé", de: "Genutzter Speicher", zh: "已用存储" })}
      usedValue={formatBytes(usedBytes)}
      quotaValue={quotaBytes != null ? formatBytes(quotaBytes) : undefined}
      percentage={usagePercent}
      percentageLabel={usagePercent == null ? "" : formatPercentage(usagePercent)}
      progressLabel={t({ en: "Portal storage quota usage", fr: "Utilisation du quota de stockage Portal", de: "Portal-Speicherquotennutzung", zh: "Portal 存储配额使用量" })}
      quotaFallback={<p className="mt-3 ui-dashboard-note">{t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar", zh: "无法获取配额" })}</p>}
      chart={{
        points: storageTrendPoints,
        emptyLabel: t({ en: "Storage usage unavailable.", fr: "Utilisation du stockage indisponible.", de: "Speichernutzung nicht verfügbar.", zh: "无法获取存储用量。" }),
        chartLabel: t({ en: "Storage evolution chart", fr: "Graphique d'évolution du stockage", de: "Diagramm zur Speicherentwicklung", zh: "存储变化趋势图" }),
      }}
      growth={{ label: growthLabel, value: formatWorkspaceSignedBytesDelta(growthDelta), className: growthToneClass }}
      projection={{ label: t({ en: "Projected full", fr: "Saturation estimée", de: "Voraussichtlich voll", zh: "预计用满时间" }), value: projectedFull, adornment: <InfoIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ui-text-muted)]" /> }}
    />
  );
}

function TopStorageSpacesCard({ rows }: { rows: StorageSpaceRow[] }) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard presentation="compact" wrapHeading
      title={t({ en: "Top storage spaces", fr: "Principaux espaces de stockage", de: "Größte Speicherbereiche", zh: "用量最多的存储空间" })}
      action={
        <WorkspaceDashboardActionLink to="/portal/storage-spaces">
          {t({ en: "View all spaces", fr: "Voir tous les espaces", de: "Alle Bereiche anzeigen", zh: "查看所有空间" })}
          <OpenIcon className="h-3.5 w-3.5" />
        </WorkspaceDashboardActionLink>
      }
    >
      {rows.length === 0 ? (
        <WorkspaceDashboardEmptyState>{t({ en: "No Storage Spaces to display.", fr: "Aucun espace de stockage à afficher.", de: "Keine Speicherbereiche zum Anzeigen.", zh: "没有可显示的存储空间。" })}</WorkspaceDashboardEmptyState>
      ) : (
        <div className="space-y-2">
          <div className="ui-dashboard-ranking-row ui-dashboard-note">
            <span>{t({ en: "Storage space", fr: "Espace de stockage", de: "Speicherbereich", zh: "存储空间" })}</span>
            <span>{t({ en: "Storage", fr: "Stockage", de: "Speicher", zh: "存储" })}</span>
            <span className="text-right">{t({ en: "Files", fr: "Fichiers", de: "Dateien", zh: "文件" })}</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="ui-dashboard-ranking-row"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <IconBubble tone="emerald" className="h-7 w-7 rounded-md">
                    <BucketIcon className="h-4 w-4" />
                  </IconBubble>
                  {row.space && !row.isOther ? (
                    <Link to={storageSpacePath(row.space)} className="ui-dashboard-text-link ui-dashboard-label hover:text-primary">
                      {row.name}
                    </Link>
                  ) : (
                    <span className="ui-dashboard-label">{row.name}</span>
                  )}
                </div>
                {row.space && row.role ? (
                  <div className="mt-1 flex flex-wrap gap-1.5 pl-9">
                    <UiBadge tone={portalRoleTone(row.role)} className="ui-dashboard-badge">
                      {portalRoleLabel(row.role, t)}
                    </UiBadge>
                  </div>
                ) : null}
              </div>
              <div className="ui-dashboard-ranking-storage">
                <span className="ui-dashboard-label">{formatBytes(row.usedBytes)}</span>
                {row.percent != null ? <ProgressBar value={row.percent} className="h-1.5" /> : <span className="h-1.5" />}
              </div>
              <span className="text-right ui-dashboard-label">{formatSpacedCompactNumber(row.objectCount)}</span>
            </div>
          ))}
        </div>
      )}
    </WorkspaceDashboardCard>
  );
}

function RecentActivityCard({ rows }: { rows: ActivityRow[] }) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard presentation="compact" wrapHeading
      title={t({ en: "Recent activity", fr: "Activité récente", de: "Letzte Aktivität", zh: "近期活动" })}
      action={<WorkspaceDashboardActionLink to="/portal/history">{t({ en: "View all", fr: "Tout voir", de: "Alle anzeigen", zh: "查看全部" })}</WorkspaceDashboardActionLink>}
    >
      {rows.length === 0 ? (
        <WorkspaceDashboardEmptyState>{t({ en: "No recent activity.", fr: "Aucune activité récente.", de: "Keine letzte Aktivität.", zh: "近期没有活动。" })}</WorkspaceDashboardEmptyState>
      ) : (
        <div className="space-y-2">
          {rows.map((activity) => (
            <div key={activity.id} className="ui-dashboard-activity-row">
              <div className="flex min-w-0 items-start gap-2.5">
                <IconBubble tone={activity.tone} className="h-7 w-7 rounded-md">
                  {activity.icon}
                </IconBubble>
                <div className="min-w-0">
                  <p className="ui-dashboard-label">{activity.label}</p>
                  <p className={cx("mt-0.5 ui-dashboard-note", uiMutedTextClass)}>{activity.detail}</p>
                </div>
              </div>
              <span className={cx("shrink-0 ui-caption", uiMutedTextClass)}>{activity.time}</span>
            </div>
          ))}
        </div>
      )}
    </WorkspaceDashboardCard>
  );
}

function AlertsCard({
  alerts,
  healthStatus,
}: {
  alerts: ReturnType<typeof usePortalWorkspaceData>["workspace"]["alerts"];
  healthStatus: HealthCheckStatus;
}) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard presentation="compact" wrapHeading title={t({ en: "Alerts & service status", fr: "Alertes et statut du service", de: "Warnungen und Dienststatus", zh: "告警与服务状态" })}>
      <div className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2.5">
        <div className="ui-dashboard-panel-heading">
          <p className="flex min-w-0 items-center gap-2 ui-dashboard-label">
            <WorkspaceStatusDot status={healthStatus} />
            <span className="min-w-0 break-words">{workspaceHealthLabel(healthStatus, t)}</span>
          </p>
          <UiBadge
            tone={healthStatus === "up" ? "success" : healthStatus === "down" ? "danger" : healthStatus === "degraded" ? "warning" : "neutral"}
            className="ui-dashboard-badge"
          >
            {healthStatus === "up"
              ? t({ en: "Operational", fr: "Opérationnel", de: "Betriebsbereit", zh: "正常" })
              : healthStatus === "degraded"
                ? t({ en: "Degraded", fr: "Dégradé", de: "Beeinträchtigt", zh: "性能下降" })
                : healthStatus === "down"
                  ? t({ en: "Issue", fr: "Incident", de: "Problem", zh: "异常" })
                  : t({ en: "Unknown", fr: "Inconnu", de: "Unbekannt", zh: "未知" })}
          </UiBadge>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {alerts.length === 0 ? (
          <WorkspaceDashboardEmptyState>{t({ en: "No alerts to display.", fr: "Aucune alerte à afficher.", de: "Keine Warnungen zum Anzeigen.", zh: "没有可显示的告警。" })}</WorkspaceDashboardEmptyState>
        ) : (
          alerts.slice(0, 4).map((alert) => (
            <div key={alert.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--ui-border-soft)] px-3 py-2">
              <div className="min-w-0">
                <p className="ui-dashboard-label">{alert.title}</p>
                <p className={cx("mt-0.5 ui-dashboard-note", uiMutedTextClass)}>{alert.description}</p>
              </div>
              <UiBadge tone={alertTone(alert.tone)} className="ui-dashboard-badge">
                {alert.severityLabel ?? t({ en: "Info", fr: "Info", de: "Info", zh: "信息" })}
              </UiBadge>
            </div>
          ))
        )}
      </div>
    </WorkspaceDashboardCard>
  );
}

function QuickLinksCard({ links }: { links: QuickLink[] }) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard presentation="compact" wrapHeading title={t({ en: "Quick links", fr: "Raccourcis", de: "Schnellzugriffe", zh: "快捷链接" })}>
      <div className="grid gap-2">
        {links.map((link) => (
          <WorkspaceDashboardLinkRow
            key={link.label}
            to={link.to}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <IconBubble tone={link.tone} className="h-7 w-7 rounded-md">
                {link.icon}
              </IconBubble>
              <span className="min-w-0">
                <span className="block ui-dashboard-label">{link.label}</span>
                <span className={cx("block ui-dashboard-note", uiMutedTextClass)}>{link.detail}</span>
              </span>
            </span>
            <OpenIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ui-text-muted)]" />
          </WorkspaceDashboardLinkRow>
        ))}
      </div>
    </WorkspaceDashboardCard>
  );
}

function PortalOnboardingDashboard() {
  const { t } = useI18n();
  return (
    <div className="space-y-3" data-testid="portal-dashboard-onboarding">
      <PageHeader
        title={t({ en: "Portal dashboard", fr: "Tableau de bord Portal", de: "Portal-Dashboard", zh: "Portal 仪表盘" })}
        description={t({
          en: "Start by creating a Storage Space, then add files from that space.",
          fr: "Commencez par créer un espace de stockage, puis ajoutez des fichiers depuis cet espace.",
          de: "Erstellen Sie zuerst einen Speicherbereich und fügen Sie dann Dateien aus diesem Bereich hinzu.",
          zh: "先创建存储空间，再从该空间添加文件。",
        })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Dashboard", fr: "Tableau de bord", de: "Dashboard", zh: "仪表盘" }) })}
      />
      <PageEmptyState
        eyebrow={t({ en: "Start here", fr: "Commencer ici", de: "Hier starten", zh: "从这里开始" })}
        title={t({ en: "Set up your first space", fr: "Configurez votre premier espace", de: "Richten Sie Ihren ersten Bereich ein", zh: "设置你的第一个空间" })}
        description={t({
          en: "A space keeps files, folders, and collaborators together. After it exists, open it to upload files.",
          fr: "Un espace regroupe les fichiers, dossiers et collaborateurs. Une fois créé, ouvrez-le pour ajouter des fichiers.",
          de: "Ein Bereich hält Dateien, Ordner und Mitwirkende zusammen. Danach öffnen Sie ihn, um Dateien hochzuladen.",
          zh: "空间用于组织文件、文件夹和协作者。创建后，打开空间即可上传文件。",
        })}
        primaryAction={{
          label: t({ en: "Open Storage Spaces", fr: "Ouvrir les espaces de stockage", de: "Speicherbereiche öffnen", zh: "打开存储空间" }),
          to: "/portal/storage-spaces",
        }}
      />
    </div>
  );
}

export default function PortalDashboard() {
  const { t } = useI18n();
  const {
    workspace,
    health,
    healthAlerts,
    hasAccountContext,
    accountError,
    accountLoading,
    stateLoading,
    storageSpacesLoading,
    stateError,
    storageSpacesError,
    traffic,
    trafficByWindow,
    usageTrends,
    trafficLoading,
    trafficError,
    usage,
    collaborators,
    collaboratorsError,
    refreshWorkspaceData,
  } = usePortalWorkspaceData({
    includeUsage: true,
    includeActivity: true,
    includeCollaborators: true,
    includeAlerts: true,
    includeTraffic: true,
    includeTrafficTrend: true,
    includeHealth: true,
    includeUsageTrends: true,
  });

  const storageRows = useMemo(() => buildStorageRows(workspace.spaces, usage?.other_storage_space), [usage?.other_storage_space, workspace.spaces]);
  const activityRows = useMemo(() => buildActivityRows(workspace.activity, t), [t, workspace.activity]);
  const currentTraffic = trafficByWindow.day ?? traffic;
  const trafficTrend = useMemo(() => {
    const selection = selectWorkspaceTrafficTrend(trafficByWindow);
    return selection ? { ...selection, label: portalTrendPeriodLabel(selection.label, t) } : null;
  }, [t, trafficByWindow]);
  const storageTrendBaseline = useMemo(() => localizeTrendBaseline(usageTrends?.storage ?? null, t), [t, usageTrends?.storage]);
  const bucketsTrendBaseline = useMemo(() => localizeTrendBaseline(usageTrends?.buckets ?? null, t), [t, usageTrends?.buckets]);
  const objectsTrendBaseline = useMemo(() => localizeTrendBaseline(usageTrends?.objects ?? null, t), [t, usageTrends?.objects]);
  const collaboratorTrendBaseline = collaborators?.summary.trend
    ? { ...collaborators.summary.trend, label: portalTrendPeriodLabel(collaborators.summary.trend.label, t) }
    : null;
  const healthStatus = workspaceHealthStatus(health);
  const alerts = (workspace.alerts.length > 0 ? workspace.alerts : healthAlerts).slice(0, 4);
  const activeSpaces = workspace.spaces.filter((space) => space.status !== "Archived").length;
  const transferBytes = currentTraffic ? workspaceTrafficTotalBytes(currentTraffic) : null;
  const quotaOfLabel = t({ en: "of", fr: "sur", de: "von", zh: "总计" });
  const trendComparisonLabel = t({ en: "vs", fr: "par rapport à", de: "gegenüber", zh: "对比" });
  const baseMetrics = buildWorkspaceDashboardKpis({
    storage: {
      label: t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher", zh: "已用存储" }),
      usedBytes: workspace.usedBytes,
      quotaBytes: workspace.quotaBytes,
      quotaUnavailableDetail: t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar", zh: "无法获取配额" }),
      progressLabel: t({ en: "Portal storage quota usage", fr: "Utilisation du quota de stockage Portal", de: "Portal-Speicherquotennutzung", zh: "Portal 存储配额使用量" }),
      trendBaseline: storageTrendBaseline,
      quotaOfLabel,
      trendComparisonLabel,
      icon: <BucketIcon className="h-7 w-7" />,
      to: "/portal/usage",
    },
    spaces: {
      label: t({ en: "Storage spaces", fr: "Espaces de stockage", de: "Speicherbereiche", zh: "存储空间" }),
      value: workspace.spaces.length,
      quota: workspace.maxBuckets,
      unitLabel: t({ en: "spaces", fr: "espaces", de: "Bereiche", zh: "个空间" }),
      activeValue: activeSpaces,
      activeLabel: t({ en: "active", fr: "actifs", de: "aktiv", zh: "活跃" }),
      progressLabel: t({ en: "Storage spaces quota usage", fr: "Utilisation du quota d'espaces de stockage", de: "Speicherbereich-Quotennutzung", zh: "存储空间配额使用量" }),
      trendBaseline: bucketsTrendBaseline,
      trendBaselineValue: bucketsTrendBaseline?.bucket_count,
      quotaOfLabel,
      trendComparisonLabel,
      tone: "emerald",
      icon: <BucketCollectionIcon className="h-7 w-7" />,
      to: "/portal/storage-spaces",
    },
    objects: {
      label: t({ en: "Files", fr: "Fichiers", de: "Dateien", zh: "文件" }),
      value: workspace.usedObjects,
      quota: workspace.quotaObjects,
      unitLabel: t({ en: "files", fr: "fichiers", de: "Dateien", zh: "个文件" }),
      knownDetail: t({ en: "Tracked files", fr: "Fichiers suivis", de: "Erfasste Dateien", zh: "已统计文件" }),
      progressLabel: t({ en: "Portal file quota usage", fr: "Utilisation du quota de fichiers Portal", de: "Portal-Dateiquotennutzung", zh: "Portal 文件配额使用量" }),
      trendBaseline: objectsTrendBaseline,
      trendBaselineValue: objectsTrendBaseline?.used_objects,
      quotaOfLabel,
      trendComparisonLabel,
      tone: "violet",
      icon: <FileIcon className="h-7 w-7" />,
      to: "/portal/usage",
    },
    transfer: {
      label: t({ en: "Transfer", fr: "Transfert", de: "Übertragung", zh: "传输量" }),
      bytes: transferBytes,
      loading: trafficLoading,
      trendSelection: trafficError ? null : trafficTrend,
      detailLabel: t({ en: "Last 24h", fr: "Dernières 24 h", de: "Letzte 24 Std.", zh: "最近 24 小时" }),
      trendComparisonLabel,
      icon: <TransferIcon className="h-7 w-7" />,
      to: "/portal/usage",
      unavailableReason: trafficError,
    },
  });
  const collaboratorsMetric: WorkspaceDashboardMetric = {
    label: t({ en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende", zh: "协作者" }),
    value: formatSpacedCompactNumber(collaborators?.summary.collaborator_count),
    detail: externalToolAccessDetail(collaborators?.summary.external_access_key_count, t),
    trend: collaboratorsError
      ? undefined
      : formatWorkspaceSignedTrend(
          collaborators?.summary.collaborator_count,
          collaboratorTrendBaseline?.collaborator_count,
          collaboratorTrendBaseline?.label ?? "",
          formatSpacedCompactNumber,
          trendComparisonLabel
        ),
    tone: "violet",
    icon: <LinkIcon className="h-7 w-7" />,
    to: "/portal/shares",
    unavailableReason: collaboratorsError,
  };
  const metrics = [...baseMetrics, collaboratorsMetric];
  const quickLinks: QuickLink[] = [
    {
      label: t({ en: "Storage spaces", fr: "Espaces de stockage", de: "Speicherbereiche", zh: "存储空间" }),
      detail: t({ en: "Open workspace storage", fr: "Ouvrir le stockage de l'espace de travail", de: "Arbeitsbereichspeicher öffnen", zh: "打开工作区存储" }),
      to: "/portal/storage-spaces",
      tone: "emerald",
      icon: <BucketCollectionIcon className="h-4 w-4" />,
    },
    {
      label: t({ en: "Shares", fr: "Partages", de: "Freigaben", zh: "共享" }),
      detail: t({ en: "Review shared access", fr: "Voir les accès partagés", de: "Freigegebene Zugriffe prüfen", zh: "审查共享访问权限" }),
      to: "/portal/shares",
      tone: "violet",
      icon: <LinkIcon className="h-4 w-4" />,
    },
    {
      label: t({ en: "Usage analytics", fr: "Analyse d'utilisation", de: "Nutzungsanalyse", zh: "用量分析" }),
      detail: t({ en: "Inspect usage and traffic", fr: "Consulter l'utilisation et le trafic", de: "Nutzung und Traffic prüfen", zh: "查看用量与流量" }),
      to: "/portal/usage",
      tone: "blue",
      icon: <HistoryIcon className="h-4 w-4" />,
    },
  ];

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading: false,
    accountError,
    error: null,
    hasAccountContext,
    loadingMessage: t({ en: "Loading dashboard...", fr: "Chargement du tableau de bord...", de: "Dashboard wird geladen...", zh: "正在加载仪表盘…" }),
    noAccountMessage: t({ en: "Select an account to open the dashboard.", fr: "Sélectionnez un compte pour ouvrir le tableau de bord.", de: "Wählen Sie ein Konto aus, um das Dashboard zu öffnen.", zh: "请选择账户以打开仪表盘。" }),
  });
  if (pageState) return pageState;

  if (!storageSpacesLoading && !storageSpacesError && workspace.spaces.length === 0) {
    return <PortalOnboardingDashboard />;
  }

  return (
    <div className="ui-dashboard-compact" data-testid="portal-dashboard">
      <PageHeader
        title={t({ en: "Portal dashboard", fr: "Tableau de bord Portal", de: "Portal-Dashboard", zh: "Portal 仪表盘" })}
        description={t({ en: `Workspace overview for ${workspace.accountName}.`, fr: `Vue de l'espace de travail ${workspace.accountName}.`, de: `Arbeitsbereichsübersicht für ${workspace.accountName}.`, zh: `${workspace.accountName} 的工作区概览。` })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Dashboard", fr: "Tableau de bord", de: "Dashboard", zh: "仪表盘" }) })}
      />

      {(stateError || storageSpacesError) && (
        <PageBanner tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{storageSpacesError ?? stateError}</span>
            <WorkspaceDashboardAction
              type="button"
              onClick={refreshWorkspaceData}
              variant="secondary"
            >
              {t({ en: "Retry", fr: "Réessayer", de: "Erneut versuchen", zh: "重试" })}
            </WorkspaceDashboardAction>
          </div>
        </PageBanner>
      )}

      {(stateLoading || storageSpacesLoading) && (
        <PageBanner>
          {t({
            en: "Some dashboard data is still loading. Available sections remain usable.",
            fr: "Certaines données sont encore en cours de chargement. Les sections disponibles restent utilisables.",
            de: "Einige Dashboard-Daten werden noch geladen. Verfügbare Bereiche bleiben nutzbar.",
            zh: "部分仪表盘数据仍在加载。已加载的部分可继续使用。",
          })}
        </PageBanner>
      )}

      <KpiRow presentation="compact" metrics={metrics} columns={5} />

      <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-4">
          <StorageOverviewCard
            usedBytes={workspace.usedBytes}
            quotaBytes={workspace.quotaBytes}
            trendBaseline={storageTrendBaseline}
            referenceDate={currentTraffic?.end}
          />
        </div>
        <div className="min-w-0 xl:col-span-8">
          <TopStorageSpacesCard rows={storageRows} />
        </div>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        <RecentActivityCard rows={activityRows} />
        <AlertsCard alerts={alerts} healthStatus={healthStatus} />
        <QuickLinksCard links={quickLinks} />
      </div>
    </div>
  );
}
