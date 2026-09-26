/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebhookEndpoint } from "../../api/webhooks";
import WebhookSettingsPage from "./WebhookSettingsPage";

const mocks = vi.hoisted(() => ({
  deleteEndpoint: vi.fn(),
  listEndpoints: vi.fn(),
  sendTest: vi.fn(),
}));

vi.mock("../../api/webhooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/webhooks")>()),
  deleteWebhookEndpoint: (id: number) => mocks.deleteEndpoint(id),
  listWebhookEndpoints: () => mocks.listEndpoints(),
  sendWebhookTest: (id: number) => mocks.sendTest(id),
}));

vi.mock("../../auth/useRecentWebAuthnStepUp", () => ({
  isRecentWebAuthnVerificationCancelled: () => false,
  useRecentWebAuthnStepUp: () => ({
    runWithStepUp: async (action: () => Promise<unknown>) => action(),
    verificationDialog: null,
  }),
}));

const timestamp = "2026-09-26T08:30:00Z";

const configuredEndpoint: WebhookEndpoint = {
  id: 7,
  name: "Operations automation",
  url: "https://hooks.example.net/bucketreef?token=hidden",
  enabled: true,
  event_types: ["*"],
  has_signing_secret: true,
  last_delivery: {
    id: 1,
    delivery_id: "delivery-1",
    event_id: "event-1",
    endpoint_id: 7,
    event_type: "system.endpoint_health.changed",
    is_test: false,
    status: "delivered",
    attempt_count: 1,
    next_attempt_at: timestamp,
    last_http_status: 204,
    last_error: null,
    created_at: timestamp,
    updated_at: timestamp,
    delivered_at: timestamp,
  },
  created_at: timestamp,
  updated_at: timestamp,
};

const importedEndpoint: WebhookEndpoint = {
  id: 9,
  name: "Imported migration webhook 1",
  url: "https://migration.example.net/callback",
  enabled: false,
  event_types: ["manager.bucket_migration.event"],
  has_signing_secret: false,
  last_delivery: null,
  created_at: timestamp,
  updated_at: timestamp,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/webhook-settings"]}>
      <WebhookSettingsPage />
    </MemoryRouter>,
  );
}

describe("WebhookSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listEndpoints.mockResolvedValue([configuredEndpoint, importedEndpoint]);
    mocks.sendTest.mockResolvedValue("delivery-test-1");
    mocks.deleteEndpoint.mockResolvedValue(undefined);
  });

  it("lists endpoints, searches their configuration and protects imported endpoints without a secret", async () => {
    renderPage();

    expect(await screen.findByText("Operations automation")).toBeInTheDocument();
    expect(screen.getByText("Imported migration webhook 1")).toBeInTheDocument();
    expect(screen.getByText("hooks.example.net")).toBeInTheDocument();
    expect(screen.queryByText(/token=hidden/)).not.toBeInTheDocument();
    expect(screen.getByText("Signing secret required")).toBeInTheDocument();

    const tests = screen.getAllByRole("button", { name: "Test" });
    expect(tests).toHaveLength(2);
    expect(tests[0]).toBeEnabled();
    expect(tests[1]).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Search webhook endpoints" }), {
      target: { value: "migration" },
    });
    expect(screen.queryByText("Operations automation")).not.toBeInTheDocument();
    expect(screen.getByText("Imported migration webhook 1")).toBeInTheDocument();
  });

  it("queues a test delivery and deletes an endpoint through the shared confirmation flow", async () => {
    renderPage();
    await screen.findByText("Operations automation");

    fireEvent.click(screen.getAllByRole("button", { name: "Test" })[0]);
    await waitFor(() => expect(mocks.sendTest).toHaveBeenCalledWith(7));
    expect(await screen.findByText("Test delivery queued (delivery-test-1).")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Delete webhook endpoint?" });
    expect(within(dialog).getByText("hooks.example.net")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete endpoint" }));

    await waitFor(() => expect(mocks.deleteEndpoint).toHaveBeenCalledWith(7));
    expect(screen.queryByText("Operations automation")).not.toBeInTheDocument();
    expect(screen.getByText("Webhook endpoint “Operations automation” deleted.")).toBeInTheDocument();
  });
});
