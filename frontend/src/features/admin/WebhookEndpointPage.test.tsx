/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { transferableAbortController } from "node:util";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointCreated,
  WebhookEndpointPayload,
  WebhookEventDefinition,
} from "../../api/webhooks";
import WebhookEndpointPage from "./WebhookEndpointPage";

const mocks = vi.hoisted(() => ({
  createEndpoint: vi.fn(),
  deleteEndpoint: vi.fn(),
  getEndpoint: vi.fn(),
  listDeliveries: vi.fn(),
  listEvents: vi.fn(),
  rotateSecret: vi.fn(),
  sendTest: vi.fn(),
  updateEndpoint: vi.fn(),
}));

vi.mock("../../api/webhooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/webhooks")>()),
  createWebhookEndpoint: (payload: WebhookEndpointPayload) => mocks.createEndpoint(payload),
  deleteWebhookEndpoint: (id: number) => mocks.deleteEndpoint(id),
  getWebhookEndpoint: (id: number) => mocks.getEndpoint(id),
  listWebhookDeliveries: (id: number, limit?: number) => mocks.listDeliveries(id, limit),
  listWebhookEvents: () => mocks.listEvents(),
  rotateWebhookSecret: (id: number) => mocks.rotateSecret(id),
  sendWebhookTest: (id: number) => mocks.sendTest(id),
  updateWebhookEndpoint: (id: number, payload: WebhookEndpointPayload) => mocks.updateEndpoint(id, payload),
}));

vi.mock("../../auth/useRecentWebAuthnStepUp", () => ({
  isRecentWebAuthnVerificationCancelled: () => false,
  useRecentWebAuthnStepUp: () => ({
    runWithStepUp: async (action: () => Promise<unknown>) => action(),
    verificationDialog: null,
  }),
}));

vi.mock("../../utils/workspaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/workspaces")>()),
  readStoredUser: () => ({ id: 1, email: "admin@example.test", role: "superadmin" }),
}));

const timestamp = "2026-09-26T08:30:00Z";
const events: WebhookEventDefinition[] = [
  {
    type: "manager.bucket_migration.event",
    category: "Migration",
    label: "Bucket migration event",
    description: "Detailed migration progress.",
  },
  {
    type: "audit.admin.settings.update",
    category: "Platform & Settings",
    label: "Settings update",
    description: "BucketReef admin control-plane action.",
  },
];

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

const delivery: WebhookDelivery = {
  id: 22,
  delivery_id: "delivery-22",
  event_id: "event-11",
  endpoint_id: 9,
  event_type: "manager.bucket_migration.event",
  is_test: false,
  status: "failed",
  attempt_count: 3,
  next_attempt_at: timestamp,
  last_http_status: 503,
  last_error: "HTTP 503",
  created_at: timestamp,
  updated_at: timestamp,
  delivered_at: null,
};

