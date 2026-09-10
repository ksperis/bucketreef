import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CephAdminUserEditModal from "./CephAdminUserEditModal";

const getDetail = vi.fn();
const updateConfig = vi.fn();
vi.mock("../../api/cephAdminUsers", () => ({
  getCephAdminUserDetail: (...args: unknown[]) => getDetail(...args),
  updateCephAdminUserConfig: (...args: unknown[]) => updateConfig(...args),
}));

const detail = {
  uid: "alice", tenant: "tenant-a", display_name: "Alice", email: "alice@example.com",
  account_id: "RGW12345678901234567", suspended: false, admin: false, system: false,
  max_buckets: 8, op_mask: "read", default_placement: "default-placement", default_storage_class: "STANDARD",
  quota: { enabled: true, max_size_bytes: 1024 ** 3, max_objects: 100 }, caps: ["users=read"], keys: [],
};

async function openConfiguration(onClose = vi.fn()) {
  render(<CephAdminUserEditModal endpointId={7} uid="alice" tenant="tenant-a" canViewMetrics={false} onClose={onClose} />);
  await screen.findByText("alice@example.com");
  fireEvent.click(screen.getByRole("tab", { name: "Ceph Admin" }));
  return screen.getByRole("form", { name: "RGW user configuration" });
}

describe("RGW user configuration form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDetail.mockResolvedValue(detail);
    updateConfig.mockResolvedValue(detail);
  });

  it("preserves endpoint, tenant and unchanged quotas while normalizing shared profile and caps fields", async () => {
    const form = await openConfiguration();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: " Alice Ops " } });
    fireEvent.change(screen.getByLabelText("Default placement"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Caps mode"), { target: { value: "add" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Caps", exact: true }), { target: { value: "users=read,usage=read\nusers=read" } });
    fireEvent.submit(form);
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith(7, "alice", expect.objectContaining({
      display_name: "Alice Ops", account_root: true,
      caps: { mode: "add", values: ["users=read", "usage=read"] },
      extra_params: { "default-placement": "", "default-storage-class": "STANDARD" },
    }), "tenant-a"));
    const payload = updateConfig.mock.calls[0][2];
    for (const field of ["quota_enabled", "quota_max_size_bytes", "quota_max_objects"]) expect(payload).not.toHaveProperty(field);
  });

  it("shows field errors, clears them on correction and retains explicit quota clearing", async () => {
    const form = await openConfiguration();
    for (const label of ["Max buckets", "Storage quota", "Object quota"]) fireEvent.change(screen.getByLabelText(label), { target: { value: "-1" } });
    fireEvent.submit(form);
    expect(updateConfig).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Max buckets")).toHaveFocus());
    for (const label of ["Max buckets", "Storage quota", "Object quota"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
      fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid", "true");
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Caps", exact: true }), { target: { value: "" } });
    fireEvent.submit(form);
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith(7, "alice", expect.objectContaining({
      max_buckets: null, quota_max_size_bytes: null, quota_max_objects: null, caps: { mode: "replace", values: [] },
    }), "tenant-a"));
  });

  it("freezes the pending draft, prevents duplicate saves and retains retry values", async () => {
    let rejectRequest!: (error: Error) => void;
    updateConfig.mockReturnValueOnce(new Promise((_, reject) => { rejectRequest = reject; }));
    const onClose = vi.fn();
    const form = await openConfiguration(onClose);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alice Ops" } });
    fireEvent.submit(form);
    for (const field of form.querySelectorAll("input, select, textarea")) expect(field).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "Back to users" }));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => rejectRequest(new Error("RGW refused the update")));
    expect(await screen.findByText("RGW refused the update")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Alice Ops");
    fireEvent.submit(form);
    await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(2));
    expect(updateConfig.mock.calls[1]).toEqual(updateConfig.mock.calls[0]);
  });

  it("does not allow configuration without successfully loaded user details", async () => {
    getDetail.mockRejectedValueOnce(new Error("Unable to read user"));
    render(<CephAdminUserEditModal endpointId={7} uid="alice" canViewMetrics={false} onClose={vi.fn()} />);
    await screen.findByText("Unable to read user");
    fireEvent.click(screen.getByRole("tab", { name: "Ceph Admin" }));
    expect(screen.getByText("Unable to read user")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save configuration" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "RGW user configuration" }));
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
