/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BillingSettingsPage from "./BillingSettingsPage";

const mocks = vi.hoisted(() => ({
  listCards: vi.fn(),
  listEndpoints: vi.fn(),
  createVersion: vi.fn(),
  remove: vi.fn(),
  listEntities: vi.fn(),
  previewEntity: vi.fn(),
  createEntity: vi.fn(),
  updateEntity: vi.fn(),
  deactivateEntity: vi.fn(),
  searchSubjects: vi.fn(),
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deactivateGroup: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock("../../api/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/billing")>()),
  listBillingRateCards: () => mocks.listCards(),
  createBillingRateCard: vi.fn(),
  updateBillingRateCard: vi.fn(),
  createBillingRateCardVersion: (...args: unknown[]) => mocks.createVersion(...args),
  deleteBillingRateCard: (id: number) => mocks.remove(id),
  listBillingEntities: (...args: unknown[]) => mocks.listEntities(...args),
  previewBillingEntity: (...args: unknown[]) => mocks.previewEntity(...args),
  createBillingEntity: (...args: unknown[]) => mocks.createEntity(...args),
  updateBillingEntity: (...args: unknown[]) => mocks.updateEntity(...args),
  deactivateBillingEntity: (...args: unknown[]) => mocks.deactivateEntity(...args),
  searchBillingEntitySubjects: (...args: unknown[]) => mocks.searchSubjects(...args),
  listBillingEntityGroups: (...args: unknown[]) => mocks.listGroups(...args),
  createBillingEntityGroup: (...args: unknown[]) => mocks.createGroup(...args),
  updateBillingEntityGroup: (...args: unknown[]) => mocks.updateGroup(...args),
  deactivateBillingEntityGroup: (...args: unknown[]) => mocks.deactivateGroup(...args),
}));

vi.mock("../../api/storageEndpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/storageEndpoints")>()),
  listStorageEndpoints: () => mocks.listEndpoints(),
}));

