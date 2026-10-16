/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ErrorState from "../../components/errors/ErrorState";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEvents,
  rotateWebhookSecret,
  sendWebhookTest,
  updateWebhookEndpoint,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
  type WebhookEndpointPayload,
  type WebhookEventDefinition,
} from "../../api/webhooks";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListBadge } from "../../components/list/ListControls";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  SettingsButton,
  SettingsInput,
} from "../../components/settings/SettingsControls";
import {
  SettingsChoiceRow,
  SettingsItem,
  SettingsSection,
  SettingsSwitch,
} from "../../components/settings/SettingsLayout";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import UiBadge from "../../components/ui/UiBadge";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { extractApiError } from "../../utils/apiError";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useAdminI18n } from "./adminI18n";

const isDemo = import.meta.env.MODE === "demo";

const backPath = "/admin/webhook-settings";

type RouteState = {
  signingSecret?: string;
  message?: string;
} | null;

function emptyForm(): WebhookEndpointPayload {
  return { name: "", url: "", enabled: false, event_types: ["*"] };
}

function endpointForm(endpoint: WebhookEndpoint): WebhookEndpointPayload {
  return {
    name: endpoint.name,
    url: endpoint.url,
    enabled: endpoint.enabled,
    event_types: [...endpoint.event_types].sort(),
  };
}

function formatDate(value: string | null | undefined, intlLocale: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(intlLocale);
}

function deliveryTone(status: WebhookDeliveryStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "failed") return "danger";
  if (status === "retrying") return "warning";
  return "neutral";
}

function validateUrl(value: string, text: (message: string) => string): string | undefined {
  if (!value.trim()) return text("Target URL is required.");
  try {
    const parsed = new URL(value.trim());
    if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) return text("Use an HTTP or HTTPS URL.");
    if (parsed.username || parsed.password) return text("Embedded URL credentials are not allowed.");
  } catch {
    return text("Enter a valid HTTP or HTTPS URL.");
  }
  return undefined;
}

