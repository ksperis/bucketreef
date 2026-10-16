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
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useAdminI18n } from "./adminI18n";

const isDemo = import.meta.env.MODE === "demo";

function formatDate(value: string | null | undefined, intlLocale: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(intlLocale);
}

function targetHost(value: string, text: (message: string) => string): string {
  try {
    return new URL(value).host;
  } catch {
    return text("Invalid target");
  }
}

function deliveryTone(status: WebhookDeliveryStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "failed") return "danger";
  if (status === "retrying") return "warning";
  return "neutral";
}

function eventSummary(endpoint: WebhookEndpoint, text: (message: string, values?: Record<string, string | number>) => string): string {
  if (endpoint.event_types.includes("*")) return text("All events");
  const count = endpoint.event_types.length;
  return text(count === 1 ? "{count} event" : "{count} events", { count });
}

export default function WebhookSettingsPage() {
  const { intlLocale, text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
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
      setError(extractApiError(loadError, adminText("Unable to load webhook endpoints.")));
    } finally {
      setLoading(false);
    }
  }, [adminText]);

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
      setMessage(adminText("Test delivery queued ({id}).", { id: deliveryId }));
      await load();
    } catch (testError) {
      if (!isRecentWebAuthnVerificationCancelled(testError)) {
        setError(extractApiError(testError, adminText("Unable to queue webhook test delivery.")));
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
      setMessage(adminText("Webhook endpoint “{name}” deleted.", { name: endpoint.name }));
    } catch (deleteError) {
      if (!isRecentWebAuthnVerificationCancelled(deleteError)) {
        setError(extractApiError(deleteError, adminText("Unable to delete webhook endpoint.")));
      }
    } finally {
      setBusyId(null);
    }
  };

  const requestDelete = (endpoint: WebhookEndpoint) => {
    confirmation.requestConfirmation({
      title: adminText("Delete webhook endpoint?"),
      description: adminText("Remove this webhook configuration and its delivery history."),
      confirmLabel: adminText("Delete endpoint"),
      details: [
        { label: adminText("Name"), value: endpoint.name },
        { label: adminText("Target"), value: targetHost(endpoint.url, adminText) },
      ],
      impacts: [adminText("Future BucketReef events will no longer be sent to this endpoint.")],
      onConfirm: () => remove(endpoint),
    });
  };

  const columns: Array<DataTableColumn<WebhookEndpoint>> = [
    {
      id: "name",
      label: adminText("Name"),
      primary: true,
      render: (endpoint) => (
        <div className="min-w-0">
          <p className="font-medium">{endpoint.name}</p>
          {!endpoint.has_signing_secret && (
            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">{adminText("Signing secret required")}</p>
          )}
        </div>
      ),
    },
    {
      id: "target",
      label: adminText("Target"),
      render: (endpoint) => <span className="font-mono">{targetHost(endpoint.url, adminText)}</span>,
    },
    {
      id: "status",
      label: adminText("Status"),
      render: (endpoint) => (
        <ListBadge tone={endpoint.enabled ? "success" : "neutral"}>
          {adminText(endpoint.enabled ? "Enabled" : "Disabled")}
        </ListBadge>
      ),
    },
    {
      id: "events",
      label: adminText("Events"),
      render: (endpoint) => eventSummary(endpoint, adminText),
    },
    {
      id: "last-delivery",
      label: adminText("Last delivery"),
      render: (endpoint) => endpoint.last_delivery ? (
        <div className="flex flex-wrap items-center gap-2">
          <ListBadge tone={deliveryTone(endpoint.last_delivery.status)}>{endpoint.last_delivery.status}</ListBadge>
          <span>{formatDate(endpoint.last_delivery.delivered_at ?? endpoint.last_delivery.updated_at, intlLocale)}</span>
        </div>
      ) : adminText("Never"),
    },
    {
      id: "actions",
      label: adminText("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (endpoint) => (
        <ListActions>
          <ListActionLink
            {...dataTableDefaultActionProps}
            to={`/admin/webhook-settings/${endpoint.id}`}
          >
            {adminText("Edit")}</ListActionLink>
          <ListActionButton
            onClick={() => void sendTest(endpoint)}
            disabled={isDemo || !endpoint.has_signing_secret || busyId !== null}
            title={!endpoint.has_signing_secret ? adminText("Generate a signing secret first.") : undefined}
          >
            {adminText("Test")}</ListActionButton>
          <ListActionButton
            variant="danger"
            onClick={() => requestDelete(endpoint)}
            disabled={isDemo || busyId !== null}
          >
            {adminText("Delete")}</ListActionButton>
        </ListActions>
      ),
    },
  ];

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: filtered.length });

  return (
    <div className="space-y-4">
      <PageHeader
        actionPresentation="listing"
        title={adminText("Webhooks")}
        description={adminText("Notify external systems when BucketReef control-plane events occur.")}
        breadcrumbs={adminBreadcrumbs("webhook-settings")}
        actions={isDemo ? [] : [{ label: adminText("Add endpoint"), to: "/admin/webhook-settings/new" }]}
      />

      {error && endpoints.length > 0 && <PageBanner tone="error">{error}</PageBanner>}
      {message && <PageBanner tone="success">{message}</PageBanner>}

      <ListPageSection
        variant="page"
        title={adminText("Webhook endpoints")}
        countLabel={adminText(filtered.length === 1 ? "{count} endpoint" : "{count} endpoints", { count: filtered.length })}
        search={(
          <UiInput
            size="compact"
            aria-label={adminText("Search webhook endpoints")}
            placeholder={adminText("Search webhooks")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        actions={<ListActionButton onClick={() => void load()} loading={loading}>{adminText("Refresh")}</ListActionButton>}
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
