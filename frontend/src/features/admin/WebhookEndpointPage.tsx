/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
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
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";

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

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function deliveryTone(status: WebhookDeliveryStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "failed") return "danger";
  if (status === "retrying") return "warning";
  return "neutral";
}

function validateUrl(value: string): string | undefined {
  if (!value.trim()) return "Target URL is required.";
  try {
    const parsed = new URL(value.trim());
    if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) return "Use an HTTP or HTTPS URL.";
    if (parsed.username || parsed.password) return "Embedded URL credentials are not allowed.";
  } catch {
    return "Enter a valid HTTP or HTTPS URL.";
  }
  return undefined;
}

export default function WebhookEndpointPage() {
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
      setDeliveriesError(extractApiError(loadError, "Unable to load webhook deliveries."));
    } finally {
      setDeliveriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (invalidEndpointId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
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
        if (active) setError(extractApiError(loadError, "Unable to load webhook configuration."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [acceptDraft, endpointId, invalidEndpointId, isCreate, loadDeliveries, numericEndpointId]);

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

  const nameError = !form.draft.name.trim() ? "Name is required." : undefined;
  const urlError = validateUrl(form.draft.url);
  const eventsError = form.draft.event_types.length === 0 ? "Select at least one event or use All events." : undefined;
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
            message: "Webhook endpoint created.",
          } satisfies RouteState,
        });
        return;
      }
      if (!endpoint) return;
      const updated = await runWithStepUp(() => updateWebhookEndpoint(endpoint.id, payload));
      setEndpoint(updated);
      form.accept(endpointForm(updated));
      setMessage("Webhook endpoint saved.");
    } catch (saveError) {
      if (!isRecentWebAuthnVerificationCancelled(saveError)) {
        setError(extractApiError(saveError, "Unable to save webhook endpoint."));
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
      setMessage(endpoint.has_signing_secret ? "Signing secret rotated." : "Signing secret generated.");
    } catch (rotateError) {
      if (!isRecentWebAuthnVerificationCancelled(rotateError)) {
        setError(extractApiError(rotateError, "Unable to rotate webhook signing secret."));
      }
    } finally {
      setActionBusy(false);
    }
  };

  const requestRotateSecret = () => {
    if (!endpoint) return;
    rotateConfirmation.requestConfirmation({
      title: endpoint.has_signing_secret ? "Rotate signing secret?" : "Generate signing secret?",
      description: endpoint.has_signing_secret
        ? "The current signing secret will stop validating future deliveries immediately."
        : "Generate the signing secret required before this endpoint can be enabled.",
      confirmLabel: endpoint.has_signing_secret ? "Rotate secret" : "Generate secret",
      impacts: endpoint.has_signing_secret
        ? ["Update the external consumer with the new secret before sending further production events."]
        : ["The secret will be shown once after generation."],
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
      setMessage(`Test delivery queued (${deliveryId}).`);
      await loadDeliveries(endpoint.id);
    } catch (testError) {
      if (!isRecentWebAuthnVerificationCancelled(testError)) {
        setError(extractApiError(testError, "Unable to queue webhook test delivery."));
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
        setError(extractApiError(deleteError, "Unable to delete webhook endpoint."));
      }
    } finally {
      setActionBusy(false);
    }
  };

  const requestDelete = () => {
    if (!endpoint) return;
    deleteConfirmation.requestConfirmation({
      title: "Delete webhook endpoint?",
      description: "Remove this endpoint and its delivery history.",
      confirmLabel: "Delete endpoint",
      details: [{ label: "Name", value: endpoint.name }],
      impacts: ["Future BucketReef events will no longer be delivered to this endpoint."],
      onConfirm: remove,
    });
  };

  const deliveryColumns: Array<DataTableColumn<WebhookDelivery>> = [
    {
      id: "status",
      label: "Status",
      primary: true,
      render: (delivery) => <ListBadge tone={deliveryTone(delivery.status)}>{delivery.status}</ListBadge>,
    },
    {
      id: "event",
      label: "Event",
      render: (delivery) => <span className="font-mono">{delivery.event_type}</span>,
    },
    {
      id: "attempts",
      label: "Attempts",
      render: (delivery) => String(delivery.attempt_count),
    },
    {
      id: "http",
      label: "HTTP",
      render: (delivery) => delivery.last_http_status ?? "-",
    },
    {
      id: "time",
      label: "Updated",
      render: (delivery) => formatDate(delivery.updated_at),
    },
    {
      id: "detail",
      label: "Detail",
      render: (delivery) => delivery.last_error ? (
        <span className="max-w-xl whitespace-normal [overflow-wrap:anywhere]">{delivery.last_error}</span>
      ) : delivery.is_test ? "Test delivery" : "-",
    },
  ];
  const deliveryStatus = resolveListTableStatus({
    loading: deliveriesLoading,
    error: deliveriesError,
    rowCount: deliveries.length,
  });

  const title = isCreate ? "Add webhook endpoint" : endpoint ? `Edit webhook: ${endpoint.name}` : "Webhook endpoint";
  const selectedExactCount = form.draft.event_types.filter((value) => value !== "*").length;

  return (
    <>
      <SettingsWorkflowForm
        title={title}
        description="Configure delivery, signing and the BucketReef events sent to this external endpoint."
        formLabel="Webhook endpoint configuration"
        contentVariant="plain"
        width="wide"
        backLabel="Back to webhooks"
        dirty={form.dirty}
        busy={saving}
        completed={completed}
        loading={loading}
        disabled={!form.dirty || hasValidationError || invalidEndpointId || Boolean(!isCreate && !endpoint)}
        error={error}
        submitLabel={isCreate ? "Create endpoint" : "Save changes"}
        busyLabel={isCreate ? "Creating..." : "Saving..."}
        onSubmit={save}
        onClose={close}
        breadcrumbs={[
          ...adminPageBreadcrumbs("webhook-settings").map((crumb, index, items) =>
            index === items.length - 1 ? { ...crumb, to: backPath } : crumb),
          { label: isCreate ? "Add endpoint" : endpoint?.name ?? "Endpoint" },
        ]}
      >
        {message && <UiInlineMessage tone="success" role="status">{message}</UiInlineMessage>}

        {!loading && (!invalidEndpointId && (isCreate || endpoint)) && (
          <>
            <SettingsSection
              presentation="compact"
              title="General"
              description="Name the integration, set its target URL and control whether production events are delivered."
            >
              <div className="settings-fields">
                <div className="settings-fields sm:grid-cols-2">
                  <SettingsInput
                    label="Name"
                    value={form.draft.name}
                    onChange={(event) => form.setDraft((current) => ({ ...current, name: event.target.value }))}
                    error={nameError}
                    placeholder="Operations automation"
                    maxLength={160}
                  />
                  <SettingsInput
                    label="Target URL"
                    type="url"
                    value={form.draft.url}
                    onChange={(event) => form.setDraft((current) => ({ ...current, url: event.target.value }))}
                    error={urlError}
                    placeholder="https://hooks.example.net/bucketreef"
                  />
                </div>
                <SettingsItem
                  compact
                  title="Endpoint enabled"
                  description={missingSecret
                    ? "Generate a signing secret before enabling this imported endpoint."
                    : "Deliver matching production events. Tests can still be sent while an endpoint is disabled."}
                  status={missingSecret ? <UiBadge tone="warning">Signing secret required</UiBadge> : undefined}
                  action={(
                    <SettingsSwitch
                      checked={form.draft.enabled}
                      disabled={missingSecret}
                      ariaLabel="Endpoint enabled"
                      onChange={(enabled) => form.setDraft((current) => ({ ...current, enabled }))}
                    />
                  )}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              presentation="compact"
              title="Signing"
              description="BucketReef signs every request with HMAC-SHA256 over the timestamp and exact request body."
            >
              <div className="settings-stack">
                {isCreate ? (
                  <UiInlineMessage tone="info">A signing secret is generated when the endpoint is created and shown once.</UiInlineMessage>
                ) : (
                  <SettingsItem
                    compact
                    title="Signing secret"
                    description="Verify X-BucketReef-Signature using the timestamp from X-BucketReef-Timestamp."
                    status={(
                      <UiBadge tone={endpoint?.has_signing_secret ? "success" : "warning"}>
                        {endpoint?.has_signing_secret ? "Configured" : "Required"}
                      </UiBadge>
                    )}
                    action={(
                      <SettingsButton type="button" variant="secondary" disabled={actionBusy} onClick={requestRotateSecret}>
                        {endpoint?.has_signing_secret ? "Rotate secret" : "Generate secret"}
                      </SettingsButton>
                    )}
                  />
                )}
                {oneTimeSecret && (
                  <OneTimeSecretPanel
                    title="Webhook signing secret"
                    description="Store this secret in the external consumer now. BucketReef will not display it again."
                    badge="One-time display"
                    values={[{ label: "Signing secret", value: oneTimeSecret, copyLabel: "Copy secret" }]}
                    actions={<SettingsButton type="button" variant="secondary" onClick={() => setOneTimeSecret(null)}>Hide secret</SettingsButton>}
                  />
                )}
              </div>
            </SettingsSection>

            <SettingsSection
              presentation="compact"
              title="Events"
              description="Choose which control-plane and system events this endpoint receives. Browser object data transfers are excluded."
            >
              <div className="settings-stack">
                <SettingsChoiceRow
                  title="All events"
                  description="Receive every current and future webhook event type."
                  checked={allEvents}
                  onChange={(checked) => setEventTypes(checked ? ["*"] : [])}
                />
                {!allEvents && eventsError && <UiInlineMessage tone="warning" role="alert">{eventsError}</UiInlineMessage>}
                {!allEvents && (
                  <>
                    <UiInput
                      size="compact"
                      aria-label="Search webhook events"
                      placeholder="Search event types"
                      value={eventSearch}
                      onChange={(event) => setEventSearch(event.target.value)}
                    />
                    <p className="settings-description">{selectedExactCount} selected event{selectedExactCount === 1 ? "" : "s"}</p>
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
                                  Select group
                                </SettingsButton>
                                <SettingsButton
                                  type="button"
                                  variant="secondary"
                                  onClick={() => {
                                    const categoryTypes = new Set(categoryEvents.map((event) => event.type));
                                    setEventTypes(form.draft.event_types.filter((value) => !categoryTypes.has(value)));
                                  }}
                                >
                                  Clear group
                                </SettingsButton>
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
                      {groupedEvents.length === 0 && <p className="settings-description">No events match this search.</p>}
                    </div>
                  </>
                )}
              </div>
            </SettingsSection>

            {!isCreate && endpoint && (
              <SettingsSection
                presentation="compact"
                title="Deliveries"
                description="Inspect recent attempts. Delivery is at-least-once; consumers should deduplicate using X-BucketReef-Delivery."
              >
                <div className="settings-stack">
                  <div className="flex flex-wrap gap-2">
                    <SettingsButton
                      type="button"
                      variant="secondary"
                      disabled={actionBusy || form.dirty || !endpoint.has_signing_secret}
                      title={form.dirty ? "Save changes before sending a test." : !endpoint.has_signing_secret ? "Generate a signing secret first." : undefined}
                      onClick={() => void sendTest()}
                    >
                      Send test
                    </SettingsButton>
                    <SettingsButton type="button" variant="secondary" disabled={deliveriesLoading} onClick={() => void loadDeliveries(endpoint.id)}>
                      Refresh deliveries
                    </SettingsButton>
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
                title="Danger zone"
                description="Permanently remove this webhook endpoint and its delivery history."
              >
                <SettingsButton type="button" variant="danger" disabled={actionBusy} onClick={requestDelete}>
                  Delete endpoint
                </SettingsButton>
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