function renderPage(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/admin/webhook-settings", element: <h1>Webhook list</h1> },
      { path: "/admin/webhook-settings/new", element: <WebhookEndpointPage /> },
      { path: "/admin/webhook-settings/:endpointId", element: <WebhookEndpointPage /> },
      { path: "/other", element: <h1>Other page</h1> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("WebhookEndpointPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("AbortController", function () {
      return transferableAbortController();
    });
    mocks.listEvents.mockResolvedValue(events);
    mocks.getEndpoint.mockResolvedValue(importedEndpoint);
    mocks.listDeliveries.mockResolvedValue([delivery]);
    mocks.rotateSecret.mockResolvedValue("rotated-webhook-secret");
    mocks.sendTest.mockResolvedValue("test-delivery-1");
    mocks.deleteEndpoint.mockResolvedValue(undefined);
    mocks.updateEndpoint.mockImplementation(async (_id: number, payload: WebhookEndpointPayload) => ({
      ...importedEndpoint,
      ...payload,
      has_signing_secret: true,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an endpoint with the wildcard subscription and preserves the one-time secret after redirect", async () => {
    const created: WebhookEndpointCreated = {
      id: 12,
      name: "Automation",
      url: "https://hooks.example.net/bucketreef",
      enabled: false,
      event_types: ["*"],
      has_signing_secret: true,
      signing_secret: "one-time-created-secret",
      last_delivery: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    mocks.createEndpoint.mockResolvedValue(created);
    mocks.getEndpoint.mockResolvedValue(created);
    mocks.listDeliveries.mockResolvedValue([]);
    const router = renderPage("/admin/webhook-settings/new");

    expect(await screen.findByRole("checkbox", { name: /All events/ })).toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: " Automation " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Target URL" }), {
      target: { value: " https://hooks.example.net/bucketreef " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create endpoint" }));

    await waitFor(() => expect(mocks.createEndpoint).toHaveBeenCalledWith({
      name: "Automation",
      url: "https://hooks.example.net/bucketreef",
      enabled: false,
      event_types: ["*"],
    }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/webhook-settings/12"));
    expect(await screen.findByText("one-time-created-secret")).toBeInTheDocument();
    expect(screen.getByText("One-time display")).toBeInTheDocument();
    expect(screen.getByText("Webhook endpoint created.")).toBeInTheDocument();
  });

  it("handles imported endpoints without a secret, rotates the secret and exposes delivery history", async () => {
    renderPage("/admin/webhook-settings/9");

    expect(await screen.findByRole("heading", { name: "Edit webhook: Imported migration webhook 1" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Endpoint enabled" })).toBeDisabled();
    expect(screen.getAllByText("Signing secret required").length).toBeGreaterThan(0);
    expect(screen.getByText("HTTP 503")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate secret" }));
    const generateDialog = screen.getByRole("dialog", { name: "Generate signing secret?" });
    fireEvent.click(within(generateDialog).getByRole("button", { name: "Generate secret" }));

    expect(await screen.findByText("rotated-webhook-secret")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Endpoint enabled" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rotate secret" })).toBeInTheDocument();

    mocks.rotateSecret.mockResolvedValueOnce("second-webhook-secret");
    fireEvent.click(screen.getByRole("button", { name: "Rotate secret" }));
    const rotateDialog = screen.getByRole("dialog", { name: "Rotate signing secret?" });
    fireEvent.click(within(rotateDialog).getByRole("button", { name: "Rotate secret" }));
    expect(await screen.findByText("second-webhook-secret")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(mocks.sendTest).toHaveBeenCalledWith(9));
    expect(
      await screen.findByText("Test delivery queued (test-delivery-1)."),
    ).toBeInTheDocument();
    expect(mocks.listDeliveries.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("switches from wildcard to explicit event filters and protects dirty navigation", async () => {
    mocks.createEndpoint.mockResolvedValue({
      id: 14,
      name: "Migration automation",
      url: "https://hooks.example.net/migration",
      enabled: false,
      event_types: ["manager.bucket_migration.event"],
      has_signing_secret: true,
      signing_secret: "created-secret",
      last_delivery: null,
      created_at: timestamp,
      updated_at: timestamp,
    } satisfies WebhookEndpointCreated);
    const router = renderPage("/admin/webhook-settings/new");
    const allEvents = await screen.findByRole("checkbox", { name: /All events/ });
    fireEvent.click(allEvents);
    expect(screen.getByText("Select at least one event or use All events.")).toBeInTheDocument();

    const migrationEvent = screen.getByRole("checkbox", { name: /Bucket migration event/ });
    fireEvent.click(migrationEvent);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Migration automation" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Target URL" }), {
      target: { value: "https://hooks.example.net/migration" },
    });

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await act(async () => { void router.navigate("/other"); });
    const guard = screen.getByRole("dialog", { name: "Discard changes?" });
    fireEvent.click(within(guard).getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe("/admin/webhook-settings/new");

    fireEvent.click(screen.getByRole("button", { name: "Create endpoint" }));
    await waitFor(() => expect(mocks.createEndpoint).toHaveBeenCalledWith({
      name: "Migration automation",
      url: "https://hooks.example.net/migration",
      enabled: false,
      event_types: ["manager.bucket_migration.event"],
    }));
  });
});
