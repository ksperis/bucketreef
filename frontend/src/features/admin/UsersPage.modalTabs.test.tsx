import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "./UsersPage";
import { setSessionUserCache } from "../../utils/workspaces";
import { ApiError } from "../../api/client";

const listUsersMock = vi.fn();
const createUserMock = vi.fn();
const updateUserMock = vi.fn();
const assignUserToS3AccountMock = vi.fn();
const deleteUserMock = vi.fn();
const beginRecentWebAuthnVerificationMock = vi.fn();
const finishRecentWebAuthnVerificationMock = vi.fn();
const authenticatePasskeyMock = vi.fn();
const effectiveAccessPanelMountedMock = vi.fn();

const listMinimalS3AccountsMock = vi.fn();
const listMinimalS3UsersMock = vi.fn();
const listMinimalS3ConnectionsMock = vi.fn();
const listMinimalGroupsMock = vi.fn();
const generalSettingsState = {
  manager_enabled: true,
  ceph_admin_enabled: false,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: false,
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: true,
  portal_enabled: false,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: false,
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  bucket_quota_management_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  managed_private_connection_provisioning_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
};

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: generalSettingsState,
    loading: false,
    refresh: async () => {},
    setGeneralSettings: () => {},
  }),
}));

vi.mock("../../api/users", () => ({
  listUsers: (params?: unknown) => listUsersMock(params),
  createUser: (payload: unknown) => createUserMock(payload),
  updateUser: (userId: number, payload: unknown) => updateUserMock(userId, payload),
  assignUserToS3Account: (userId: number, accountId: number, role: string) =>
    assignUserToS3AccountMock(userId, accountId, role),
  deleteUser: (userId: number) => deleteUserMock(userId),
}));

vi.mock("../../api/security", () => ({
  beginRecentWebAuthnVerification: (...args: unknown[]) => beginRecentWebAuthnVerificationMock(...args),
  finishRecentWebAuthnVerification: (...args: unknown[]) => finishRecentWebAuthnVerificationMock(...args),
}));

vi.mock("../../auth/webauthn", () => ({
  authenticatePasskey: (...args: unknown[]) => authenticatePasskeyMock(...args),
}));

vi.mock("../../api/accounts", () => ({
  listMinimalS3Accounts: () => listMinimalS3AccountsMock(),
}));

vi.mock("../../api/s3Users", () => ({
  listMinimalS3Users: () => listMinimalS3UsersMock(),
}));

vi.mock("../../api/s3ConnectionsAdmin", () => ({
  listMinimalS3Connections: () => listMinimalS3ConnectionsMock(),
}));

vi.mock("../../api/groups", () => ({
  listMinimalGroups: () => listMinimalGroupsMock(),
}));

