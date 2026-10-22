import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAccountEditModal from "./CephAdminAccountEditModal";
import CephAdminUserEditModal from "./CephAdminUserEditModal";
import { setSessionUserCache } from "../../utils/workspaces";

const getCephAdminAccountDetailMock = vi.fn();
const getCephAdminUserDetailMock = vi.fn();
const createCephAdminUserKeyMock = vi.fn();
const deleteCephAdminUserKeyMock = vi.fn();
const listCephAdminUserKeysMock = vi.fn();

vi.mock("../../api/cephAdminUserKeys", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdminUserKeys")>("../../api/cephAdminUserKeys");
  return {
    ...actual,
    createCephAdminUserKey: (...args: unknown[]) => createCephAdminUserKeyMock(...args),
    deleteCephAdminUserKey: (...args: unknown[]) => deleteCephAdminUserKeyMock(...args),
    listCephAdminUserKeys: (...args: unknown[]) => listCephAdminUserKeysMock(...args),
  };
});

vi.mock("../../api/cephAdminUsers", () => ({
  getCephAdminUserDetail: (...args: unknown[]) =>
    getCephAdminUserDetailMock(...args),
}));

vi.mock("../../api/cephAdminAccounts", () => ({
  getCephAdminAccountDetail: (...args: unknown[]) =>
    getCephAdminAccountDetailMock(...args),
}));

