/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BillingSettingsPage from "./BillingSettingsPage";

const mocks = vi.hoisted(() => ({
  listCards: vi.fn(),
  listEndpoints: vi.fn(),
  createVersion: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../api/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/billing")>()),
  listBillingRateCards: () => mocks.listCards(),
  createBillingRateCard: vi.fn(),
  updateBillingRateCard: vi.fn(),
  createBillingRateCardVersion: (...args: unknown[]) => mocks.createVersion(...args),
  deleteBillingRateCard: (id: number) => mocks.remove(id),
}));

vi.mock("../../api/storageEndpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/storageEndpoints")>()),
  listStorageEndpoints: () => mocks.listEndpoints(),
}));

const timestamp = "2026-10-18T10:00:00Z";

describe("BillingSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listEndpoints.mockResolvedValue([
      { id: 3, name: "Ceph production" },
    ]);
    mocks.listCards.mockResolvedValue([
      {
        id: 1,
        rate_plan_id: 10,
        name: "default",
        currency: "EUR",
        storage_charge_basis: "actual_usage",
        storage_gb_month_price: 0.02,
        egress_gb_price: 0.08,
        ingress_gb_price: 0,
        requests_per_1000_price: 0.004,
        effective_from: "2026-10-01",
        effective_to: null,
        storage_endpoint_id: null,
        storage_endpoint_name: null,
        status: "active",
        editable: false,
        identity_editable: false,
        deletable: false,
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: 2,
        rate_plan_id: 20,
        name: "premium",
        currency: "EUR",
        storage_charge_basis: "allocated_quota",
        storage_gb_month_price: 0.03,
        egress_gb_price: 0.1,
        ingress_gb_price: 0,
        requests_per_1000_price: 0.005,
        effective_from: "2026-11-01",
        effective_to: null,
        storage_endpoint_id: 3,
        storage_endpoint_name: "Ceph production",
        status: "future",
        editable: true,
        identity_editable: false,
        deletable: true,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
  });

  it("shows immutable active pricing and editable future endpoint pricing", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/billing-settings"]}>
        <BillingSettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Ceph production/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new version" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(screen.getByText("Allocated quota")).toBeInTheDocument();
  });

  it("prefills a new version and submits it against the active rate card", async () => {
    mocks.createVersion.mockResolvedValue({});
    render(
      <MemoryRouter initialEntries={["/admin/billing-settings"]}>
        <BillingSettingsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ceph production/);

    fireEvent.click(screen.getByRole("button", { name: "Create new version" }));
    const dialog = screen.getByRole("dialog", { name: "Create billing rate version" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Create version" }));

    await waitFor(() => expect(mocks.createVersion).toHaveBeenCalledTimes(1));
    expect(mocks.createVersion.mock.calls[0][0]).toBe(1);
    expect(mocks.createVersion.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        currency: "EUR",
        storage_charge_basis: "actual_usage",
        storage_gb_month_price: 0.02,
        effective_from: expect.stringMatching(/-01$/),
      }),
    );
  });

  it("guards dirty editor close and keeps a historical plan identity locked", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/billing-settings"]}>
        <BillingSettingsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ceph production/);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Scope")).toBeDisabled();
    expect(screen.getByLabelText("S3 Endpoint")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("dialog", { name: "Edit billing rate card" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit billing rate card" })).not.toBeInTheDocument(),
    );
  });
});
