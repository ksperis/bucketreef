/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { WorkspaceEndpointHealthOverviewResponse } from "../api/healthchecks";
import { formatLocalDateTime } from "../utils/dateTime";
import { WorkspaceDashboardActionLink, WorkspaceStatusCounter, WorkspaceStatusDot, WorkspaceStatusPill } from "./WorkspaceDashboardKit";
import WorkspaceIncidentsCard from "./WorkspaceIncidentsCard";
import { useWorkspaceDashboardI18n } from "./workspaceDashboardMessages";
import {
  cx,
  uiCardClass,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "./ui/styles";

function formatLatency(value?: number | null) {
  if (value == null) return "-";
  return `${value} ms`;
}

function formatCheckMode(mode?: string | null) {
  return (mode || "http").toUpperCase();
}

type WorkspaceEndpointHealthCardsProps = {
  data: WorkspaceEndpointHealthOverviewResponse | null;
  loading: boolean;
  error?: string | null;
  title?: string;
  action?: { to: string; label: string };
  className?: string;
  showStatusCounters?: boolean;
};

export default function WorkspaceEndpointHealthCards({
  data,
  loading,
  error,
  title,
  action,
  className = "grid gap-4 xl:grid-cols-[1.7fr_1fr]",
  showStatusCounters = true,
}: WorkspaceEndpointHealthCardsProps) {
  const { text } = useWorkspaceDashboardI18n();
  const incidents = data?.incidents ?? [];
  const effectiveCounts = {
    up: data?.up_count ?? 0,
    degraded: data?.degraded_count ?? 0,
    down: data?.down_count ?? 0,
    unknown: data?.unknown_count ?? 0,
  };
  const showIncidents = !loading && !error && incidents.length > 0;

  return (
    <div className={className}>
      <section className={cx(uiCardClass, "ui-dashboard-panel")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="ui-dashboard-title">{title ?? text("endpointHealth")}</h2>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {text("storedEndpointStatus")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data?.generated_at && (
              <span className={cx("ui-dashboard-note", uiMutedTextClass)}>
                {text("updatedAt", { timestamp: formatLocalDateTime(data.generated_at) })}
              </span>
            )}
            {action && <WorkspaceDashboardActionLink to={action.to}>{action.label}</WorkspaceDashboardActionLink>}
          </div>
        </div>

        {loading && (
          <div className={cx(uiPanelMutedClass, "mt-3 h-28 animate-pulse")} />
        )}
        {!loading && error && (
          <p className="mt-3 ui-caption text-rose-600 dark:text-rose-300">{error}</p>
        )}
        {!loading && !error && (
          <>
            {showStatusCounters && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: "up" as const, label: text("up"), value: effectiveCounts.up },
                  { key: "degraded" as const, label: text("degraded"), value: effectiveCounts.degraded },
                  { key: "down" as const, label: text("down"), value: effectiveCounts.down },
                  { key: "unknown" as const, label: text("unknown"), value: effectiveCounts.unknown },
                ].map((item) => (
                  <WorkspaceStatusCounter key={item.key} label={item.label} value={item.value} status={item.key} />
                ))}
              </div>
            )}
            <div className="mt-3 space-y-2">
              {(data?.endpoints ?? []).length === 0 && (
                <p className={cx("ui-caption", uiMutedTextClass)}>{text("noEndpointLinked")}</p>
              )}
              {(data?.endpoints ?? []).slice(0, 6).map((endpoint) => {
                const stale = endpoint.is_stale === true;
                const effectiveStatus = stale ? "unknown" : endpoint.status;
                return <div
                  key={endpoint.endpoint_id}
                  className="ui-dashboard-health-row"
                >
                  <div className="min-w-0">
                    <p className={cx("flex min-w-0 items-center gap-2 ui-dashboard-label", uiTitleTextClass)}>
                      <WorkspaceStatusDot status={effectiveStatus} className="shrink-0" />
                      <span className="min-w-0 break-words">{endpoint.name}</span>
                    </p>
                    <p className={cx("ui-dashboard-note", uiMutedTextClass)}>
                      {formatLatency(endpoint.latency_ms)} · {formatCheckMode(endpoint.check_mode)} · {text("lastCheckAt", { timestamp: formatLocalDateTime(endpoint.checked_at) })}
                      {stale ? text("staleSuffix") : ""}
                    </p>
                  </div>
                  <WorkspaceStatusPill status={effectiveStatus} className="ui-caption" />
                </div>
              })}
              {(data?.endpoints ?? []).length > 6 && (
                <p className={cx("ui-caption", uiMutedTextClass)}>
                  {text("moreEndpoints", { count: (data?.endpoints ?? []).length - 6 })}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {showIncidents && (
        <WorkspaceIncidentsCard
          incidents={incidents}
          loading={false}
          incidentHighlightMinutes={data?.incident_highlight_minutes}
          action={action}
        />
      )}
    </div>
  );
}