describe("Ceph Admin entity editor layout", () => {
  beforeEach(() => {
    setSessionUserCache(null);
    getCephAdminAccountDetailMock.mockReset();
    getCephAdminUserDetailMock.mockReset();
    createCephAdminUserKeyMock.mockReset();
    deleteCephAdminUserKeyMock.mockReset();
    listCephAdminUserKeysMock.mockReset();
    localStorage.clear();
    listCephAdminUserKeysMock.mockResolvedValue([]);
    createCephAdminUserKeyMock.mockResolvedValue({
      access_key: "AKIA-EDIT",
      secret_key: "SECRET-EDIT",
    });
    deleteCephAdminUserKeyMock.mockResolvedValue(undefined);
    getCephAdminAccountDetailMock.mockResolvedValue({
      account_id: "RGW12345678901234567",
      account_name: "Analytics",
      email: "analytics@example.com",
      bucket_count: 2,
      user_count: 3,
      max_buckets: 10,
      max_users: 20,
      max_roles: 5,
      max_groups: 5,
      max_access_keys: 4,
      quota: { enabled: true, max_size_bytes: 1024 ** 3, max_objects: 1000 },
      bucket_quota: { enabled: false, max_size_bytes: null, max_objects: null },
    });
    getCephAdminUserDetailMock.mockResolvedValue({
      uid: "analytics-user",
      display_name: "Analytics user",
      email: "analytics-user@example.com",
      account_id: "RGW12345678901234567",
      account_name: "Analytics",
      suspended: false,
      admin: false,
      system: false,
      account_root: false,
      max_buckets: 10,
      op_mask: "read,write",
      default_placement: "default-placement",
      default_storage_class: "STANDARD",
      quota: { enabled: true, max_size_bytes: 1024 ** 3, max_objects: 1000 },
      caps: ["users=read"],
      keys: [],
    });
  });

  it("uses the wide shared drawer for RGW account configuration", async () => {
    const { container } = render(
      <MemoryRouter>
        <CephAdminAccountEditModal
          endpointId={7}
          accountId="RGW12345678901234567"
          canViewMetrics={false}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Analytics")).toBeInTheDocument();
    const drawer = screen.getByRole("complementary", { name: "RGW12345678901234567" });
    expect(drawer).toHaveClass("lg:w-[min(64rem,calc(100vw-24rem))]");
    expect(screen.getByRole("heading", { level: 2, name: "RGW12345678901234567" })).toBeInTheDocument();
    expect(screen.getByText("RGW account settings")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Account configuration sections" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Analytics");
    expect(container.querySelector(".workflow-page > .rounded-lg.border")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Account name");
  });

  it("uses the same wide drawer hierarchy for RGW user configuration", async () => {
    const { container } = render(
      <MemoryRouter>
        <CephAdminUserEditModal
          endpointId={7}
          uid="analytics-user"
          canViewMetrics={false}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("analytics-user@example.com")).toBeInTheDocument();
    const drawer = screen.getByRole("complementary", { name: "analytics-user" });
    expect(drawer).toHaveClass("lg:w-[min(64rem,calc(100vw-24rem))]");
    expect(screen.getByRole("heading", { level: 2, name: "analytics-user" })).toBeInTheDocument();
    expect(screen.getByText("RGW user settings")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "User configuration sections" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Analytics");
    expect(container.querySelector(".workflow-page > .rounded-lg.border")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Ceph Admin" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Display name");
    expect(screen.queryByRole("heading", { name: "Admin Ops configuration" })).not.toBeInTheDocument();
  });

  it("places loaded-entity navigation in the drawer header", async () => {
    const next = vi.fn();
    render(
      <MemoryRouter>
        <CephAdminAccountEditModal
          endpointId={7}
          accountId="RGW12345678901234567"
          canViewMetrics={false}
          navigation={{ next, position: "1 / 2" }}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Analytics")).toBeInTheDocument();
    const navigation = screen.getByRole("group", { name: "Loaded accounts" });
    expect(navigation).toHaveTextContent("1 / 2");
    expect(navigation.closest("header")).toContainElement(navigation);
    fireEvent.click(screen.getByRole("button", { name: "Next account" }));
    expect(next).toHaveBeenCalledOnce();
  });

  it("hides Add as S3 Connection in RGW user key management without manual permission", async () => {
    setSessionUserCache({
      role: "ui_superadmin",
      effective_access: { can_create_manual_private_connections: false },
    });
    render(
      <MemoryRouter>
        <CephAdminUserEditModal
          endpointId={7}
          uid="analytics-user"
          canViewMetrics={false}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("analytics-user@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Key Management" }));
    fireEvent.click(screen.getByRole("button", { name: "New key" }));

    expect(await screen.findByText("Key created")).toBeInTheDocument();
    expect(screen.getByText("SECRET-EDIT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add as S3 Connection" })).not.toBeInTheDocument();
  });

  it("confirms before deleting an RGW user access key", async () => {
    const accessKey = {
      access_key: "AKIA-DELETE",
      status: "enabled",
      created_at: "2026-08-21T12:00:00Z",
      is_private_access_managed: false,
    };
    getCephAdminUserDetailMock.mockResolvedValueOnce({
      uid: "analytics-user",
      display_name: "Analytics user",
      email: "analytics-user@example.com",
      account_id: "RGW12345678901234567",
      account_name: "Analytics",
      suspended: false,
      admin: false,
      system: false,
      account_root: false,
      max_buckets: 10,
      op_mask: "read,write",
      default_placement: "default-placement",
      default_storage_class: "STANDARD",
      quota: { enabled: true, max_size_bytes: 1024 ** 3, max_objects: 1000 },
      caps: ["users=read"],
      keys: [accessKey],
    });
    listCephAdminUserKeysMock.mockResolvedValueOnce([accessKey]).mockResolvedValueOnce([]);

    render(
      <MemoryRouter>
        <CephAdminUserEditModal
          endpointId={7}
          uid="analytics-user"
          canViewMetrics={false}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("analytics-user@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Key Management" }));
    expect(await screen.findByText("AKIA-DELETE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(deleteCephAdminUserKeyMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete access key?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete key" }));

    await waitFor(() => {
      expect(deleteCephAdminUserKeyMock).toHaveBeenCalledWith(7, "analytics-user", "AKIA-DELETE", undefined, "RGW12345678901234567");
    });
  });
});
