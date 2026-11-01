/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { WebhookDeliveryStatus } from "../../api/webhooks";
import { formatLocalDateTime } from "../../utils/dateTime";

export function formatWebhookDate(
  value: string | null | undefined,
  intlLocale: string,
): string {
  return formatLocalDateTime(value, intlLocale);
}

export function webhookDeliveryTone(
  status: WebhookDeliveryStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "failed") return "danger";
  if (status === "retrying") return "warning";
  return "neutral";
}
