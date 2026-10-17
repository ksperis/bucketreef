/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { WorkspaceDashboardActionLink, WorkspaceDashboardCard } from "./WorkspaceDashboardKit";
import UiBadge from "./ui/UiBadge";
import type { WorkspaceEndpointIncidentEntry } from "../api/healthchecks";
import { formatLocalDateTime } from "../utils/dateTime";
import { OpenIcon } from "../features/browser/browserIcons";
import { useWorkspaceIncidentsI18n } from "./workspaceIncidentsMessages";

const MAX_INCIDENT_ROWS = 5;

type WorkspaceIncidentsCardProps = {
  incidents: WorkspaceEndpointIncidentEntry[];
  loading: boolean;
  incidentHighlightMinutes?: number | null;
  action?: { to: string; label: string };
  showEmptyState?: boolean;
  className?: string;
  unavailableReason?: string | null;
};

function formatIncidentWindow(minutes: number | null | undefined, text: ReturnType<typeof useWorkspaceIncidentsI18n>["text"]) {
  const value = Math.max(1, Number(minutes ?? 720));
  if (value % (24 * 60) === 0) {
    const days = value / (24 * 60);
    return text(days > 1 ? "days" : "day", { count: days });
  }
  if (value % 60 === 0) {
    const hours = value / 60;
    return text(hours > 1 ? "hours" : "hour", { count: hours });
  }
  return text(value > 1 ? "minutes" : "minute", { count: value });
}

function sortIncidents(incidents: WorkspaceEndpointIncidentEntry[]) {
  return [...incidents].sort((left, right) => {
    if (left.ongoing !== right.ongoing) return left.ongoing ? -1 : 1;
    return new Date(right.start).getTime() - new Date(left.start).getTime();
  });
}

export default function WorkspaceIncidentsCard({
  incidents,
  loading,
  incidentHighlightMinutes,
  action,
  showEmptyState = false,
  className,
  unavailableReason,
}: WorkspaceIncidentsCardProps) {
  const { text } = useWorkspaceIncidentsI18n();
  const orderedIncidents = sortIncidents(incidents);
  const visibleIncidents = orderedIncidents.slice(0, MAX_INCIDENT_ROWS);
  const hiddenIncidentCount = Math.max(0, orderedIncidents.length - MAX_INCIDENT_ROWS);

  if (!loading && orderedIncidents.length === 0 && !showEmptyState && !unavailableReason) return null;

  return (
    <WorkspaceDashboardCard title={text("title")} className={className}>
      <p className="ui-dashboard-note">{text("description", { window: formatIncidentWindow(incidentHighlightMinutes, text) })}</p>
      {loading ? <p className="ui-dashboard-note" role="status">{text("loading")}</p> : unavailableReason ? <p className="ui-dashboard-note" role="status">{unavailableReason}</p> : orderedIncidents.length === 0 ? <p className="ui-dashboard-note">{text("empty")}</p> : (
        <div className="ui-dashboard-incidents">
          {visibleIncidents.map((incident, index) => (
            <div key={`${incident.endpoint_id}-${incident.start}-${index}`} data-incident-state={incident.ongoing ? "ongoing" : "resolved"} className="ui-dashboard-incident">
              <div className="ui-dashboard-incident-description">
                <p className="ui-dashboard-label">{incident.endpoint_name}</p>
                <p className="ui-dashboard-note">{text(incident.ongoing ? "ongoingSince" : "from")} {formatLocalDateTime(incident.start)}{incident.end ? text("toDate", { date: formatLocalDateTime(incident.end) }) : ""}</p>
              </div>
              <UiBadge tone={incident.ongoing ? "warning" : "neutral"} className="ui-dashboard-badge">{text(incident.ongoing ? "inProgress" : "resolved")}</UiBadge>
            </div>
          ))}
        </div>
      )}
      <div className="ui-dashboard-panel-footer">
        {hiddenIncidentCount > 0 && <p className="ui-dashboard-note">{text("moreIncidents", { count: hiddenIncidentCount })}</p>}
        {action && <WorkspaceDashboardActionLink to={action.to}>{action.label}<OpenIcon className="h-3.5 w-3.5" /></WorkspaceDashboardActionLink>}
      </div>
    </WorkspaceDashboardCard>
  );
}
