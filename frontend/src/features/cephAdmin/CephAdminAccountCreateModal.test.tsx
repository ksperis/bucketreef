import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAccountCreateModal from "./CephAdminAccountCreateModal";

const createCephAdminAccountMock = vi.fn();

vi.mock("../../api/cephAdminAccounts", () => ({
  createCephAdminAccount: (...args: unknown[]) => createCephAdminAccountMock(...args),
}));

describe("CephAdminAccountCreateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCephAdminAccountMock.mockResolvedValue({
      account: {
        account_id: "RGW000000000000001",
        account_name: "analytics",
      },
    });
  });

  it("uses shared form controls and submits normalized quota fields", async () => {
    const onCreated = vi.fn();
    render(<CephAdminAccountCreateModal endpointId={7} onClose={vi.fn()} onCreated={onCreated} />);

    const dialog = screen.getByRole("heading", { name: "Create account" }).closest(".workflow-page");
    if (!dialog) {
      throw new Error("Create account workflow page not found");
    }
    expect(within(dialog).getByLabelText("Account name")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Email")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Max access keys")).toHaveClass("ui-control");

    const accountQuotaSection = within(dialog).getByText("Account quota").closest("section");
    const bucketQuotaSection = within(dialog).getByText("Bucket quota").closest("section");
    if (!accountQuotaSection || !bucketQuotaSection) {
      throw new Error("Quota sections not found");
    }

    expect(within(accountQuotaSection).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(accountQuotaSection).getByLabelText("Unit")).toHaveClass("ui-control");
    expect(within(accountQuotaSection).getByLabelText("Object quota")).toHaveClass("ui-control");

    fireEvent.change(within(dialog).getByLabelText("Account name"), { target: { value: "analytics" } });
    fireEvent.change(within(dialog).getByLabelText("Max buckets"), { target: { value: "12" } });
    fireEvent.click(within(accountQuotaSection).getByRole("checkbox", { name: "Enable account quota" }));
    fireEvent.change(within(accountQuotaSection).getByLabelText("Storage quota"), { target: { value: "2" } });
    fireEvent.change(within(accountQuotaSection).getByLabelText("Object quota"), { target: { value: "1000" } });
    fireEvent.click(within(bucketQuotaSection).getByRole("checkbox", { name: "Enable bucket quota" }));
    fireEvent.change(within(bucketQuotaSection).getByLabelText("Storage quota"), { target: { value: "512" } });
    fireEvent.change(within(bucketQuotaSection).getByLabelText("Unit"), { target: { value: "MiB" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(createCephAdminAccountMock).toHaveBeenCalled();
    });

    expect(createCephAdminAccountMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        account_name: "analytics",
        max_buckets: 12,
        quota_enabled: true,
        quota_max_size_bytes: 2 * 1024 ** 3,
        quota_max_objects: 1000,
        bucket_quota_enabled: true,
        bucket_quota_max_size_bytes: 512 * 1024 ** 2,
      })
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ account_id: "RGW000000000000001" }));
  });

  it("focuses missing identity and invalid limits, then accepts zero without activating quotas", async () => {
    render(<CephAdminAccountCreateModal endpointId={7} onClose={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Create RGW account" });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByLabelText("Account name")).toHaveFocus());
    expect(screen.getByLabelText("Account name")).toHaveAccessibleDescription("Account name is required.");
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: " Analytics " } });
    expect(screen.getByLabelText("Account name")).not.toHaveAttribute("aria-invalid", "true");
    for (const label of ["Max buckets", "Max users", "Max roles", "Max groups", "Max access keys"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "-1" } });
    }
    fireEvent.submit(form);
    expect(createCephAdminAccountMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Max buckets")).toHaveFocus());
    for (const label of ["Max buckets", "Max users", "Max roles", "Max groups", "Max access keys"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid", "true");
    }
    fireEvent.submit(form);
    await waitFor(() => expect(createCephAdminAccountMock).toHaveBeenCalledOnce());
    expect(createCephAdminAccountMock.mock.calls[0][1]).toMatchObject({
      account_name: "Analytics", max_buckets: 0, max_users: 0, max_roles: 0, max_groups: 0, max_access_keys: 0,
      quota_enabled: undefined, bucket_quota_enabled: undefined,
    });
  });

  it("keeps quota validation independent and clears errors when corrected or disabled", async () => {
    render(<CephAdminAccountCreateModal endpointId={7} onClose={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Create RGW account" });
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Analytics" } });
    const account = within(screen.getByRole("region", { name: "Account quota" }));
    const bucket = within(screen.getByRole("region", { name: "Bucket quota" }));
    fireEvent.click(account.getByLabelText("Enable account quota"));
    fireEvent.click(bucket.getByLabelText("Enable bucket quota"));
    fireEvent.change(account.getByLabelText("Storage quota"), { target: { value: "-1" } });
    fireEvent.change(bucket.getByLabelText("Object quota"), { target: { value: "1.5" } });
    fireEvent.submit(form);
    expect(createCephAdminAccountMock).not.toHaveBeenCalled();
    await waitFor(() => expect(account.getByLabelText("Storage quota")).toHaveFocus());
    expect(bucket.getByLabelText("Object quota")).toHaveAccessibleDescription("Object quota must be a non-negative integer.");
    fireEvent.click(account.getByLabelText("Enable account quota"));
    expect(account.getByLabelText("Storage quota")).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.change(bucket.getByLabelText("Object quota"), { target: { value: "0" } });
    fireEvent.submit(form);
    await waitFor(() => expect(createCephAdminAccountMock).toHaveBeenCalledOnce());
    expect(createCephAdminAccountMock.mock.calls[0][1]).toMatchObject({ quota_enabled: undefined, quota_max_size_bytes: undefined, bucket_quota_enabled: true, bucket_quota_max_objects: 0 });
  });

  it("freezes the submitted draft, blocks duplicate creation and retains it after failure", async () => {
    let rejectRequest!: (error: Error) => void;
    createCephAdminAccountMock.mockReturnValueOnce(new Promise((_, reject) => { rejectRequest = reject; }));
    const onClose = vi.fn();
    render(<CephAdminAccountCreateModal endpointId={7} onClose={onClose} />);
    const form = screen.getByRole("form", { name: "Create RGW account" });
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Analytics" } });
    fireEvent.submit(form);
    for (const field of form.querySelectorAll("input,select")) expect(field).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(createCephAdminAccountMock).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => rejectRequest(new Error("Account creation refused")));
    expect(await screen.findByText("Account creation refused")).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toHaveValue("Analytics");
    fireEvent.submit(form);
    await waitFor(() => expect(createCephAdminAccountMock).toHaveBeenCalledTimes(2));
    expect(createCephAdminAccountMock.mock.calls[1]).toEqual(createCephAdminAccountMock.mock.calls[0]);
  });
});