vi.mock("../../api/tags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/tags")>()),
  listAdminTagDefinitions: (...args: unknown[]) => mocks.listTags(...args),
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
    mocks.listTags.mockResolvedValue([
      { id: 101, label: "research", color_key: "sky", scope: "administrative" },
      { id: 102, label: "dsi", color_key: "violet", scope: "standard" },
    ]);
    mocks.listEntities.mockResolvedValue([
      {
        id: 31,
        name: "Research unit",
        code: "RES",
        external_id: "cost-center-42",
        subject_type: "account",
        active: true,
        include_tags: [{ id: 101, label: "research", color_key: "sky", scope: "administrative" }],
        explicit_includes: [],
        explicit_excludes: [],
        rate_assignments: [],
        member_count: 2,
        conflict_count: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    mocks.searchSubjects.mockResolvedValue([]);
    mocks.previewEntity.mockResolvedValue({
      entities: [],
      unassigned: [],
      conflicts: [],
    });
    mocks.createEntity.mockResolvedValue({});
    mocks.updateEntity.mockResolvedValue({});
    mocks.deactivateEntity.mockResolvedValue({});
    mocks.listGroups.mockResolvedValue([
      {
        id: 41,
        name: "Research portfolio",
        code: "RESEARCH",
        external_id: "org-research",
        description: "Research entities",
        active: true,
        memberships: [
          {
            id: 501,
            billing_entity_id: 31,
            billing_entity_name: "Research unit",
            billing_entity_code: "RES",
            billing_entity_active: true,
            effective_from: "2026-01-01",
            effective_to: null,
            status: "current",
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
        current_member_count: 1,
        scheduled_membership_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    mocks.createGroup.mockResolvedValue({});
    mocks.updateGroup.mockResolvedValue({});
    mocks.deactivateGroup.mockResolvedValue({});
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
    expect(screen.getByLabelText("Storage / measured GiB-month")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Storage billing"), { target: { value: "allocated_quota" } });
    expect(screen.getByLabelText("Storage / allocated GiB-month")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create version" }));

    await waitFor(() => expect(mocks.createVersion).toHaveBeenCalledTimes(1));
    expect(mocks.createVersion.mock.calls[0][0]).toBe(1);
    expect(mocks.createVersion.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        currency: "EUR",
        storage_charge_basis: "allocated_quota",
        storage_gb_month_price: "0.02",
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

  it("creates a Billing Entity from Admin-managed tags and previews canonical membership conflicts", async () => {
    mocks.previewEntity.mockResolvedValue({
      entities: [
        {
          entity_id: 31,
          entity_name: "Research unit",
          subject_type: "account",
          members: [
            {
              subject_type: "account",
              subject_id: 7,
              name: "Shared account",
              rgw_identifier: "RGW-SHARED",
              storage_endpoint_id: 3,
              storage_endpoint_name: "Ceph production",
              reasons: [{ kind: "tag", tag_definition_id: 101, label: "research" }],
            },
          ],
          excluded: [],
        },
        {
          entity_id: null,
          entity_name: "DSI",
          subject_type: "account",
          members: [
            {
              subject_type: "account",
              subject_id: 7,
              name: "Shared account",
              rgw_identifier: "RGW-SHARED",
              storage_endpoint_id: 3,
              storage_endpoint_name: "Ceph production",
              reasons: [{ kind: "tag", tag_definition_id: 102, label: "dsi" }],
            },
          ],
          excluded: [],
        },
      ],
      unassigned: [],
      conflicts: [
        {
          subject: {
            subject_type: "account",
            subject_id: 7,
            name: "Shared account",
            rgw_identifier: "RGW-SHARED",
            storage_endpoint_id: 3,
            storage_endpoint_name: "Ceph production",
          },
          entities: [
            { entity_id: 31, entity_name: "Research unit" },
            { entity_id: null, entity_name: "DSI" },
          ],
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/admin/billing-settings"]}>
        <BillingSettingsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ceph production/);
    fireEvent.click(screen.getByRole("tab", { name: "Billing Entities" }));
    expect(await screen.findByText("Research unit")).toBeInTheDocument();
    expect(screen.getByText("1 conflicts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Billing Entity" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "DSI" } });
    fireEvent.click(screen.getByRole("button", { name: "Include tag dsi" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview membership" }));

    await waitFor(() => expect(mocks.previewEntity).toHaveBeenCalledTimes(1));
    expect(mocks.previewEntity.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        name: "DSI",
        subject_type: "account",
        include_tag_ids: [102],
      }),
    );
    expect(await screen.findByText(/subject would belong to multiple active Billing Entities/)).toBeInTheDocument();
    expect(screen.getAllByText("Shared account")).toHaveLength(2);
    expect(screen.getByText(/Tag: dsi/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.createEntity).toHaveBeenCalledTimes(1));
    expect(mocks.createEntity.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        name: "DSI",
        include_tag_ids: [102],
        explicit_include_ids: [],
        explicit_exclude_ids: [],
      }),
    );
  });

  it("protects unsaved Billing Entity edits and confirms deactivation", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/billing-settings"]}>
        <BillingSettingsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ceph production/);
    fireEvent.click(screen.getByRole("tab", { name: "Billing Entities" }));
    await screen.findByText("Research unit");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "RESEARCH" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const deactivateDialog = screen.getByRole("dialog", { name: "Deactivate Billing Entity?" });
    expect(deactivateDialog).toBeInTheDocument();
    fireEvent.click(within(deactivateDialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(mocks.deactivateEntity).toHaveBeenCalledWith(31));
  });

  it("creates a Billing Group with month-aligned Billing Entity membership", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/billing-settings"]}>
        <BillingSettingsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ceph production/);
    fireEvent.click(screen.getByRole("tab", { name: "Billing Groups" }));
    expect(await screen.findByText("Research portfolio")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Billing Group" }));
    const dialog = screen.getByRole("dialog", { name: "Create Billing Group" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "DSI" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add membership period" }));

    expect(within(dialog).getByLabelText("Billing Entity")).toHaveValue("31");
    expect((within(dialog).getByLabelText("Effective from") as HTMLInputElement).value).toMatch(/-01$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.createGroup).toHaveBeenCalledTimes(1));
    expect(mocks.createGroup.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        name: "DSI",
        memberships: [
          expect.objectContaining({
            billing_entity_id: 31,
            effective_from: expect.stringMatching(/-01$/),
            effective_to: null,
          }),
        ],
      }),
    );
  });

  it("validates group period overlap, guards dirty edits, and confirms deactivation", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/billing-settings"]}>
        <BillingSettingsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ceph production/);
    fireEvent.click(screen.getByRole("tab", { name: "Billing Groups" }));
    await screen.findByText("Research portfolio");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Edit Billing Group" });
    fireEvent.click(within(editor).getByRole("button", { name: "Add membership period" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(
      within(editor).getByText("Group membership periods for the same entity must not overlap."),
    ).toBeInTheDocument();
    expect(mocks.updateGroup).not.toHaveBeenCalled();

    const removeButtons = within(editor).getAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[1]);
    fireEvent.change(within(editor).getByLabelText("Description"), {
      target: { value: "Changed description" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const deactivateDialog = screen.getByRole("dialog", { name: "Deactivate Billing Group?" });
    fireEvent.click(within(deactivateDialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(mocks.deactivateGroup).toHaveBeenCalledWith(41));
  });
});
