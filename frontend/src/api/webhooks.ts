/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import client from "./client";

export type WebhookDeliveryStatus = "pending" | "retrying" | "delivered" | "failed";

export type WebhookDelivery = {
  id: number;
  delivery_id: string;
  event_id: string;
  endpoint_id: number;
  event_type: string;
  is_test: boolean;
  status: WebhookDeliveryStatus;
  attempt_count: number;
  next_attempt_at: string;
  last_http_status?: number | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
  delivered_at?: string | null;
};

export type WebhookEndpoint = {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  event_types: string[];
  has_signing_secret: boolean;
  last_delivery?: WebhookDelivery | null;
  created_at: string;
  updated_at: string;
};

export type WebhookEndpointCreated = WebhookEndpoint & {
  signing_secret: string;
};

export type WebhookEndpointPayload = {
  name: string;
  url: string;
  enabled: boolean;
  event_types: string[];
};

export type WebhookEventDefinition = {
  type: string;
  category: string;
  label: string;
  description: string;
};

export async function listWebhookEndpoints(): Promise<WebhookEndpoint[]> {
  const { data } = await client.get<WebhookEndpoint[]>("/admin/settings/webhooks");
  return data;
}

export async function getWebhookEndpoint(endpointId: number): Promise<WebhookEndpoint> {
  const { data } = await client.get<WebhookEndpoint>(`/admin/settings/webhooks/${endpointId}`);
  return data;
}

export async function listWebhookEvents(): Promise<WebhookEventDefinition[]> {
  const { data } = await client.get<WebhookEventDefinition[]>("/admin/settings/webhooks/events");
  return data;
}

export async function createWebhookEndpoint(payload: WebhookEndpointPayload): Promise<WebhookEndpointCreated> {
  const { data } = await client.post<WebhookEndpointCreated>("/admin/settings/webhooks", payload);
  return data;
}

export async function updateWebhookEndpoint(
  endpointId: number,
  payload: WebhookEndpointPayload,
): Promise<WebhookEndpoint> {
  const { data } = await client.put<WebhookEndpoint>(`/admin/settings/webhooks/${endpointId}`, payload);
  return data;
}

export async function deleteWebhookEndpoint(endpointId: number): Promise<void> {
  await client.delete(`/admin/settings/webhooks/${endpointId}`);
}

export async function rotateWebhookSecret(endpointId: number): Promise<string> {
  const { data } = await client.post<{ endpoint_id: number; signing_secret: string }>(
    `/admin/settings/webhooks/${endpointId}/rotate-secret`,
  );
  return data.signing_secret;
}

export async function sendWebhookTest(endpointId: number): Promise<string> {
  const { data } = await client.post<{ delivery_id: string; status: string }>(
    `/admin/settings/webhooks/${endpointId}/test`,
  );
  return data.delivery_id;
}

export async function listWebhookDeliveries(endpointId: number, limit = 100): Promise<WebhookDelivery[]> {
  const { data } = await client.get<WebhookDelivery[]>(`/admin/settings/webhooks/${endpointId}/deliveries`, {
    params: { limit },
  });
  return data;
}
