import { transferableAbortController } from "node:util";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountsPage from "./AccountsPage";
import { setSessionUserCache } from "../../utils/workspaces";

const listS3AccountsMock = vi.fn();
const getS3AccountMock = vi.fn();
const updateS3AccountMock = vi.fn();
const createS3AccountMock = vi.fn();
const deleteS3AccountMock = vi.fn();
const importS3AccountsMock = vi.fn();
const fetchAccountPortalSettingsMock = vi.fn();
const updateAccountPortalSettingsMock = vi.fn();

const listStorageEndpointsMock = vi.fn();
const getStorageEndpointMock = vi.fn();

const listMinimalUsersMock = vi.fn();
const listMinimalGroupsMock = vi.fn();
const listAdminTagDefinitionsMock = vi.fn();
let portalEnabled = false;

const makeTag = (id: number, label: string, color_key = "neutral", scope = "standard") => ({
  id,
  label,
  color_key,
  scope,
});

const makePortalAccountSettings = (overrides?: Record<string, unknown>) => ({
  effective: {
    browser_access_enabled: false,
    allow_private_storage_space_create: true,
    allow_portal_named_bucket_create: false,
    allow_portal_user_access_key_create: true,
    server_access_logging_enabled: true,
    server_access_log_retention_days: 30,
    storage_space_version_cleanup_enabled: true,
    max_portal_user_access_keys: 2,
    bucket_defaults: {
      versioning: false,
      enable_cors: false,
      enable_lifecycle: false,
      noncurrent_version_expiration_days: 90,
      cors_allowed_origins: ["https://portal.example.test"],
    },
  },
  admin_override: {},
  delegated_to_portal_managers: false,
  ...overrides,
});

vi.mock("./useAdminAccountStats", () => ({
  useAdminAccountStats: () => ({
    stats: null,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/accounts", () => ({
  listS3Accounts: (params?: unknown) => listS3AccountsMock(params),
  getS3Account: (accountId: number, options?: unknown) => getS3AccountMock(accountId, options),
  updateS3Account: (accountId: number, payload: unknown) => updateS3AccountMock(accountId, payload),
  createS3Account: (payload: unknown) => createS3AccountMock(payload),
  deleteS3Account: (accountId: number, options?: unknown) => deleteS3AccountMock(accountId, options),
  importS3Accounts: (payload: unknown) => importS3AccountsMock(payload),
  fetchAccountPortalSettings: (accountId: number) => fetchAccountPortalSettingsMock(accountId),
  updateAccountPortalSettings: (accountId: number, payload: unknown) =>
    updateAccountPortalSettingsMock(accountId, payload),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: { portal_enabled: portalEnabled },
    loading: false,
    refresh: vi.fn(),
    setGeneralSettings: vi.fn(),
  }),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
  getStorageEndpoint: (endpointId: number, options?: unknown) => getStorageEndpointMock(endpointId, options),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
}));

vi.mock("../../api/groups", () => ({
  listMinimalGroups: () => listMinimalGroupsMock(),
}));

vi.mock("../../api/tags", () => ({
  listAdminTagDefinitions: (domain: unknown) => listAdminTagDefinitionsMock(domain),
  listPrivateConnectionTagDefinitions: vi.fn(),
}));

