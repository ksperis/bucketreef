import { describe, expect, it } from "vitest";
import { formatWebhookDate, webhookDeliveryTone } from "./webhookPresentation";

describe("webhookPresentation", () => {
  it("maps webhook delivery states to list badge tones", () => {
    expect(webhookDeliveryTone("delivered")).toBe("success");
    expect(webhookDeliveryTone("failed")).toBe("danger");
    expect(webhookDeliveryTone("retrying")).toBe("warning");
    expect(webhookDeliveryTone("pending")).toBe("neutral");
  });

  it("formats webhook dates while preserving invalid source values", () => {
    const value = "2026-09-03T08:30:00Z";
    expect(formatWebhookDate(value, "en-US")).toBe(new Date(value).toLocaleString("en-US"));
    expect(formatWebhookDate("not-a-date", "en-US")).toBe("not-a-date");
    expect(formatWebhookDate(null, "en-US")).toBe("-");
  });
});
