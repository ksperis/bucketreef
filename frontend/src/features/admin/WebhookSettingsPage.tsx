/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteWebhookEndpoint,
  listWebhookEndpoints,
  sendWebhookTest,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
} from "../../api/webhooks";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import {
  ListActionButton,
  ListActionLink,
  ListActions,
  ListBadge,
} from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import UiInput from "../../components/ui/UiInput";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { extractApiError } from "../../utils/apiError";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function targetHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "Invalid target";
  }
}

function deliveryTone(status: WebhookDeliveryStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "failed") return "danger";
  if (status === "retrying") return "warning";
  return "neutral";
}

function eventSummary(endpoint: WebhookEndpoint): string {
  if (endpoint.event_types.includes("*")) return "All events";
  const count = endpoint.event_types.length;
  return `${count} event${count === 1 ? "" : "s"}`;
}

export default function WebhookSettingsPage() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const confirmation = useConfirmActionDialog();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEndpoints(await listWebhookEndpoints());
    } catch (loadError) {
      setError(extractApiError(loadError, "Unable to load webhook endpoints."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return endpoints;
    return endpoints.filter((endpoint) =>
      [endpoint.name, endpoint.url, ...endpoint.event_types]
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [endpoints, search]);

  const sendTest = async (endpoint: WebhookEndpoint) => {
    if (!endpoint.has_signing_secret || busyId !== null) return;
    setBusyId(endpoint.id);
    setError(null);
    setMessage(null);
    try {
      const deliveryId = await runWithStepUp(() => sendWebhookTest(endpoint.id));
      setMessage(`Test delivery queued (${deliveryId}).`);
      await load();
    } catch (testError) {
      if (!isRecentWebAuthnVerificationCancelled(testError)) {
        setError(extractApiError(testError, "Unable to queue webhook test delivery."));
      }
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (endpoint: WebhookEndpoint) => {
    if (busyId !== null) return;
    setBusyId(endpoint.id);
    setError(null);
    setMessage(null);
    try {
      await runWithStepUp(() => deleteWebhookEndpoint(endpoint.id));
      setEndpoints((current) => current.filter((item) => item.id !== endpoint.id));
      setMessage(`Webhook endpoint “${endpoint.name}” deleted.`);
    } catch (deleteError) {
      if (!isRecentWebAuthnVerificationCancelled(deleteError)) {
        setError(extractApiError(deleteError, "Unable to delete webhook endpoint."));
      }
    } finally {
      setBusyId(null);
    }
  };

  const requestDelete = (endpoint: WebhookEndpoint) => {
    confirmation.requestConfirmation({
      title: "Delete webhook endpoint?",
      description: "Remove this webhook configuration and its delivery history.",
      confirmLabel: "Delete endpoint",
      details: [
        { label: "Name", value: endpoint.name },
        { label: "Target", value: targetHost(endpoint.url) },
      ],
      impacts: ["Future BucketReef events will no longer be sent to this endpoint."],
      onConfirm: () => remove(endpoint),
    });
  };

  const columns: Array<DataTableColumn<WebhookEndpoint>> = [
    {
      id: "name",
      label: "Name",
      primary: true,
      render: (endpoint) => (
        <div className="min-w-0">
          <p className="font-medium">{endpoint.name}</p>
          {!endpoint.has_signing_secret && (
            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">Signing secret required</p>
          )}
        </div>
      ),
    },
    {
      id: "target",
      label: "Target",
      render: (endpoint) => <span className="font-mono">{targetHost(endpoint.url)}</span>,
    },
    {
      id: "status",
      label: "Status",
      render: (endpoint) => (
        <ListBadge tone={endpoint.enabled ? "success" : "neutral"}>
          {endpoint.enabled ? "Enabled" : "Disabled"}
        </ListBadge>
      ),
    },
    {
      id: "events",
      label: "Events",
      render: (endpoint) => eventSummary(endpoint),
    },
    {
      id: "last-delivery",
      label: "Last delivery",
      render: (endpoint) => endpoint.last_delivery ? (
        <div className="flex flex-wrap items-center gap-2">
          <ListBadge tone={deliveryTone(endpoint.last_delivery.status)}>{endpoint.last_delivery.status}</ListBadge>
          <span>{formatDate(endpoint.last_delivery.delivered_at ?? endpoint.last_delivery.updated_at)}</span>
        </div>
      ) : "Never",
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (endpoint) => (
        <ListActions>
          <ListActionLink
            {...dataTableDefaultActionProps}
            to={`/admin/webhook-settings/${endpoint.id}`}
          >
            Edit
          </ListActionLink>
          <ListActionButton
            onClick={() => void sendTest(endpoint)}
            disabled={!endpoint.has_signing_secret || busyId !== null}
            title={!endpoint.has_signing_secret ? "Generate a signing secret first." : undefined}
          >
            Test
          </ListActionButton>
          <ListActionButton
            variant="danger"
            onClick={() => requestDelete(endpoint)}
            disabled={busyId !== null}
          >
            Delete
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: filtered.length });

  return (
    <div className="space-y-4">
      <PageHeader
        actionPresentation="listing"
        title="Webhooks"
        description="Notify external systems when BucketReef control-plane events occur."
        breadcrumbs={adminPageBreadcrumbs("webhook-settings")}
        actions={[{ label: "Add endpoint", to: "/admin/webhook-settings/new" }]}
      />

      {error && endpoints.length > 0 && <PageBanner tone="error">{error}</PageBanner>}
      {message && <PageBanner tone="success">{message}</PageBanner>}

      <ListPageSection
        variant="page"
        title="Webhook endpoints"
        countLabel={`${filtered.length} endpoint${filtered.length === 1 ? "" : "s"}`}
        search={(
          <UiInput
            size="compact"
            aria-label="Search webhook endpoints"
            placeholder="Search webhooks"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        actions={<ListActionButton onClick={() => void load()} loading={loading}>Refresh</ListActionButton>}
      >
        <DataTableShell
          columns={columns}
          rows={filtered}
          rowKey={(endpoint) => endpoint.id}
          status={tableStatus}
          loadingMessage="Loading webhook endpoints..."
          errorMessage={error ?? "Unable to load webhook endpoints."}
          emptyMessage={search.trim() ? "No webhook endpoints match this search." : "No webhook endpoints configured."}
          responsiveCards
        />
      </ListPageSection>

      {confirmation.confirmationDialog}
      {verificationDialog}
    </div>
  );
}