vi.mock("./UserAuthenticationPanel", () => ({
  default: ({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) => <div>
    Authentication actions are applied immediately.
    <button type="button" onClick={() => onBusyChange(true)}>Start authentication action</button>
    <button type="button" onClick={() => onBusyChange(false)}>Complete authentication action</button>
  </div>,
}));

vi.mock("./AdminEffectiveAccessPanel", () => ({
  default: (props: unknown) => {
    effectiveAccessPanelMountedMock(props);
    return <div>Effective access panel</div>;
  },
}));

describe("UsersPage modal tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/admin/users");

    generalSettingsState.portal_enabled = false;
    generalSettingsState.managed_private_connection_provisioning_enabled = true;
    setSessionUserCache({ id: 1, role: "ui_superadmin" });

    listUsersMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    listMinimalS3AccountsMock.mockResolvedValue([
      {
        id: 1,
        name: "acc-1",
        rgw_account_id: "RGW-ACC-1",
        user_links: [],
        group_links: [],
      },
    ]);

    listMinimalS3UsersMock.mockResolvedValue([
      {
        id: 11,
        name: "s3-user-1",
      },
    ]);

    listMinimalS3ConnectionsMock.mockResolvedValue([
      {
        id: 21,
        name: "conn-1",
        created_by_user_id: 1,
        is_shared: true,
      },
    ]);

    listMinimalGroupsMock.mockResolvedValue([
      {
        id: 31,
        name: "storage-operators",
        description: "Storage operators",
      },
      {
        id: 32,
        name: "portal-readers",
        description: "Portal readers",
      },
    ]);

    createUserMock.mockResolvedValue({ id: 100 });
    updateUserMock.mockResolvedValue({ id: 100 });
    assignUserToS3AccountMock.mockResolvedValue(undefined);
    deleteUserMock.mockResolvedValue(undefined);
    beginRecentWebAuthnVerificationMock.mockResolvedValue({ challenge: "challenge" });
    authenticatePasskeyMock.mockResolvedValue({ id: "credential" });
    finishRecentWebAuthnVerificationMock.mockResolvedValue({ mfa_verified_at: "2026-09-02T10:00:00Z" });
  });

  const recentWebAuthnRequiredError = () => new ApiError("Request failed", {
    response: {
      status: 403,
      data: { detail: "Recent WebAuthn verification required" },
      headers: {},
    },
  });

  it("opens the requested UI user directly in the edit page", async () => {
    window.history.replaceState({}, "", "/admin/users?edit=12&search=linked.user%40example.com");
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "linked.user@example.com",
          role: "ui_user",
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    expect(
      await screen.findByRole("heading", { name: "Edit user" }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Manage direct access, inherited associations, workspace permissions, and Manager permissions for this UI user."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText("linked.user@example.com")).toHaveLength(2);
    expect(listUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: "linked.user@example.com" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to users" }));
    expect(window.location.search).toBe("?search=linked.user%40example.com");
  });

  it("renders associations with the shared sectioned summary", async () => {
    generalSettingsState.portal_enabled = true;
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "assoc.summary@example.com",
          role: "ui_user",
          account_links: [{
            account_id: 1,
            manager_role: "account_administrator",
            portal_role: null,
          }],
          effective_access: {
            account_links: [
              {
                account_id: 1,
                manager_role: "account_administrator",
                portal_role: "portal_user",
                provenance: {
                  direct_manager_role: null,
                  direct_portal_role: "portal_user",
                  direct_determines_effective_manager_role: false,
                  direct_determines_effective_portal_role: true,
                  groups: [
                    {
                      group_id: 31,
                      group_name: "storage-operators",
                      manager_role: "account_administrator",
                      portal_role: null,
                      determines_effective_manager_role: true,
                      determines_effective_portal_role: false,
                    },
                  ],
                },
              },
            ],
          },
          s3_user_links: [{ s3_user_id: 11, allow_manager_browser_data_access: false }],
          s3_user_details: [{ id: 11, name: "s3-user-1" }],
          s3_connection_details: [{ id: 21, name: "conn-1" }],
          group_details: [{ id: 31, name: "storage-operators" }],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    const associations = await screen.findByLabelText("3 linked associations");
    expect(associations).toHaveAccessibleDescription(
      "Linked associations (3)\nRGW account: acc-1 — Roles: Account administrator, Portal user\nRGW user: s3-user-1\nS3 connection: conn-1",
    );
    expect(screen.getByLabelText("1 accounts")).toBeInTheDocument();
    expect(screen.getByLabelText("1 rgw users")).toBeInTheDocument();
    expect(screen.getByLabelText("1 s3 connections")).toBeInTheDocument();
    expect(screen.queryByText("storage-operators")).not.toBeInTheDocument();
  });

  it("uses the responsive shared table for the user list", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "responsive.user@example.com",
          full_name: "Responsive User",
          role: "ui_superadmin",
          last_login_at: "2026-07-07T08:45:56Z",
        },
        {
          id: 13,
          email: "email.only@example.com",
          full_name: null,
          role: "ui_user",
          last_login_at: null,
        },
      ],
      total: 2,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    const table = await screen.findByRole("table");
    expect(screen.getByRole("columnheader", { name: "User" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(listUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort_by: "name", sort_dir: "asc" }),
    );
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute(
      "placeholder",
      "Search users..."
    );
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "responsive" } });
    await waitFor(() => {
      expect(listUsersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          search: "responsive",
        })
      );
    });
    expect(table).toHaveClass("responsive-data-table");
    const identityCell = screen.getByText("Responsive User").closest("td");
    expect(identityCell).toHaveAttribute("data-mobile-primary", "true");
    expect(identityCell).toHaveTextContent("Responsive User");
    expect(identityCell).toHaveTextContent("responsive.user@example.com");
    expect(within(identityCell as HTMLElement).getByText("RU")).toBeInTheDocument();
    const emailOnlyCell = screen.getByText("email.only@example.com").closest("td");
    expect(within(emailOnlyCell as HTMLElement).getAllByText("email.only@example.com")).toHaveLength(1);
    expect(within(table).queryByRole("button", { name: "responsive.user@example.com" })).not.toBeInTheDocument();
    expect(screen.getByText("Superadmin").closest("td")).toHaveAttribute("data-label", "Role");
    expect(screen.getAllByRole("button", { name: "Edit" })[0].closest("td")).toHaveAttribute("data-mobile-actions", "true");

    fireEvent.click(screen.getByRole("button", { name: "User" }));
    await waitFor(() => {
      expect(listUsersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort_by: "name", sort_dir: "desc" }),
      );
    });
  });

  it("preserves an existing portal role while hiding its column when Portal is disabled", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "assoc.summary@example.com",
          role: "ui_user",
          account_links: [{ account_id: 1, manager_role: null, portal_role: "portal_manager" }],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    const associations = await screen.findByLabelText("1 linked association");
    expect(associations).toHaveAccessibleDescription(
      "Linked associations (1)\nRGW account: acc-1 — Roles: Portal manager",
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    expect(screen.getByRole("columnheader", { name: "Manager role" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Portal role/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Access roles" })).not.toBeInTheDocument();

    const managerRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for acc-1",
    });
    expect(managerRoleSelect).toHaveValue("");
    expect(managerRoleSelect).toBeEnabled();
    expect(
      screen.queryByRole("combobox", { name: "Portal role for acc-1" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith(
        12,
        expect.objectContaining({
          account_links: [
            {
              account_id: 1,
              allow_manager_browser_data_access: false,
              manager_role: null,
              portal_role: "portal_manager",
            },
          ],
        })
      );
    });
    expect(assignUserToS3AccountMock).not.toHaveBeenCalled();
  });

  it("allows editing a Manager link and its advanced data access setting", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "root.link@example.com",
          role: "ui_user",
          account_links: [
            {
              account_id: 1,
              manager_role: "account_administrator",
              portal_role: null,
              allow_manager_browser_data_access: false,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    expect(screen.getByRole("columnheader", { name: "Manager role" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Portal role/ })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Manager role for acc-1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("switch", { name: "Allow Manager Browser data access" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith(
        12,
        expect.objectContaining({
          account_links: [
            {
              account_id: 1,
              allow_manager_browser_data_access: true,
              manager_role: "account_administrator",
              portal_role: null,
            },
          ],
        })
      );
    });
  });

  it("keeps the required user Manager role while Portal is off", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "empty.link@example.com",
          role: "ui_user",
          account_links: [
            {
              account_id: 1,
              manager_role: "account_administrator",
              portal_role: null,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));
    const managerRoleSelect = screen.getByRole("combobox", {
      name: "Manager role for acc-1",
    });
    expect(managerRoleSelect).toHaveValue("account_administrator");
    expect(
      within(managerRoleSelect).getByRole("option", { name: "No Manager access" }),
    ).toBeDisabled();
  });

  it("keeps associations when switching General/Associations and submits linked payload", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(
      screen.getByText("Configure identity, workspace access, groups, and storage associations for this UI user.")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-123" } });

    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    const managerRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for acc-1",
    });
    const portalRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Portal role for acc-1",
    });
    expect(Array.from(managerRoleSelect.options).map((option) => option.value)).toEqual([
      "",
      "account_administrator",
    ]);
    expect(managerRoleSelect).toHaveValue("account_administrator");
    expect(portalRoleSelect).toHaveValue("");
    expect(portalRoleSelect).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "acc-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: /S3 Users \(0\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add users" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "s3-user-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: /Connections \(0\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add connections" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "conn-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    expect(screen.getByRole("tab", { name: /Accounts \(1\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalledTimes(1);
    });

    expect(updateUserMock).toHaveBeenCalledWith(
      100,
      expect.objectContaining({
        account_links: [
          {
            account_id: 1,
            allow_manager_browser_data_access: false,
            manager_role: "account_administrator",
            portal_role: null,
          },
        ],
        s3_user_links: [
          {
            s3_user_id: 11,
            allow_manager_browser_data_access: false,
          },
        ],
        s3_connection_ids: [21],
      })
    );
  }, 10_000);

  it("retries only the association request after user creation step-up", async () => {
    createUserMock.mockResolvedValueOnce({ id: 100 });
    updateUserMock
      .mockRejectedValueOnce(recentWebAuthnRequiredError())
      .mockResolvedValueOnce({ id: 100 });
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "step-up@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-123456" } });
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));
    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "acc-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    expect(screen.getByRole("heading", { name: "Create user" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Accounts \(1\)/ })).toBeInTheDocument();
    fireEvent.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledTimes(2));
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenNthCalledWith(2, 100, expect.objectContaining({
      account_links: [expect.objectContaining({ account_id: 1 })],
    }));
  }, 10_000);

  it("does not retry minimal account loading in a loop after an initial failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listMinimalS3AccountsMock.mockRejectedValue(new Error("backend down"));

    render(<UsersPage />);

    await waitFor(() => {
      expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(1);
    });

    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("retries minimal account loading only on explicit modal and tab transitions after a failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listMinimalS3AccountsMock.mockRejectedValue(new Error("backend down"));

    render(<UsersPage />);

    await waitFor(() => {
      expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));
    fireEvent.click(screen.getByRole("tab", { name: /S3 Users \(0\)/ }));

    await waitFor(() => {
      expect(listMinimalS3UsersMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("tab", { name: /Accounts \(0\)/ }));

    await waitFor(() => {
      expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(3);
    });

    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(3);

    consoleErrorSpy.mockRestore();
  });

  it("returns to General when required fields are missing and submit is triggered from Associations", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("shows Workspaces tab and keeps workspace toggles out of General in create modal", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "General",
      "Groups",
      "Associations",
      "Workspaces",
      "Connections",
    ]);
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Associations" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspaces" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Browser" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ceph Admin access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Ops access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByText("Mass management workspaces")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin access")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
  });

  it("shows Groups tab in create modal and sends group_ids in create payload", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "grouped@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-123" } });

    fireEvent.click(screen.getByRole("tab", { name: "Groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /storage-operators/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalled();
    });
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        group_ids: [31],
      })
    );
  });

  it("shows Groups tab in edit modal and sends updated group_ids", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "edit.groups@example.com",
          role: "ui_user",
          account_links: [],
          group_details: [{ id: 31, name: "storage-operators" }],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Groups" }));

    expect(await screen.findByText("storage-operators")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /portal-readers/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalled();
    });
    expect(updateUserMock).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        group_ids: [31, 32],
      })
    );
  });

  it("shows Workspaces tab and keeps workspace toggles out of General in edit modal", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 9,
          email: "edit.access@example.com",
          role: "ui_admin",
          account_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Profile and preferences",
      "Security",
      "Groups",
      "Associations",
      "Workspaces",
      "Connections",
      "Effective access",
    ]);
    expect(screen.getByRole("tab", { name: "Profile and preferences" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Associations" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspaces" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ceph Admin access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Ops access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByText("Mass management workspaces")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin access")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
  });

  it("loads Effective access only when the edit tab is opened", async () => {
    listUsersMock.mockResolvedValue({
      items: [{ id: 9, email: "audit.user@example.com", full_name: "Audit User", role: "ui_user", account_links: [] }],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(effectiveAccessPanelMountedMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Effective access" }));
    expect(await screen.findByText("Effective access panel")).toBeInTheDocument();
    expect(effectiveAccessPanelMountedMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9,
      contextLabel: "Audit User",
      showUserColumn: false,
    }));
  });

  it("uses a single Done action for the immediate Authentication workflow", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 9,
          email: "edit.authentication@example.com",
          role: "ui_user",
          account_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));

    expect(screen.getByText("Authentication actions are applied immediately.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Edit UI user" }));
    expect(updateUserMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start authentication action" }));
    for (const tab of screen.getAllByRole("tab")) expect(tab).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to users" })).toBeDisabled();
    // Authentication dialogs remain operable inside the parent form.
    expect(screen.getByRole("button", { name: "Complete authentication action" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Complete authentication action" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Profile and preferences" })).toBeEnabled();
  });

  it("shows Connections and Manager in create/edit and submits their permissions", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 10,
          email: "edit.tools@example.com",
          role: "ui_admin",
          can_access_ceph_admin: false,
          can_access_storage_ops: false,
          manager_tool_access: {
            bucket_compare: false,
            bucket_integrity_check: true,
            bucket_migration: true,
            feature_rules: false,
          },
          account_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(screen.getByRole("tab", { name: "Connections" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Manager" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    fireEvent.click(screen.getByRole("switch", { name: "Allow manual private connection creation" }));
    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    fireEvent.click(screen.getByRole("switch", { name: "Allow managed private connection provisioning" }));

    expect(screen.getByRole("heading", { name: "Manager", exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Privileged Ceph access")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Bucket quota management" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Ceph S3 User keys" })).not.toBeInTheDocument();
    const managerSection = screen.getByRole("region", { name: "Manager", exact: true });
    expect(within(managerSection).getByText("Bucket compare")).toBeInTheDocument();
    expect(within(managerSection).getByText("Bucket integrity check")).toBeInTheDocument();
    expect(within(managerSection).getByText("Bucket migration")).toBeInTheDocument();

    const compareToggle = screen.getByRole("switch", { name: /Bucket compare/i });
    const migrationToggle = screen.getByRole("switch", { name: /Bucket migration/i });
    expect(compareToggle).not.toBeChecked();
    expect(migrationToggle).toBeDisabled();
    expect(screen.getAllByText("Disabled globally").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(compareToggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalled();
    });
    expect(updateUserMock).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        can_create_manual_private_connections: true,
        can_provision_managed_private_connections: true,
        manager_tool_access: {
          bucket_compare: true,
          bucket_integrity_check: true,
          bucket_migration: true,
          bucket_purge: false,
          feature_rules: false,
        },
      })
    );
  });

  it("preserves a managed private provisioning grant while the feature is disabled globally", async () => {
    generalSettingsState.managed_private_connection_provisioning_enabled = false;
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 10,
          email: "managed.disabled@example.com",
          role: "ui_user",
          can_provision_managed_private_connections: true,
          account_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));

    const toggle = screen.getByRole("switch", {
      name: "Allow managed private connection provisioning",
    });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(within(toggle.parentElement?.parentElement as HTMLElement).getByText("Disabled globally")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateUserMock).toHaveBeenCalledTimes(1));
    expect(updateUserMock).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        can_provision_managed_private_connections: true,
      })
    );
  });

  it("keeps role access note hidden by default in create modal and shows it on help button click", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));

    expect(screen.queryByText("Role access summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain role access levels" }));
    expect(screen.getByText("Role access summary")).toBeInTheDocument();
    expect(screen.getByText("No workspace access (profile only)")).toBeInTheDocument();
    expect(screen.getByText("Non-admin workspaces only")).toBeInTheDocument();
    expect(screen.getByText("User access + /admin")).toBeInTheDocument();
    expect(screen.getByText("Admin access + /admin settings")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin and Storage Ops also require dedicated access flags.")).toBeInTheDocument();
  });

  it("keeps role access note hidden by default in edit modal and shows it on help button click", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 7,
          email: "edit.user@example.com",
          role: "ui_user",
          account_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.queryByText("Role access summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain role access levels" }));
    expect(screen.getByText("Role access summary")).toBeInTheDocument();
    expect(screen.getByText("No workspace access (profile only)")).toBeInTheDocument();
    expect(screen.getByText("Non-admin workspaces only")).toBeInTheDocument();
    expect(screen.getByText("User access + /admin")).toBeInTheDocument();
    expect(screen.getByText("Admin access + /admin settings")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin and Storage Ops also require dedicated access flags.")).toBeInTheDocument();
  });

  it("shows Storage Ops access in create modal and sends it in create payload", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ops@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-123" } });
    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByText("Mass management workspaces")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
    expect(
      screen.getByText("Grant direct /storage-ops access when the UI role is User, Admin, or Superadmin.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Superadmin role updates require Superadmin/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Allow access to /storage-ops" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalled();
    });
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        can_access_storage_ops: true,
      })
    );
  });

  it("shows Browser options in create modal and sends advanced Browser access", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "browser@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-123" } });

    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByText("Browser options for this UI user. Groups can also grant these options.")).toBeInTheDocument();
    const advancedToggle = screen.getByRole("switch", { name: "Enable technical S3 tools" });
    expect(advancedToggle).not.toBeChecked();
    fireEvent.click(advancedToggle);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalled();
    });
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        browser_advanced_features_enabled: true,
      })
    );
  });

  it("allows choosing Manager and Portal roles independently while linking an account", async () => {
    generalSettingsState.portal_enabled = true;
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pm@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-123" } });
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    const accountCheckbox = await screen.findByRole("checkbox", { name: "acc-1" });
    const accountRow = accountCheckbox.closest("div");
    if (!accountRow) {
      throw new Error("Account row not found");
    }
    const managerRoleSelect = within(accountRow).getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for acc-1",
    });
    const portalRoleSelect = within(accountRow).getByRole<HTMLSelectElement>("combobox", {
      name: "Portal role for acc-1",
    });
    expect(Array.from(managerRoleSelect.options).map((option) => option.value)).toEqual([
      "",
      "account_administrator",
    ]);
    expect(Array.from(portalRoleSelect.options).map((option) => option.value)).toEqual([
      "",
      "portal_user",
      "portal_manager",
    ]);
    expect(managerRoleSelect).toHaveValue("");
    expect(portalRoleSelect).toHaveValue("");
    expect(
      within(accountRow).queryByText("Choose at least one role for this association."),
    ).not.toBeInTheDocument();
    fireEvent.click(accountCheckbox);
    expect(
      within(accountRow).getByText("Choose at least one role for this association."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add selected" })).toBeDisabled();
    fireEvent.change(managerRoleSelect, {
      target: { value: "account_administrator" },
    });
    fireEvent.change(portalRoleSelect, {
      target: { value: "portal_manager" },
    });
    expect(
      within(accountRow).queryByText("Choose at least one role for this association."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          account_links: [
            {
              account_id: 1,
              allow_manager_browser_data_access: false,
              manager_role: "account_administrator",
              portal_role: "portal_manager",
            },
          ],
        })
      );
    });
  });
  it.each([false, true])("freezes the user draft during save and retains it after failure (edit=%s)", async (editing) => {
    const user = { id: 12, email: "draft@example.com", role: "ui_user", account_links: [] };
    listUsersMock.mockResolvedValue({ items: [user], total: 1, page: 1, page_size: 25, has_next: false });
    const save = editing ? updateUserMock : createUserMock;
    let rejectSave!: (error: Error) => void;
    save.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    render(<UsersPage />);
    const trigger = await screen.findByRole("button", { name: editing ? "Edit" : "Create user", exact: true });
    await act(async () => { fireEvent.click(trigger); });
    const form = screen.getByRole("form", { name: editing ? "Edit UI user" : "Create UI user" });
    fireEvent.change(within(form).getByLabelText("Email"), { target: { value: "retained@example.com" } });
    if (!editing) fireEvent.change(within(form).getByLabelText("Password"), { target: { value: "fixture-password" } });
    fireEvent.submit(form);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    for (const control of form.querySelectorAll("input,select,button")) expect(control).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to users" })).toBeDisabled();
    fireEvent.submit(form);
    expect(save).toHaveBeenCalledTimes(1);
    const payload = save.mock.calls[0];
    await act(async () => rejectSave(new Error("Fixture save failed")));
    expect(within(form).getByLabelText("Email")).toHaveValue("retained@example.com");
    expect(within(form).getByLabelText("Email")).toBeEnabled();
    fireEvent.submit(form);
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(save.mock.calls[1]).toEqual(payload);
  });

  it.each([false, true])("returns to the invalid email from another tab (edit=%s)", async (editing) => {
    listUsersMock.mockResolvedValue({ items: [{ id: 12, email: "draft@example.com", role: "ui_user" }], total: 1, page: 1, page_size: 25 });
    render(<UsersPage />);
    const trigger = await screen.findByRole("button", { name: editing ? "Edit" : "Create user", exact: true });
    await act(async () => { fireEvent.click(trigger); });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "invalid-email" } });
    if (!editing) fireEvent.change(screen.getByLabelText("Password"), { target: { value: "fixture-password" } });
    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    fireEvent.click(screen.getByRole("button", { name: editing ? "Save" : "Create", exact: true }));
    const email = await screen.findByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(email).toHaveFocus());
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

});