describe("AccountsPage modal tabs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });

    portalEnabled = false;
    setSessionUserCache({ id: 1, role: "ui_superadmin" });
    listS3AccountsMock.mockResolvedValue({
      items: [
        {
          id: 1,
          name: "acc-1",
          tags: [makeTag(501, "gold", "amber")],
          rgw_account_id: "RGW000000000000001",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_links: [],
          group_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    listStorageEndpointsMock.mockResolvedValue([
      {
        id: 10,
        name: "ceph-main",
        provider: "ceph",
        is_default: true,
        capabilities: {
          account: true,
          admin: true,
          usage: true,
        },
      },
    ]);

    getStorageEndpointMock.mockResolvedValue({
      id: 10,
      name: "ceph-main",
      provider: "ceph",
      is_default: true,
      capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
      admin_ops_permissions: {
        buckets_write: true,
        accounts_write: true,
      },
    });

    listMinimalUsersMock.mockResolvedValue([
      { id: 7, email: "ui7@example.com" },
      { id: 8, email: "ui8@example.com" },
    ]);
    listMinimalGroupsMock.mockResolvedValue([
      { id: 31, name: "Research Group" },
      { id: 32, name: "Archive Group" },
    ]);
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(501, "gold", "amber"), makeTag(502, "prod")]);

    getS3AccountMock.mockResolvedValue({
      id: 1,
      name: "acc-1",
      tags: [makeTag(501, "gold", "amber")],
      rgw_account_id: "RGW000000000000001",
      storage_endpoint_id: 10,
      storage_endpoint_name: "ceph-main",
      storage_endpoint_url: "https://ceph.example.test",
      storage_endpoint_capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
      quota_max_size_gb: null,
      quota_max_objects: null,
      user_links: [],
      group_links: [],
    });

    updateS3AccountMock.mockResolvedValue(undefined);
    createS3AccountMock.mockResolvedValue(undefined);
    deleteS3AccountMock.mockResolvedValue(undefined);
    importS3AccountsMock.mockResolvedValue([]);
    fetchAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings());
    updateAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings());
  });

  afterEach(() => { vi.unstubAllGlobals(); setSessionUserCache(null); });

  it("shows the compact empty state when no RGW accounts exist", async () => {
    listS3AccountsMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<AccountsPage />);

    expect(await screen.findByText("No accounts.")).toBeInTheDocument();
    expect(screen.queryByText("No accounts yet.")).not.toBeInTheDocument();
  });

  it("presents account identity and quotas in consistent General sections", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    const generalPanel = await screen.findByRole("tabpanel", { name: "General" });
    expect(
      screen.getByText("Manage quotas, usage, UI associations, privileged access, and Portal overrides for this account.")
    ).toBeInTheDocument();
    expect(within(generalPanel).getByRole("heading", { name: "Account details" })).toBeInTheDocument();
    expect(within(generalPanel).getByRole("heading", { name: "Quotas" })).toBeInTheDocument();
    expect(within(generalPanel).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(generalPanel).getByLabelText("Storage quota unit")).toHaveClass("ui-control");
    expect(within(generalPanel).getByLabelText("Object quota")).toHaveClass("ui-control");
    expect(within(generalPanel).getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getAllByText("RGW ID").some((node) => node.tagName === "DT")).toBe(true);
  });

  it("renders direct UI users and UI groups in the combined listing column", async () => {
    portalEnabled = true;
    listS3AccountsMock.mockResolvedValueOnce({
      items: [
        {
          id: 1,
          name: "acc-1",
          tags: [],
          rgw_account_id: "RGW000000000000001",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_links: [
            {
              user_id: 7,
              user_email: "ui7@example.com",
              manager_role: null,
              portal_role: "portal_user",
            },
          ],
          group_links: [
            {
              group_id: 31,
              group_name: "Research Group",
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

    render(<AccountsPage />);

    expect(await screen.findByRole("columnheader", { name: "UI Users / Groups" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    const accountName = await within(table).findByText("acc-1");
    expect(accountName.closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).queryByRole("button", { name: "acc-1" })).not.toBeInTheDocument();
    expect(within(table).getByText("RGW000000000000001").closest("td")).toHaveAttribute("data-label", "RGW ID");
    expect(within(table).getByText("ceph-main").closest("td")).toHaveAttribute("data-label", "Endpoint");
    const associations = screen.getByLabelText("2 linked principals");
    expect(associations).toHaveAccessibleDescription(
      "Linked principals (2)\nUI user: ui7@example.com — Roles: Portal user\nUI group: Research Group — Roles: Account administrator",
    );
    expect(associations).toBeInTheDocument();
    expect(associations.querySelector(".rounded-lg")).toBeInTheDocument();
    expect(associations.closest("td")).toHaveAttribute("data-label", "UI Users / Groups");
    expect(within(table).getByRole("button", { name: "Edit" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(screen.queryByText("Portal user")).not.toBeInTheDocument();
    expect(screen.queryByText("Portal manager")).not.toBeInTheDocument();
  });

  it("shows General/Linked UI users tabs and submits updated user_links", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    const generalTab = await screen.findByRole("tab", { name: "General" });
    const usersTab = screen.getByRole("tab", { name: "Linked UI users" });

    const tabLabels = Array.from(generalTab.parentElement?.querySelectorAll("button") ?? []).map((button) =>
      button.textContent?.trim()
    );
    expect(tabLabels.slice(0, 2)).toEqual(["General", "Linked UI users"]);
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add a tag for this account" })).toBeInTheDocument();

    fireEvent.click(usersTab);

    fireEvent.click(await screen.findByRole("button", { name: "Add UI users" }));
    expect(screen.getByRole("searchbox", { name: "Search UI users" })).toHaveClass("ui-list-control");
    const managerRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for ui7@example.com",
    });
    const portalRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Portal role for ui7@example.com",
    });
    expect(managerRoleSelect).toHaveValue("account_administrator");
    expect(Array.from(managerRoleSelect.options).map((option) => option.value)).toEqual([
      "",
      "account_administrator",
    ]);
    expect(portalRoleSelect).toHaveValue("");
    expect(portalRoleSelect).toBeDisabled();
    fireEvent.click(await screen.findByRole("checkbox", { name: "ui7@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "gold", color_key: "amber" })],
        user_links: expect.arrayContaining([
          expect.objectContaining({
            user_id: 7,
            manager_role: "account_administrator",
            portal_role: null,
          }),
        ]),
      })
    );
  });

  it("submits direct UI group links from the account edit tab", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI groups" }));

    expect(screen.getByText("No linked groups yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    expect(screen.getByRole("searchbox", { name: "Search UI groups" })).toHaveClass("ui-list-control");
    const managerRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for Research Group",
    });
    const portalRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Portal role for Research Group",
    });
    expect(Array.from(managerRoleSelect.options).map((option) => option.value)).toEqual([
      "",
      "account_administrator",
    ]);
    expect(portalRoleSelect).toBeDisabled();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Research Group" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    expect(screen.getByText("Research Group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        group_links: [
          expect.objectContaining({
            group_id: 31,
            group_name: "Research Group",
            manager_role: "account_administrator",
            portal_role: null,
          }),
        ],
      })
    );
  });

  it("assigns portal roles while linking UI users and groups when Portal is enabled", async () => {
    portalEnabled = true;
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));
    expect(screen.getByRole("columnheader", { name: "Manager role" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Portal role" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Access roles" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Add UI users" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Portal role for ui7@example.com" }), {
      target: { value: "portal_manager" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "ui7@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: "Linked UI groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    expect(await screen.findByRole("combobox", { name: "Portal role for Research Group" })).toHaveValue(
      "portal_user",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Manager role for Research Group" }), {
      target: { value: "account_administrator" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Portal role for Research Group" }), {
      target: { value: "portal_user" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Research Group" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        user_links: [
          {
            user_id: 7,
            user_email: "ui7@example.com",
            manager_role: null,
            portal_role: "portal_manager",
            allow_manager_browser_data_access: false,
          },
        ],
        group_links: [
          {
            group_id: 31,
            group_name: "Research Group",
            manager_role: "account_administrator",
            portal_role: "portal_user",
            allow_manager_browser_data_access: false,
          },
        ],
      })
    );
  });

  it("preserves an existing portal role while hiding its column when Portal is disabled", async () => {
    listS3AccountsMock.mockResolvedValueOnce({
      items: [
        {
          id: 1,
          name: "acc-1",
          tags: [makeTag(501, "gold", "amber")],
          rgw_account_id: "RGW000000000000001",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_links: [{
            user_id: 7,
            user_email: "ui7@example.com",
            manager_role: null,
            portal_role: "portal_manager",
          }],
          group_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });
    getS3AccountMock.mockResolvedValueOnce({
      id: 1,
      name: "acc-1",
      tags: [makeTag(501, "gold", "amber")],
      rgw_account_id: "RGW000000000000001",
      storage_endpoint_id: 10,
      storage_endpoint_name: "ceph-main",
      storage_endpoint_url: "https://ceph.example.test",
      storage_endpoint_capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
      quota_max_size_gb: null,
      quota_max_objects: null,
      user_links: [{
        user_id: 7,
        user_email: "ui7@example.com",
        manager_role: null,
        portal_role: "portal_manager",
      }],
      group_links: [],
    });

    render(<AccountsPage />);

    expect(await screen.findByLabelText("1 linked principal")).toHaveAccessibleDescription(
      "Linked principals (1)\nUI user: ui7@example.com — Roles: Portal manager",
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));

    expect(screen.getByRole("columnheader", { name: "Manager role" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Portal role/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Access roles" })).not.toBeInTheDocument();

    const managerRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Manager role for ui7@example.com",
    });
    expect(managerRoleSelect).toHaveValue("");
    expect(managerRoleSelect).toBeEnabled();
    expect(
      screen.queryByRole("combobox", { name: "Portal role for ui7@example.com" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.change(screen.getByLabelText("Object quota"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        user_links: [
          expect.objectContaining({
            user_id: 7,
            manager_role: null,
            portal_role: "portal_manager",
          }),
        ],
      })
    );
  });

  it("keeps the required account-principal Manager role while Portal is off", async () => {
    const accountWithManagerLink = {
      id: 1,
      name: "acc-1",
      tags: [makeTag(501, "gold", "amber")],
      rgw_account_id: "RGW000000000000001",
      storage_endpoint_id: 10,
      storage_endpoint_name: "ceph-main",
      storage_endpoint_url: "https://ceph.example.test",
      quota_max_size_gb: null,
      quota_max_objects: null,
      user_links: [
        {
          user_id: 7,
          user_email: "ui7@example.com",
          manager_role: "account_administrator" as const,
          portal_role: null,
        },
      ],
      group_links: [],
    };
    listS3AccountsMock.mockResolvedValueOnce({
      items: [accountWithManagerLink],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });
    getS3AccountMock.mockResolvedValueOnce({
      ...accountWithManagerLink,
      storage_endpoint_capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
    });

    render(<AccountsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));
    expect(screen.getByRole("columnheader", { name: "Manager role" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Portal role/ })).not.toBeInTheDocument();
    const managerRoleSelect = screen.getByRole("combobox", {
      name: "Manager role for ui7@example.com",
    });
    expect(managerRoleSelect).toHaveValue("account_administrator");
    expect(
      within(managerRoleSelect).getByRole("option", { name: "No Manager access" }),
    ).toBeDisabled();
  });

  it("submits privileged access grants from the account edit tab", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));

    expect(screen.getByText("Privileged Ceph access")).toBeInTheDocument();
    expect(
      screen.getByText("Ceph admin-API actions granted directly to this account outside the Ceph Admin workspace.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Allow Ceph bucket quota updates for this S3 Account in Manager.")
    ).toBeInTheDocument();
    const quotaCheckbox = screen.getByRole("switch", { name: /Bucket quota management/ });
    expect(quotaCheckbox).not.toBeChecked();
    fireEvent.click(quotaCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        allow_bucket_quota_management: true,
      })
    );
  });

  it("lets ui_admin submit privileged access grants from account edits", async () => {
    setSessionUserCache({ id: 2, role: "ui_admin" });

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));

    const quotaCheckbox = screen.getByRole("switch", { name: /Bucket quota management/ });
    expect(quotaCheckbox).not.toBeChecked();
    fireEvent.click(quotaCheckbox);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        allow_bucket_quota_management: true,
      })
    );
  });

  it("requires the Admin Ops buckets write capability before enabling bucket quota management", async () => {
    getStorageEndpointMock.mockResolvedValueOnce({
      id: 10,
      name: "ceph-main",
      provider: "ceph",
      is_default: true,
      capabilities: { account: true, admin: true },
      admin_ops_permissions: { accounts_write: true, buckets_write: false },
    });

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));

    expect(
      await screen.findByText("Requires buckets=write on the endpoint Admin Ops identity before this grant can be enabled.")
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Bucket quota management/ })).toBeDisabled();
  });

  it("shows portal overrides tab when the portal feature is enabled", async () => {
    portalEnabled = true;
    fetchAccountPortalSettingsMock.mockResolvedValueOnce(makePortalAccountSettings());

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));

    expect(fetchAccountPortalSettingsMock).toHaveBeenCalledWith(1);
    expect(await screen.findByText("Private Storage Space creation")).toBeInTheDocument();
    expect(screen.getByText("Server access logging")).toBeInTheDocument();
    expect(screen.getByText("Storage Space history cleanup")).toBeInTheDocument();
    expect(screen.queryByText("Portal manager overrides are active for this account.")).not.toBeInTheDocument();
    expect(screen.queryByText("Bucket management")).not.toBeInTheDocument();
  });

  it("hides portal overrides tab when the portal feature is disabled", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    await screen.findByRole("tabpanel", { name: "General" });
    expect(screen.queryByRole("tab", { name: "Portal settings" })).not.toBeInTheDocument();
    expect(fetchAccountPortalSettingsMock).not.toHaveBeenCalled();
  });

  it("saves account portal overrides from the portal tab", async () => {
    portalEnabled = true;
    updateAccountPortalSettingsMock.mockResolvedValueOnce(
      makePortalAccountSettings({
        admin_override: { allow_private_storage_space_create: false },
      })
    );

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    await screen.findByText("Private Storage Space creation");

    fireEvent.change(screen.getByLabelText("Browser workspace access"), {
      target: { value: "enabled" },
    });
    fireEvent.click(screen.getByLabelText("Delegate Portal overrides to Portal managers"));
    fireEvent.change(screen.getByLabelText("Private Storage Space creation"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("Named bucket creation"), { target: { value: "enabled" } });
    fireEvent.change(screen.getByLabelText("Storage Space history cleanup"), { target: { value: "disabled" } });
    fireEvent.click(screen.getByLabelText("Customize — Version history retention"));
    fireEvent.change(screen.getByLabelText("Version history retention"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateAccountPortalSettingsMock).toHaveBeenCalledWith(1, {
        delegated_to_portal_managers: true,
        browser_access_enabled: true,
        allow_private_storage_space_create: false,
        allow_portal_named_bucket_create: true,
        storage_space_version_cleanup_enabled: false,
        bucket_defaults: { noncurrent_version_expiration_days: 45 },
      });
    });
  });

  it("rejects a non-positive account lifecycle expiration override", async () => {
    portalEnabled = true;

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    await screen.findByText("Version history retention");

    fireEvent.click(screen.getByLabelText("Customize — Version history retention"));
    fireEvent.change(screen.getByLabelText("Version history retention"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Enter a positive whole number.")).toBeInTheDocument();
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
  });

  it("resets account portal overrides from the portal tab", async () => {
    portalEnabled = true;

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    await screen.findByText("Private Storage Space creation");

    fireEvent.change(screen.getByLabelText("Browser workspace access"), { target: { value: "disabled" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore platform values" }));
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    const resetDialog = screen.getByRole("dialog", { name: "Restore platform values?" });
    fireEvent.click(within(resetDialog).getByRole("button", { name: "Apply" }));
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("inherit");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("edits tags inline from the general tab", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    const input = await screen.findByRole("textbox", { name: "Add a tag for this account" });
    fireEvent.focus(input);
    fireEvent.change(input, {
      target: { value: "prod" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tag prod" }));
    expect(screen.getAllByText("prod").length).toBeGreaterThan(0);

    fireEvent.change(input, {
      target: { value: "finance" },
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.getAllByText("finance").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit tag gold" }));
    expect(screen.getByRole("group", { name: "Tag settings for gold" })).toBeInTheDocument();
  });

  it("defaults a new link to account administrator when Portal is unavailable", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));

    fireEvent.click(await screen.findByRole("button", { name: "Add UI users" }));
    const userCheckbox = await screen.findByRole("checkbox", { name: "ui7@example.com" });
    fireEvent.click(userCheckbox);
    const userRow = userCheckbox.closest("div");
    if (!userRow) {
      throw new Error("User row not found");
    }
    expect(within(userRow).getByRole("combobox", { name: "Manager role for ui7@example.com" })).toHaveValue(
      "account_administrator",
    );
    expect(within(userRow).getByRole("combobox", { name: "Portal role for ui7@example.com" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "gold", color_key: "amber" })],
        user_links: expect.arrayContaining([
          expect.objectContaining({
            user_id: 7,
            manager_role: "account_administrator",
            portal_role: null,
          }),
        ]),
      })
    );
  });

  it("creates an account with normalized tags", async () => {
    render(<AccountsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create account" }));
    const dialog = screen.getByRole("dialog");
    const nameInput = dialog.querySelector("input[required]") as HTMLInputElement | null;
    if (!nameInput) {
      throw new Error("Account name input not found");
    }
    expect(nameInput).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Email contact")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Storage endpoint (Ceph) *")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Storage quota unit")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Object quota")).toHaveClass("ui-control");

    fireEvent.change(nameInput, { target: { value: "account-with-tags" } });
    fireEvent.change(within(dialog).getByLabelText("Storage quota"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Storage quota unit"), { target: { value: "TiB" } });
    fireEvent.change(within(dialog).getByLabelText("Object quota"), { target: { value: "1000" } });
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this account" });
    fireEvent.change(tagInput, {
      target: { value: "finance" },
    });
    fireEvent.keyDown(tagInput, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Create account" })).toBeEnabled();
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(createS3AccountMock).toHaveBeenCalled();
    });
    expect(createS3AccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "account-with-tags",
        quota_max_size_gb: 2,
        quota_max_size_unit: "TiB",
        quota_max_objects: 1000,
        tags: [expect.objectContaining({ label: "finance", color_key: "neutral" })],
      })
    );
  });

  it("uses guarded create and import modals without treating endpoint defaults as edits", async () => {
    render(<AccountsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create account" }));
    const createDialog = screen.getByRole("dialog", { name: "Create an account" });
    const createEndpoint = await within(createDialog).findByLabelText("Storage endpoint (Ceph) *");
    await waitFor(() => expect(createEndpoint).toHaveValue("10"));
    expect(within(createDialog).getByLabelText("Account name *")).toBeInTheDocument();
    fireEvent.click(within(createDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Create an account" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const importDialog = screen.getByRole("dialog", { name: "Import RGW accounts" });
    const importEndpoint = await within(importDialog).findByLabelText("Ceph endpoint");
    await waitFor(() => expect(importEndpoint).toHaveValue("10"));
    fireEvent.click(within(importDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Import RGW accounts" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const editedImportDialog = screen.getByRole("dialog", { name: "Import RGW accounts" });
    fireEvent.change(within(editedImportDialog).getByRole("textbox"), { target: { value: "RGW00000000000000001" } });
    fireEvent.click(within(editedImportDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });

  it("keeps tagged accounts visible with exact quick filter mode", async () => {
    listS3AccountsMock.mockImplementation((params?: { search?: string }) => {
      const taggedAccount = {
        id: 1,
        name: "acc-1",
        tags: [makeTag(501, "gold", "amber")],
        rgw_account_id: "RGW000000000000001",
        storage_endpoint_id: 10,
        storage_endpoint_name: "ceph-main",
        storage_endpoint_url: "https://ceph.example.test",
        user_links: [],
        group_links: [],
      };
      const plainAccount = {
        id: 2,
        name: "acc-2",
        tags: [],
        rgw_account_id: "RGW000000000000002",
        storage_endpoint_id: 10,
        storage_endpoint_name: "ceph-main",
        storage_endpoint_url: "https://ceph.example.test",
        user_links: [],
        group_links: [],
      };
      const items = params?.search === "gold" ? [taggedAccount] : [taggedAccount, plainAccount];
      return Promise.resolve({
        items,
        total: items.length,
        page: 1,
        page_size: 25,
        has_next: false,
      });
    });

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    await screen.findByText("acc-2");

    const searchInput = screen.getByLabelText("Search");
    expect(searchInput).toHaveAttribute("type", "search");
    expect(searchInput).toHaveAttribute("placeholder", "Search by name, RGW ID, user email, group, or tag");

    fireEvent.click(screen.getByLabelText("Toggle filter match mode"));
    fireEvent.change(searchInput, {
      target: { value: "gold" },
    });

    await waitFor(() => {
      expect(listS3AccountsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: "gold",
        })
      );
    });
    expect(screen.getByText("acc-1")).toBeInTheDocument();
    expect(screen.queryByText("acc-2")).not.toBeInTheDocument();
    expect(screen.getByText("gold").parentElement?.className).toContain("text-[10px]");
  });
  it("restores inherited values only on Save and preserves delegation", async () => {
    portalEnabled = true;
    fetchAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings({ admin_override: { browser_access_enabled: true }, delegated_to_portal_managers: true }));
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    await screen.findByLabelText("Browser workspace access");
    fireEvent.click(screen.getByRole("button", { name: "Restore platform values" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }));
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Delegate Portal overrides to Portal managers" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateAccountPortalSettingsMock).toHaveBeenCalledWith(1, { delegated_to_portal_managers: true, bucket_defaults: null }));
    expect(updateS3AccountMock).not.toHaveBeenCalled();
  });

  it("keeps Portal drafts across account tabs and preserves unrelated server edits", async () => {
    portalEnabled = true;
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Portal settings" }));
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("enabled");
    fetchAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings({ admin_override: { allow_private_storage_space_create: false }, delegated_to_portal_managers: true }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateAccountPortalSettingsMock).toHaveBeenCalledWith(1, {
      browser_access_enabled: true, allow_private_storage_space_create: false, delegated_to_portal_managers: true,
    }));
    expect(updateS3AccountMock).not.toHaveBeenCalled();
  });

  it("identifies a conflicting Portal field and keeps the draft after failure", async () => {
    portalEnabled = true;
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    fetchAccountPortalSettingsMock.mockResolvedValue(makePortalAccountSettings({ admin_override: { browser_access_enabled: false } }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/A setting you edited has changed on the server/)).toBeInTheDocument();
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("enabled");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("disabled");
    fireEvent.change(screen.getByLabelText("Browser workspace access"), { target: { value: "inherit" } });
    updateAccountPortalSettingsMock.mockRejectedValueOnce(new Error("Unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/Unable to save project settings/)).toBeInTheDocument();
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("inherit");
  });

  it("keeps CORS edits inside the dialog until Apply and protects editor closure", async () => {
    portalEnabled = true;
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Customize — CORS origins" }));
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.change(screen.getByRole("textbox", { name: "CORS origins" }), { target: { value: "https://draft.example" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(screen.getByRole("textbox", { name: "CORS origins" })).toHaveValue("https://portal.example.test");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(screen.getAllByRole("dialog", { name: "Discard changes?" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
  });

  it("does not discard an unrelated account draft after saving Portal settings", async () => {
    portalEnabled = true;
    render(<AccountsPage />);
    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));
    fireEvent.click(screen.getByRole("switch", { name: "Bucket quota management" }));
    fireEvent.click(screen.getByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Project settings saved.");
    fireEvent.click(screen.getByRole("tab", { name: "Privileged access" }));
    expect(screen.getByRole("switch", { name: "Bucket quota management" })).toBeChecked();
    expect(updateS3AccountMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });

  it("preserves the independent Portal draft while freezing account-save navigation", async () => {
    portalEnabled = true;
    let finishSave!: () => void;
    updateS3AccountMock.mockReturnValueOnce(new Promise<void>(resolve => { finishSave = resolve; }));
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    fireEvent.click(screen.getByRole("tab", { name: "Privileged access" }));
    fireEvent.click(screen.getByRole("switch", { name: "Bucket quota management" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("tab", { name: "Portal settings" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to accounts" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Portal settings" }));
    expect(screen.getByRole("tab", { name: "Privileged access" })).toHaveAttribute("aria-selected", "true");
    await act(async () => finishSave());
    fireEvent.click(screen.getByRole("tab", { name: "Portal settings" }));
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("enabled");
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Project settings saved.");
    expect(updateS3AccountMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores an account save response after its editor is unmounted", async () => {
    portalEnabled = true;
    let finishSave!: () => void;
    updateS3AccountMock.mockReturnValueOnce(new Promise<void>(resolve => { finishSave = resolve; }));
    const first = render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));
    fireEvent.click(screen.getByRole("switch", { name: "Bucket quota management" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: "Back to accounts" })).toBeDisabled();
    first.unmount();
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    fireEvent.click(await screen.findByRole("tab", { name: "Portal settings" }));
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "enabled" } });
    await act(async () => finishSave());
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue("enabled");
    expect(screen.queryByText("S3Account updated")).not.toBeInTheDocument();
  });

  it.each([
    { bucket_count: null, rgw_user_count: 0, rgw_topic_count: 0 },
    { bucket_count: 0, rgw_user_count: 1, rgw_topic_count: 1 },
  ])("keeps RGW deletion unavailable for unverified or attached resources: %j", async (counts) => {
    getS3AccountMock.mockResolvedValueOnce({ id: 1, name: "acc-1", rgw_account_id: "RGW001", ...counts,
      rgw_user_uids: ["tenant$user"], rgw_topics: ["notification-topic"] });
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
    const dialog = within(await screen.findByRole("dialog", { name: "Delete acc-1" }));
    expect(dialog.getByRole("checkbox", { name: "Also delete RGW tenant RGW001" })).toBeDisabled();
    expect(dialog.getByText("tenant$user")).toBeInTheDocument();
    expect(dialog.getByText("notification-topic")).toBeInTheDocument();
    if (counts.bucket_count === null) expect(dialog.getByText(/Unable to verify linked RGW resources/)).toBeInTheDocument();
    expect(deleteS3AccountMock).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(deleteS3AccountMock).toHaveBeenCalledWith(1, { deleteRgw: false }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("retains the explicit RGW choice after failure and locks the confirmation during retry", async () => {
    getS3AccountMock.mockResolvedValueOnce({ id: 1, name: "acc-1", rgw_account_id: "RGW001", bucket_count: 0, rgw_user_count: 0, rgw_topic_count: 0 });
    deleteS3AccountMock.mockRejectedValueOnce(new Error("RGW refused deletion"));
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
    const dialog = within(await screen.findByRole("dialog", { name: "Delete acc-1" }));
    const choice = dialog.getByRole("checkbox", { name: "Also delete RGW tenant RGW001" });
    expect(choice).not.toBeChecked();
    fireEvent.click(choice);
    fireEvent.click(dialog.getByRole("button", { name: "Delete account" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("RGW refused deletion");
    expect(choice).toBeChecked();
    let resolve!: () => void;
    deleteS3AccountMock.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
    const confirm = dialog.getByRole("button", { name: "Delete account" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(choice).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Close modal" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteS3AccountMock).toHaveBeenCalledTimes(2);
    expect(deleteS3AccountMock).toHaveBeenLastCalledWith(1, { deleteRgw: true });
    await act(async () => resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("validates creation fields before sending and retains the pending draft after failure", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", {name: "Create account", exact: true}));
    const form = await screen.findByRole("form", {name: "Create RGW account"});
    const fields = within(form);
    const submit = fields.getByRole("button", {name: "Create account", exact: true});
    await waitFor(() => expect(submit).toBeEnabled());
    const name = fields.getByLabelText("Account name *");
    fireEvent.change(name, {target: {value: "   "}});
    fireEvent.submit(form);
    expect(await fields.findByText("Enter a name.")).toBeInTheDocument();
    await waitFor(() => expect(name).toHaveFocus());
    expect(createS3AccountMock).not.toHaveBeenCalled();
    fireEvent.change(name, {target: {value: "Test RGW identity"}});
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.change(fields.getByLabelText("Email contact"), {target: {value: "invalid-email"}});
    fireEvent.change(fields.getByLabelText("Object quota"), {target: {value: "1.5"}});
    fireEvent.submit(form);
    expect(fields.getByLabelText("Email contact")).toHaveAccessibleDescription("Enter a valid email address.");
    expect(fields.getByLabelText("Object quota")).toHaveAttribute("aria-invalid", "true");
    expect(createS3AccountMock).not.toHaveBeenCalled();
    fireEvent.change(fields.getByLabelText("Email contact"), {target: {value: "contact@example.test"}});
    fireEvent.change(fields.getByLabelText("Object quota"), {target: {value: "0"}});
    fireEvent.change(fields.getByLabelText("Storage quota"), {target: {value: "0.5"}});
    fireEvent.change(fields.getByLabelText("Storage quota unit"), {target: {value: "TiB"}});
    let reject!: (error: Error) => void;
    createS3AccountMock.mockReturnValueOnce(new Promise((_, fail) => {reject = fail;}));
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(createS3AccountMock).toHaveBeenCalledTimes(1);
    for (const control of Array.from(form.querySelectorAll("input,select,textarea,button"))) expect(control).toBeDisabled();
    expect(screen.getByRole("button", {name: "Close modal"})).toBeDisabled();
    await act(async () => reject(new Error("Fixture creation refused")));
    expect(await fields.findByText("Fixture creation refused")).toHaveAttribute("role", "alert");
    expect(name).toHaveValue("Test RGW identity");
    fireEvent.submit(form);
    await waitFor(() => expect(createS3AccountMock).toHaveBeenCalledTimes(2));
    expect(createS3AccountMock.mock.calls[1]).toEqual(createS3AccountMock.mock.calls[0]);
    expect(createS3AccountMock).toHaveBeenLastCalledWith(expect.objectContaining({name: "Test RGW identity", quota_max_size_gb: 0.5, quota_max_size_unit: "TiB", quota_max_objects: 0, storage_endpoint_id: 10}));
    await waitFor(() => expect(screen.queryByRole("form", {name: "Create RGW account"})).not.toBeInTheDocument());
  });

  it.each([
    ["tenant:account", "Account name must not contain ':'."],
    ["tenant$account", "Account name must not contain '$'."],
  ])("rejects an RGW account name containing reserved characters: %s", async (value, message) => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", {name: "Create account", exact: true}));
    const form = await screen.findByRole("form", {name: "Create RGW account"});
    const name = within(form).getByLabelText("Account name *");
    const submit = within(form).getByRole("button", {name: "Create account", exact: true});
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(name, {target: {value}});
    fireEvent.submit(form);

    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription(message);
    expect(createS3AccountMock).not.toHaveBeenCalled();

    fireEvent.change(name, {target: {value: "tenant account"}});
    expect(name).not.toHaveAttribute("aria-invalid", "true");
  });

  it("validates import identifiers inline and freezes the same payload through a retry", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", {name: "Import", exact: true}));
    const form = await screen.findByRole("form", {name: "Import RGW accounts"});
    const fields = within(form), text = fields.getByLabelText("RGW tenant IDs");
    await waitFor(() => expect(fields.getByRole("button", {name: "Import", exact: true})).toBeEnabled());
    fireEvent.submit(form);
    expect(text).toHaveAccessibleDescription("Enter at least one identifier.");
    fireEvent.change(text, {target: {value: "invalid-id"}});
    fireEvent.submit(form);
    expect(text).toHaveAccessibleDescription("Invalid identifiers: invalid-id");
    expect(importS3AccountsMock).not.toHaveBeenCalled();
    fireEvent.change(text, {target: {value: "RGW00000000000000001\nRGW00000000000000002"}});
    expect(text).not.toHaveAttribute("aria-invalid", "true");
    let reject!: (error: Error) => void;
    importS3AccountsMock.mockReturnValueOnce(new Promise((_, fail) => {reject = fail;}));
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(importS3AccountsMock).toHaveBeenCalledTimes(1);
    expect(text).toBeDisabled();
    expect(fields.getByRole("combobox")).toBeDisabled();
    expect(fields.getByRole("button", {name: "Cancel"})).toBeDisabled();
    await act(async () => reject(new Error("Fixture import refused")));
    expect(await fields.findByText("Fixture import refused")).toHaveAttribute("role", "alert");
    expect(text).toHaveValue("RGW00000000000000001\nRGW00000000000000002");
    fireEvent.submit(form);
    await waitFor(() => expect(importS3AccountsMock).toHaveBeenCalledTimes(2));
    expect(importS3AccountsMock.mock.calls[1]).toEqual(importS3AccountsMock.mock.calls[0]);
    expect(importS3AccountsMock).toHaveBeenLastCalledWith([{rgw_account_id: "RGW00000000000000001", storage_endpoint_id: 10}, {rgw_account_id: "RGW00000000000000002", storage_endpoint_id: 10}]);
    await waitFor(() => expect(text).toHaveValue(""));
    expect(text).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.click(fields.getByRole("button", {name: "Cancel"}));
    expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", {name: "Import RGW accounts"})).not.toBeInTheDocument();
  });

  it("locks native account submission and browser history until a failed save can be retried", async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    updateS3AccountMock.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const router = createMemoryRouter([
      { path: "/admin", element: <h1>Admin destination</h1> },
      { path: "/admin/s3-accounts", element: <AccountsPage /> },
    ], { initialEntries: ["/admin", "/admin/s3-accounts"] });
    render(<RouterProvider router={router} />);
    await user.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    const quota = await screen.findByLabelText("Object quota");
    await waitFor(() => expect(quota).toBeEnabled());
    await user.click(screen.getByRole("tab", { name: "Linked UI users" }));
    await user.click(screen.getByRole("button", { name: "Add UI users" }));
    await screen.findByRole("checkbox", { name: "ui7@example.com" });
    await user.click(screen.getByRole("tab", { name: "General" }));
    await user.type(quota, "42{Enter}");
    fireEvent.submit(screen.getByRole("form", { name: "Edit RGW account" }));
    expect(updateS3AccountMock).toHaveBeenCalledOnce();
    expect(quota).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Add a tag for this account" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Linked UI users" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "Search UI users", hidden: true })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "ui7@example.com", hidden: true })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Manager role for ui7@example.com", hidden: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to accounts" })).toBeDisabled();
    await act(async () => { await router.navigate(-1); });
    expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await act(async () => reject(new Error("Account write refused")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Account write refused");
    expect(quota).toHaveValue(42);
    expect(quota).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit RGW account" })).not.toBeInTheDocument());
    expect(updateS3AccountMock.mock.calls[1]).toEqual(updateS3AccountMock.mock.calls[0]);
    expect(updateAccountPortalSettingsMock).not.toHaveBeenCalled();
    await act(async () => { await router.navigate(-1); });
    expect(await screen.findByRole("heading", { name: "Admin destination" })).toBeVisible();
    router.dispose();
  });

  it("retries an account read without enabling an empty editor", async () => {
    getS3AccountMock.mockRejectedValueOnce(new Error("Account unavailable"));
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Account unavailable");
    expect(screen.queryByRole("form", { name: "Edit RGW account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Object quota")).toHaveValue(null);
    expect(getS3AccountMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { kind: "users", label: "ui7@example.com", mock: listMinimalUsersMock },
    { kind: "groups", label: "Research Group", mock: listMinimalGroupsMock },
  ])("recovers the $kind catalogue and protects selected additions before they are applied", async ({ kind, label, mock }) => {
    mock.mockRejectedValueOnce(new Error("Catalogue unavailable"));
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    fireEvent.click(await screen.findByRole("tab", { name: `Linked UI ${kind}` }));
    fireEvent.click(screen.getByRole("button", { name: `Add UI ${kind}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Catalogue unavailable");
    expect(screen.queryByText("No results.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: label, exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`Add the selected UI ${kind}`);
    expect(screen.getByRole("tab", { name: `Linked UI ${kind}` })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
    expect(updateS3AccountMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add selected" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateS3AccountMock).toHaveBeenCalledOnce());
    expect(updateS3AccountMock.mock.calls[0][1]).not.toHaveProperty("quota_max_size_gb");
    expect(updateS3AccountMock.mock.calls[0][1]).not.toHaveProperty("quota_max_objects");
  });

  it("reveals invalid quota fields across tabs and preserves zero and selected units", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    const quota = await screen.findByLabelText("Object quota");
    await waitFor(() => expect(quota).toBeEnabled());
    fireEvent.change(quota, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("tab", { name: "Privileged access" }));
    fireEvent.submit(screen.getByRole("form", { name: "Edit RGW account" }));
    await waitFor(() => expect(quota).toHaveFocus());
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(quota).toHaveAccessibleDescription("Enter a non-negative whole number within the supported range.");
    expect(updateS3AccountMock).not.toHaveBeenCalled();
    fireEvent.change(quota, { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Storage quota"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Storage quota unit"), { target: { value: "TiB" } });
    fireEvent.submit(screen.getByRole("form", { name: "Edit RGW account" }));
    await waitFor(() => expect(updateS3AccountMock).toHaveBeenCalledOnce());
    expect(updateS3AccountMock.mock.calls[0][1]).toEqual(expect.objectContaining({ quota_max_size_gb: 0.5, quota_max_size_unit: "TiB", quota_max_objects: 0 }));
  });

  it("keeps a fractional storage quota exact when changing only the object limit", async () => {
    const account = await getS3AccountMock();
    getS3AccountMock.mockResolvedValue({ ...account, quota_max_size_gb: 0.5001, quota_max_objects: 100 });
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    const objects = await screen.findByLabelText("Object quota");
    await waitFor(() => expect(objects).toBeEnabled());
    expect(screen.getByLabelText("Storage quota")).toHaveValue(0.5001);
    expect(screen.getByLabelText("Storage quota unit")).toHaveValue("GiB");
    fireEvent.change(objects, { target: { value: "" } });
    fireEvent.submit(screen.getByRole("form", { name: "Edit RGW account" }));
    await waitFor(() => expect(updateS3AccountMock).toHaveBeenCalledOnce());
    expect(updateS3AccountMock.mock.calls[0][1]).toEqual(expect.objectContaining({ quota_max_size_gb: 0.5001, quota_max_size_unit: "GiB", quota_max_objects: null }));
  });

  it("keeps endpoint-permission failures retryable without authorizing quota edits", async () => {
    getStorageEndpointMock.mockRejectedValueOnce(new Error("Permission lookup failed"));
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission lookup failed");
    expect(screen.getByLabelText("Object quota")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry permissions" }));
    await waitFor(() => expect(screen.getByLabelText("Object quota")).toBeEnabled());
    expect(updateS3AccountMock).not.toHaveBeenCalled();
  });

  it("locks the account shell during a Portal save and retains both drafts after failure", async () => {
    portalEnabled = true;
    let reject!: (error: Error) => void;
    updateAccountPortalSettingsMock.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    const quota = await screen.findByLabelText("Object quota");
    await waitFor(() => expect(quota).toBeEnabled());
    fireEvent.change(quota, { target: { value: "24" } });
    fireEvent.click(screen.getByRole("tab", { name: "Portal settings" }));
    const browserAccess = await screen.findByLabelText("Browser workspace access");
    fireEvent.change(browserAccess, { target: { value: "enabled" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateAccountPortalSettingsMock).toHaveBeenCalledOnce());
    expect(browserAccess).toBeDisabled();
    expect(quota).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to accounts" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "General" })).toBeDisabled();
    await act(async () => reject(new Error("Portal write failed")));
    expect(await screen.findByText(/Unable to save project settings/)).toBeInTheDocument();
    expect(browserAccess).toHaveValue("enabled");
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(quota).toHaveValue(24);
    expect(updateS3AccountMock).not.toHaveBeenCalled();
  });

  it("keeps endpoint capability failures visible and prevents creating or importing", async () => {
    getStorageEndpointMock.mockResolvedValue({id: 10, provider: "ceph", admin_ops_permissions: {accounts_write: false, users_write: false}});
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", {name: "Create account", exact: true}));
    let form = await screen.findByRole("form", {name: "Create RGW account"});
    await within(form).findByText(/Selected endpoint does not allow this operation/);
    expect(within(form).getByRole("button", {name: "Create account"})).toBeDisabled();
    fireEvent.submit(form);
    expect(createS3AccountMock).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("button", {name: "Cancel"}));
    fireEvent.click(screen.getByRole("button", {name: "Import", exact: true}));
    form = await screen.findByRole("form", {name: "Import RGW accounts"});
    await within(form).findByText(/Selected endpoint does not allow this operation/);
    expect(within(form).getByRole("button", {name: "Import"})).toBeDisabled();
    fireEvent.submit(form);
    expect(importS3AccountsMock).not.toHaveBeenCalled();
  });

});
