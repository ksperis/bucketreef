/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { fetchHealthWorkspaceOverview, WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import ErrorState from "../../components/errors/ErrorState";
import PageEmptyState from "../../components/PageEmptyState";
import PageShell from "../../components/PageShell";
import WorkspaceNavCards from "../../components/WorkspaceNavCards";
import WorkspaceEndpointHealthCards from "../../components/WorkspaceEndpointHealthCards";
import { extractApiError } from "../../utils/apiError";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";

type CardLink = {
  title: string;
  description: string;
  to: string;
};

const cards: CardLink[] = [
  { title: "Usage & Metrics", description: "Cluster-wide usage composition, RGW storage, and traffic.", to: "/ceph-admin/metrics" },
  { title: "RGW Accounts", description: "Create/import RGW tenants and manage their quotas.", to: "/ceph-admin/accounts" },
  { title: "RGW Users", description: "Manage cluster-wide RGW users.", to: "/ceph-admin/users" },
  { title: "Buckets", description: "List and configure cluster-wide buckets (Admin Ops + S3).", to: "/ceph-admin/buckets" },
];

export default function CephAdminDashboard() {
  const { generalSettings } = useGeneralSettings();
  const { endpoints, selectedEndpoint, loading, error, retryEndpoints } = useCephAdminEndpoint();
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled || !selectedEndpoint?.id) {
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    setWorkspaceHealthError(null);
    fetchHealthWorkspaceOverview(selectedEndpoint.id)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspaceHealth(null);
        setWorkspaceHealthError(extractApiError(err, "Unable to load endpoint health for this endpoint."));
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceHealthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, selectedEndpoint?.id]);

  return (
    <PageShell
      title="Ceph Admin"
      description={`Cluster-level RGW administration. Active endpoint: ${selectedEndpoint?.name ?? "—"}.`}
      breadcrumbs={cephAdminPageBreadcrumbs("dashboard")}
    >
      <div className="ui-dashboard-compact">
        {loading ? (
          <PageEmptyState
            eyebrow="Loading"
            title="Loading Ceph endpoints"
            description="Ceph Admin will open as soon as the available endpoints are loaded."
          />
        ) : error ? (
          <ErrorState
            kind="unavailable"
            error={error}
            title="Unable to load Ceph endpoints"
            description={error}
            onRetry={retryEndpoints}
          />
        ) : endpoints.length === 0 ? (
          <PageEmptyState
            eyebrow="Unavailable"
            title="No Ceph endpoint available"
            description="Ceph Admin requires at least one Ceph endpoint before cluster-level administration can be used."
            tone="warning"
          />
        ) : !selectedEndpoint?.id ? (
          <PageEmptyState
            eyebrow="Loading"
            title="Selecting Ceph endpoint"
            description="Ceph Admin is selecting the endpoint to use for cluster-level administration."
          />
        ) : null}
        {generalSettings.endpoint_status_enabled && selectedEndpoint?.id && (
          <WorkspaceEndpointHealthCards
            presentation="compact"
            data={workspaceHealth}
            loading={workspaceHealthLoading}
            error={workspaceHealthError}
            title="Endpoint Health"
            showStatusCounters={false}
            action={
              selectedEndpoint?.id
                ? { to: `/admin/endpoint-status/${selectedEndpoint.id}`, label: "View details" }
                : undefined
            }
            className="grid gap-3"
          />
        )}
        {selectedEndpoint?.id ? <WorkspaceNavCards presentation="compact" items={cards} columns={4} /> : null}
      </div>
    </PageShell>
  );
}
