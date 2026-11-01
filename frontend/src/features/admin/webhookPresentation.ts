/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { WebhookDeliveryStatus } from "../../api/webhooks";

export function formatWebhookDate(
  value: string | null | undefined,
  intlLocale: string,
): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(intlLocale);
}

export function webhookDeliveryTone(
  status: WebhookDeliveryStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "failed") return "danger";
  if (status === "retrying") return "warning";
  return "neutral";
}