export default function WebhookEndpointPage() {
  const { intlLocale, text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const { endpointId } = useParams();
  const numericEndpointId = endpointId ? Number(endpointId) : null;
  const invalidEndpointId = endpointId !== undefined && (!Number.isSafeInteger(numericEndpointId) || Number(numericEndpointId) <= 0);
  const isCreate = endpointId === undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const initialRouteState = location.state as RouteState;
  const form = useSettingsDraft<WebhookEndpointPayload>(emptyForm);
  const { accept: acceptDraft } = form;
  const [endpoint, setEndpoint] = useState<WebhookEndpoint | null>(null);
  const [events, setEvents] = useState<WebhookEventDefinition[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(invalidEndpointId ? "Webhook endpoint not found." : null);
  const [message, setMessage] = useState<string | null>(initialRouteState?.message ?? null);
  const [eventSearch, setEventSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(initialRouteState?.signingSecret ?? null);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const rotateConfirmation = useConfirmActionDialog();
  const deleteConfirmation = useConfirmActionDialog();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();

  useEffect(() => {
    setCompleted(false);
  }, [endpointId]);

  useEffect(() => {
    if (initialRouteState?.signingSecret) {
      setOneTimeSecret(initialRouteState.signingSecret);
    }
    if (initialRouteState?.message) {
      setMessage(initialRouteState.message);
    }
    if (initialRouteState?.signingSecret || initialRouteState?.message) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [initialRouteState?.message, initialRouteState?.signingSecret, location.pathname, navigate]);

  const loadDeliveries = useCallback(async (id: number) => {
    setDeliveriesLoading(true);
    setDeliveriesError(null);
    try {
      setDeliveries(await listWebhookDeliveries(id));
    } catch (loadError) {
      setDeliveriesError(extractApiError(loadError, adminText("Unable to load webhook deliveries.")));
    } finally {
      setDeliveriesLoading(false);
    }
  }, [adminText]);

  useEffect(() => {
    if (invalidEndpointId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setLoadFailure(null);
    setEndpoint(null);
    const requests: [Promise<WebhookEventDefinition[]>, Promise<WebhookEndpoint | null>] = [
      listWebhookEvents(),
      isCreate || numericEndpointId === null
        ? Promise.resolve(null)
        : getWebhookEndpoint(numericEndpointId),
    ];
    Promise.all(requests)
      .then(([eventDefinitions, loadedEndpoint]) => {
        if (!active) return;
        setEvents(eventDefinitions);
        if (loadedEndpoint) {
          setEndpoint(loadedEndpoint);
          acceptDraft(endpointForm(loadedEndpoint));
          void loadDeliveries(loadedEndpoint.id);
        }
      })
      .catch((loadError) => {
        if (active) setLoadFailure(loadError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [acceptDraft, endpointId, invalidEndpointId, isCreate, loadAttempt, loadDeliveries, numericEndpointId]);

  const selectedEvents = useMemo(() => new Set(form.draft.event_types), [form.draft.event_types]);
  const allEvents = selectedEvents.has("*");
  const filteredEvents = useMemo(() => {
    const needle = eventSearch.trim().toLowerCase();
    return events.filter((event) => !needle || [event.type, event.category, event.label, event.description]
      .some((value) => value.toLowerCase().includes(needle)));
  }, [eventSearch, events]);
  const groupedEvents = useMemo(() => {
    const groups = new Map<string, WebhookEventDefinition[]>();
    for (const event of filteredEvents) {
      groups.set(event.category, [...(groups.get(event.category) ?? []), event]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [filteredEvents]);

  const setEventTypes = (values: string[]) => {
    const unique = [...new Set(values)].sort();
    form.setDraft((current) => ({ ...current, event_types: unique }));
    setError(null);
  };
  const toggleEvent = (eventType: string, checked: boolean) => {
    const exact = form.draft.event_types.filter((value) => value !== "*");
    setEventTypes(checked ? [...exact, eventType] : exact.filter((value) => value !== eventType));
  };

  const nameError = !form.draft.name.trim() ? adminText("Name is required.") : undefined;
  const urlError = validateUrl(form.draft.url, adminText);
  const eventsError = form.draft.event_types.length === 0 ? adminText("Select at least one event or use All events.") : undefined;
  const hasValidationError = Boolean(nameError || urlError || eventsError);
  const missingSecret = Boolean(endpoint && !endpoint.has_signing_secret);

  const close = (reason?: "navigation") => {
    form.cancel();
    if (reason !== "navigation") navigate(backPath);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !form.dirty || hasValidationError || invalidEndpointId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const payload: WebhookEndpointPayload = {
      name: form.draft.name.trim(),
      url: form.draft.url.trim(),
      enabled: form.draft.enabled,
      event_types: [...form.draft.event_types],
    };
    try {
      if (isCreate) {
        const created = await runWithStepUp(() => createWebhookEndpoint(payload));
        flushSync(() => {
          form.accept(payload);
          setCompleted(true);
        });
        navigate(`/admin/webhook-settings/${created.id}`, {
          replace: true,
          state: {
            signingSecret: created.signing_secret,
            message: adminText("Webhook endpoint created."),
          } satisfies RouteState,
        });
        return;
      }
      if (!endpoint) return;
      const updated = await runWithStepUp(() => updateWebhookEndpoint(endpoint.id, payload));
      setEndpoint(updated);
      form.accept(endpointForm(updated));
      setMessage(adminText("Webhook endpoint saved."));
    } catch (saveError) {
      if (!isRecentWebAuthnVerificationCancelled(saveError)) {
        setError(extractApiError(saveError, adminText("Unable to save webhook endpoint.")));
      }
    } finally {
      setSaving(false);
    }
  };

  const rotateSecret = async () => {
    if (!endpoint || actionBusy) return;
    setActionBusy(true);
    setError(null);
    setMessage(null);
    try {
      const secret = await runWithStepUp(() => rotateWebhookSecret(endpoint.id));
      setEndpoint((current) => current ? { ...current, has_signing_secret: true } : current);
      setOneTimeSecret(secret);
      setMessage(adminText(endpoint.has_signing_secret ? "Signing secret rotated." : "Signing secret generated."));
    } catch (rotateError) {
      if (!isRecentWebAuthnVerificationCancelled(rotateError)) {
        setError(extractApiError(rotateError, adminText("Unable to rotate webhook signing secret.")));
      }
    } finally {
      setActionBusy(false);
    }
  };

  const requestRotateSecret = () => {
    if (!endpoint) return;
    rotateConfirmation.requestConfirmation({
      title: adminText(endpoint.has_signing_secret ? "Rotate signing secret?" : "Generate signing secret?"),
      description: endpoint.has_signing_secret
        ? adminText("The current signing secret will stop validating future deliveries immediately.")
        : adminText("Generate the signing secret required before this endpoint can be enabled."),
      confirmLabel: adminText(endpoint.has_signing_secret ? "Rotate secret" : "Generate secret"),
      impacts: endpoint.has_signing_secret
        ? [adminText("Update the external consumer with the new secret before sending further production events.")]
        : [adminText("The secret will be shown once after generation.")],
      onConfirm: rotateSecret,
    });
  };

  const sendTest = async () => {
    if (!endpoint?.has_signing_secret || actionBusy || form.dirty) return;
    setActionBusy(true);
    setError(null);
    setMessage(null);
    try {
      const deliveryId = await runWithStepUp(() => sendWebhookTest(endpoint.id));
      setMessage(adminText("Test delivery queued ({id}).", { id: deliveryId }));
      await loadDeliveries(endpoint.id);
    } catch (testError) {
      if (!isRecentWebAuthnVerificationCancelled(testError)) {
        setError(extractApiError(testError, adminText("Unable to queue webhook test delivery.")));
      }
    } finally {
      setActionBusy(false);
    }
  };

  const remove = async () => {
    if (!endpoint || actionBusy) return;
    setActionBusy(true);
    setError(null);
    try {
      await runWithStepUp(() => deleteWebhookEndpoint(endpoint.id));
      flushSync(() => form.accept(form.draft));
      navigate(backPath, { replace: true });
    } catch (deleteError) {
      if (!isRecentWebAuthnVerificationCancelled(deleteError)) {
        setError(extractApiError(deleteError, adminText("Unable to delete webhook endpoint.")));
      }
    } finally {
      setActionBusy(false);
    }
  };

  const requestDelete = () => {
    if (!endpoint) return;
    deleteConfirmation.requestConfirmation({
      title: adminText("Delete webhook endpoint?"),
      description: adminText("Remove this endpoint and its delivery history."),
      confirmLabel: adminText("Delete endpoint"),
      details: [{ label: adminText("Name"), value: endpoint.name }],
      impacts: [adminText("Future BucketReef events will no longer be delivered to this endpoint.")],
      onConfirm: remove,
    });
  };

  const deliveryColumns: Array<DataTableColumn<WebhookDelivery>> = [
    {
      id: "status",
      label: adminText("Status"),
      primary: true,
      render: (delivery) => <ListBadge tone={deliveryTone(delivery.status)}>{delivery.status}</ListBadge>,
    },
    {
      id: "event",
      label: adminText("Event"),
      render: (delivery) => <span className="font-mono">{delivery.event_type}</span>,
    },
    {
      id: "attempts",
      label: adminText("Attempts"),
      render: (delivery) => String(delivery.attempt_count),
    },
    {
      id: "http",
      label: "HTTP",
      render: (delivery) => delivery.last_http_status ?? "-",
    },
    {
      id: "time",
      label: adminText("Updated"),
      render: (delivery) => formatDate(delivery.updated_at, intlLocale),
    },
    {
      id: "detail",
      label: adminText("Detail"),
      render: (delivery) => delivery.last_error ? (
        <span className="max-w-xl whitespace-normal [overflow-wrap:anywhere]">{delivery.last_error}</span>
      ) : delivery.is_test ? adminText("Test delivery") : "-",
    },
  ];
  const deliveryStatus = resolveListTableStatus({
    loading: deliveriesLoading,
    error: deliveriesError,
    rowCount: deliveries.length,
  });

  const title = isCreate
    ? adminText("Add webhook endpoint")
    : endpoint
      ? adminText("Edit webhook: {name}", { name: endpoint.name })
      : adminText("Webhook endpoint");
  const selectedExactCount = form.draft.event_types.filter((value) => value !== "*").length;

  if (!loading && (invalidEndpointId || loadFailure || (!isCreate && !endpoint))) {
    return <ErrorState kind={invalidEndpointId ? "invalid_link" : loadFailure ? undefined : "not_found"}
      error={loadFailure} onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
      secondaryAction={{ label: adminText("Back to webhooks"), to: backPath }} />;
  }

  return (
    <>
      <SettingsWorkflowForm
        readOnly={isDemo}
        title={title}
        description={adminText("Configure delivery, signing and the BucketReef events sent to this external endpoint.")}
        formLabel={adminText("Webhook endpoint configuration")}
        contentVariant="plain"
        width="wide"
        backLabel={adminText("Back to webhooks")}
        dirty={form.dirty}
        persistentEdit={!isCreate}
        busy={saving}
        completed={completed}
        loading={loading}
        disabled={!form.dirty || hasValidationError || invalidEndpointId || Boolean(!isCreate && !endpoint)}
        error={error}
        submitLabel={adminText(isCreate ? "Create endpoint" : "Save changes")}
        busyLabel={adminText(isCreate ? "Creating..." : "Saving...")}
        onSubmit={save}
        onClose={close}
        breadcrumbs={[
          ...adminBreadcrumbs("webhook-settings").map((crumb, index, items) =>
            index === items.length - 1 ? { ...crumb, to: backPath } : crumb),
          { label: isCreate ? adminText("Add endpoint") : endpoint?.name ?? adminText("Endpoint") },
        ]}
      >
        {message && <UiInlineMessage tone="success" role="status">{message}</UiInlineMessage>}

        {!loading && (!invalidEndpointId && (isCreate || endpoint)) && (
          <>
            <SettingsSection
              presentation="compact"
              title={adminText("General")}
              description={adminText("Name the integration, set its target URL and control whether production events are delivered.")}
            >
              <div className="settings-fields">
                <div className="settings-fields sm:grid-cols-2">
                  <SettingsInput
                    label={adminText("Name")}
                    value={form.draft.name}
                    onChange={(event) => form.setDraft((current) => ({ ...current, name: event.target.value }))}
                    error={nameError}
                    placeholder={adminText("Operations automation")}
                    maxLength={160}
                  />
                  <SettingsInput
                    label={adminText("Target URL")}
                    type="url"
                    value={form.draft.url}
                    onChange={(event) => form.setDraft((current) => ({ ...current, url: event.target.value }))}
                    error={urlError}
                    placeholder="https://hooks.example.net/bucketreef"
                  />
                </div>
                <SettingsItem
                  compact
                  title={adminText("Endpoint enabled")}
                  description={missingSecret
                    ? "Generate a signing secret before enabling this imported endpoint."
                    : "Deliver matching production events. Tests can still be sent while an endpoint is disabled."}
                  status={missingSecret ? <UiBadge tone="warning">{adminText("Signing secret required")}</UiBadge> : undefined}
                  action={(
                    <SettingsSwitch
                      checked={form.draft.enabled}
                      disabled={isDemo || missingSecret}
                      ariaLabel={adminText("Endpoint enabled")}
                      onChange={(enabled) => form.setDraft((current) => ({ ...current, enabled }))}
                    />
                  )}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              presentation="compact"
              title={adminText("Signing")}
              description={adminText("BucketReef signs every request with HMAC-SHA256 over the timestamp and exact request body.")}
            >
              <div className="settings-stack">
                {isCreate ? (
                  <UiInlineMessage tone="info">{adminText("A signing secret is generated when the endpoint is created and shown once.")}</UiInlineMessage>
                ) : (
                  <SettingsItem
                    compact
                    title={adminText("Signing secret")}
                    description={adminText("Verify X-BucketReef-Signature using the timestamp from X-BucketReef-Timestamp.")}
                    status={(
                      <UiBadge tone={endpoint?.has_signing_secret ? "success" : "warning"}>
                        {endpoint?.has_signing_secret ? "Configured" : "Required"}
                      </UiBadge>
                    )}
                    action={(
                      <SettingsButton type="button" variant="secondary" disabled={isDemo || actionBusy} onClick={requestRotateSecret}>
                        {endpoint?.has_signing_secret ? "Rotate secret" : "Generate secret"}
                      </SettingsButton>
                    )}
                  />
                )}
                {oneTimeSecret && (
                  <OneTimeSecretPanel
                    title={adminText("Webhook signing secret")}
                    description={adminText("Store this secret in the external consumer now. BucketReef will not display it again.")}
                    badge="One-time display"
                    values={[{ label: "Signing secret", value: oneTimeSecret, copyLabel: "Copy secret" }]}
                    actions={<SettingsButton type="button" variant="secondary" onClick={() => setOneTimeSecret(null)}>{adminText("Hide secret")}</SettingsButton>}
                  />
                )}
              </div>
            </SettingsSection>

            <SettingsSection
              presentation="compact"
              title={adminText("Events")}
              description={adminText("Choose which control-plane and system events this endpoint receives. Browser object data transfers are excluded.")}
            >
              <div className="settings-stack">
                <SettingsChoiceRow
                  title={adminText("All events")}
                  description={adminText("Receive every current and future webhook event type.")}
                  checked={allEvents}
                  onChange={(checked) => setEventTypes(checked ? ["*"] : [])}
                />
                {!allEvents && eventsError && <UiInlineMessage tone="warning" role="alert">{eventsError}</UiInlineMessage>}
                {!allEvents && (
                  <>
                    <UiInput
                      size="compact"
                      aria-label={adminText("Search webhook events")}
                      placeholder={adminText("Search event types")}
                      value={eventSearch}
                      onChange={(event) => setEventSearch(event.target.value)}
                    />
                    <p className="settings-description">{selectedExactCount} {adminText("selected event")}{selectedExactCount === 1 ? "" : "s"}</p>
                    <div className="space-y-2">
                      {groupedEvents.map(([category, categoryEvents]) => {
                        const selectedCount = categoryEvents.filter((event) => selectedEvents.has(event.type)).length;
                        const expanded = Boolean(eventSearch.trim()) || expandedCategories.has(category);
                        return (
                          <details
                            key={category}
                            open={expanded}
                            onToggle={(event) => {
                              if (eventSearch.trim()) return;
                              const open = event.currentTarget.open;
                              setExpandedCategories((current) => {
                                const next = new Set(current);
                                if (open) next.add(category); else next.delete(category);
                                return next;
                              });
                            }}
                            className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)]"
                          >
                            <summary className="cursor-pointer px-3 py-2 settings-label">
                              {category} · {selectedCount}/{categoryEvents.length}
                            </summary>
                            <div className="border-t border-[var(--ui-border-soft)] px-3 py-2">
                              <div className="mb-2 flex flex-wrap gap-2">
                                <SettingsButton
                                  type="button"
                                  variant="secondary"
                                  onClick={() => setEventTypes([...form.draft.event_types, ...categoryEvents.map((event) => event.type)])}
                                >
                                  {adminText("Select group")}</SettingsButton>
                                <SettingsButton
                                  type="button"
                                  variant="secondary"
                                  onClick={() => {
                                    const categoryTypes = new Set(categoryEvents.map((event) => event.type));
                                    setEventTypes(form.draft.event_types.filter((value) => !categoryTypes.has(value)));
                                  }}
                                >
                                  {adminText("Clear group")}</SettingsButton>
                              </div>
                              {categoryEvents.map((event) => (
                                <SettingsChoiceRow
                                  key={event.type}
                                  title={event.label}
                                  description={<><span className="font-mono">{event.type}</span><span className="block">{event.description}</span></>}
                                  checked={selectedEvents.has(event.type)}
                                  onChange={(checked) => toggleEvent(event.type, checked)}
                                />
                              ))}
                            </div>
                          </details>
                        );
                      })}
                      {groupedEvents.length === 0 && <p className="settings-description">{adminText("No events match this search.")}</p>}
                    </div>
                  </>
                )}
              </div>
            </SettingsSection>

            {!isCreate && endpoint && (
              <SettingsSection
                presentation="compact"
                title={adminText("Deliveries")}
                description={adminText("Inspect recent attempts. Delivery is at-least-once; consumers should deduplicate using X-BucketReef-Delivery.")}
              >
                <div className="settings-stack">
                  <div className="flex flex-wrap gap-2">
                    <SettingsButton
                      type="button"
                      variant="secondary"
                      disabled={isDemo || actionBusy || form.dirty || !endpoint.has_signing_secret}
                      title={form.dirty ? "Save changes before sending a test." : !endpoint.has_signing_secret ? "Generate a signing secret first." : undefined}
                      onClick={() => void sendTest()}
                    >
                      {adminText("Send test")}</SettingsButton>
                    <SettingsButton type="button" variant="secondary" disabled={deliveriesLoading} onClick={() => void loadDeliveries(endpoint.id)}>
                      {adminText("Refresh deliveries")}</SettingsButton>
                  </div>
                  <DataTableShell
                    columns={deliveryColumns}
                    rows={deliveries}
                    rowKey={(delivery) => delivery.id}
                    status={deliveryStatus}
                    loadingMessage="Loading deliveries..."
                    errorMessage={deliveriesError ?? "Unable to load deliveries."}
                    emptyMessage="No deliveries yet."
                    responsiveCards
                    stickyActions={false}
                  />
                </div>
              </SettingsSection>
            )}

            {!isCreate && endpoint && (
              <SettingsSection
                presentation="compact"
                title={adminText("Danger zone")}
                description={adminText("Permanently remove this webhook endpoint and its delivery history.")}
              >
                <SettingsButton type="button" variant="danger" disabled={isDemo || actionBusy} onClick={requestDelete}>
                  {adminText("Delete endpoint")}</SettingsButton>
              </SettingsSection>
            )}
          </>
        )}
      </SettingsWorkflowForm>
      {rotateConfirmation.confirmationDialog}
      {deleteConfirmation.confirmationDialog}
      {verificationDialog}
    </>
  );
}
