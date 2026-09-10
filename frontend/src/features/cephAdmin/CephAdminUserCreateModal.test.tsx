import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminUserCreateModal from "./CephAdminUserCreateModal";
import { setSessionUserCache } from "../../utils/workspaces";

const createCephAdminUserMock = vi.fn();
const listCephAdminAccountsMock = vi.fn();

vi.mock("../../api/cephAdminUsers", () => ({
  createCephAdminUser: (...args: unknown[]) => createCephAdminUserMock(...args),
}));

vi.mock("../../api/cephAdminAccounts", () => ({
  listCephAdminAccounts: (...args: unknown[]) => listCephAdminAccountsMock(...args),
}));

describe("CephAdminUserCreateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionUserCache({
      role: "ui_superadmin",
      effective_access: { can_create_manual_private_connections: true },
    });
    listCephAdminAccountsMock.mockResolvedValue({
      items: [
        {
          account_id: "RGW000000000000001",
          account_name: "Analytics",
        },
      ],
    });
    createCephAdminUserMock.mockResolvedValue({
      detail: {
        uid: "alice",
        display_name: "Alice Ops",
        caps: [],
        keys: [],
      },
      generated_key: null,
    });
  });

  it("uses shared form controls and submits normalized quota and caps fields", async () => {
    const onCreated = vi.fn();
    render(<CephAdminUserCreateModal endpointId={7} onClose={vi.fn()} onCreated={onCreated} />);

    const dialog = screen.getByRole("heading", { name: "Create user" }).closest(".workflow-page");
    if (!dialog) {
      throw new Error("Create user workflow page not found");
    }
    const accountSelect = within(dialog).getByLabelText("Account (optional)");
    expect(accountSelect).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("UID")).toHaveClass("ui-control");
    expect(within(dialog).getByRole("textbox", { name: "Caps", exact: true })).toHaveClass("ui-control");

    await screen.findByRole("option", { name: "Analytics (RGW000000000000001)" });

    const userQuotaSection = within(dialog).getByText("User quota").closest("section");
    if (!userQuotaSection) {
      throw new Error("User quota section not found");
    }
    expect(within(userQuotaSection).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(userQuotaSection).getByLabelText("Unit")).toHaveClass("ui-control");
    expect(within(userQuotaSection).getByLabelText("Object quota")).toHaveClass("ui-control");

    fireEvent.change(accountSelect, { target: { value: "RGW000000000000001" } });
    fireEvent.change(within(dialog).getByLabelText("UID"), { target: { value: "alice" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Alice Ops" } });
    fireEvent.change(within(dialog).getByLabelText("Max buckets"), { target: { value: "8" } });
    fireEvent.click(within(userQuotaSection).getByRole("checkbox", { name: "Enable user quota" }));
    fireEvent.change(within(userQuotaSection).getByLabelText("Storage quota"), { target: { value: "3" } });
    fireEvent.change(within(userQuotaSection).getByLabelText("Object quota"), { target: { value: "1200" } });
    fireEvent.change(within(dialog).getByLabelText("Caps mode"), { target: { value: "add" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Caps", exact: true }), {
      target: { value: "users=read\nusage=read\nusers=read" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(createCephAdminUserMock).toHaveBeenCalled();
    });

    expect(createCephAdminUserMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        uid: "alice",
        account_id: "RGW000000000000001",
        display_name: "Alice Ops",
        account_root: true,
        generate_key: true,
        max_buckets: 8,
        quota_enabled: true,
        quota_max_size_bytes: 3 * 1024 ** 3,
        quota_max_objects: 1200,
        caps: {
          mode: "add",
          values: ["users=read", "usage=read"],
        },
      })
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ uid: "alice" }));
  });

  it("shows generated keys in the shared one-time secret panel", async () => {
    createCephAdminUserMock.mockResolvedValue({
      detail: {
        uid: "bob",
        display_name: "Bob Ops",
        caps: [],
        keys: [],
      },
      generated_key: {
        access_key: "AKIA-CEPH-BOB",
        secret_key: "SECRET-CEPH-BOB",
      },
    });

    render(<CephAdminUserCreateModal endpointId={7} onClose={vi.fn()} />);

    const dialog = screen.getByRole("heading", { name: "Create user" }).closest(".workflow-page");
    if (!dialog) {
      throw new Error("Create user workflow page not found");
    }
    fireEvent.change(within(dialog).getByLabelText("UID"), { target: { value: "bob" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Bob Ops" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(await within(dialog).findByText("Access key created")).toBeInTheDocument();
    expect(within(dialog).getByText("Secret is shown only once.")).toBeInTheDocument();
    expect(within(dialog).getByText("AKIA-CEPH-BOB")).toHaveClass("font-mono");
    expect(within(dialog).getByText("SECRET-CEPH-BOB")).toHaveClass("font-mono");
    expect(within(dialog).getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "Add as S3 Connection" })).toHaveClass("h-7");
  });

  it("hides Add as S3 Connection without manual creation permission", async () => {
    setSessionUserCache({
      role: "ui_superadmin",
      effective_access: { can_create_manual_private_connections: false },
    });
    createCephAdminUserMock.mockResolvedValue({
      detail: { uid: "carol", display_name: "Carol Ops", caps: [], keys: [] },
      generated_key: { access_key: "AKIA-CEPH-CAROL", secret_key: "SECRET-CEPH-CAROL" },
    });

    render(<CephAdminUserCreateModal endpointId={7} onClose={vi.fn()} />);
    const dialog = screen.getByRole("heading", { name: "Create user" }).closest(".workflow-page");
    if (!dialog) throw new Error("Create user workflow page not found");
    fireEvent.change(within(dialog).getByLabelText("UID"), { target: { value: "carol" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Carol Ops" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(await within(dialog).findByText("Access key created")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add as S3 Connection" })).not.toBeInTheDocument();
  });

  it("associates validation with each field and lets the user correct an account and tenant conflict", async () => {
    render(<CephAdminUserCreateModal endpointId={7} onClose={vi.fn()} />);
    await screen.findByRole("option", { name: "Analytics (RGW000000000000001)" });
    const form = screen.getByRole("form", { name: "Create RGW user" });
    fireEvent.submit(form);
    expect(screen.getByLabelText("UID")).toHaveAccessibleDescription("UID is required.");
    await waitFor(() => expect(screen.getByLabelText("UID")).toHaveFocus());
    expect(createCephAdminUserMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("UID"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "tenant-a" } });
    fireEvent.change(screen.getByLabelText("Account (optional)"), { target: { value: "RGW000000000000001" } });
    expect(screen.getByLabelText("Tenant")).toBeEnabled();
    expect(screen.getByLabelText("Tenant")).toHaveAccessibleDescription(/Tenant cannot be used/);
    fireEvent.change(screen.getByLabelText("Max buckets"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByLabelText("Enable user quota"));
    fireEvent.change(screen.getByLabelText("Storage quota"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("Object quota"), { target: { value: "-1" } });
    fireEvent.submit(form);
    for (const label of ["Tenant", "Max buckets", "Storage quota", "Object quota"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    }
    expect(createCephAdminUserMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "" } });
    for (const label of ["Max buckets", "Storage quota", "Object quota"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid", "true");
    }
    fireEvent.submit(form);
    await waitFor(() => expect(createCephAdminUserMock).toHaveBeenCalledWith(7, expect.objectContaining({
      uid: "alice", account_root: true, tenant: undefined, max_buckets: 0, quota_max_size_bytes: 0, quota_max_objects: 0,
    })));
  });

  it("freezes the submitted draft and preserves it after an API failure", async () => {
    let rejectRequest!: (error: Error) => void;
    createCephAdminUserMock.mockReturnValueOnce(new Promise((_, reject) => { rejectRequest = reject; }));
    const onClose = vi.fn();
    render(<CephAdminUserCreateModal endpointId={7} onClose={onClose} />);
    await screen.findByRole("option", { name: "Analytics (RGW000000000000001)" });
    const form = screen.getByRole("form", { name: "Create RGW user" });
    fireEvent.change(screen.getByLabelText("UID"), { target: { value: "alice" } });
    fireEvent.submit(form);
    for (const field of form.querySelectorAll("input, select, textarea")) expect(field).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to users" }));
    fireEvent.submit(form);
    expect(onClose).not.toHaveBeenCalled();
    expect(createCephAdminUserMock).toHaveBeenCalledTimes(1);
    await act(async () => rejectRequest(new Error("RGW temporarily unavailable")));
    expect(await screen.findByText("RGW temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("UID")).toHaveValue("alice");
    expect(screen.getByLabelText("UID")).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Create user" })).toBeEnabled();
  });
});
